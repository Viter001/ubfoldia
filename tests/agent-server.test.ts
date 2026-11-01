import test from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { handleAgentSocket, agentPipePath } from '../src/electron/agent-server.ts';
import { SerialQueue } from '../src/electron/queue.ts';

class FakeSocket {
  destroyed = false;
  writes: string[] = [];
  private dataHandlers: ((chunk: string) => void)[] = [];

  setEncoding() {}
  setTimeout() {}
  on(event: string, handler: (chunk: string) => void) {
    if (event === 'data') this.dataHandlers.push(handler);
  }
  write(data: string) {
    this.writes.push(data);
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  send(data: string) {
    for (const handler of this.dataHandlers) handler(data);
  }
}

async function waitForReply(socket: FakeSocket) {
  for (let i = 0; i < 100; i++) {
    if (socket.writes.length) return JSON.parse(socket.writes.shift()!);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('no agent reply');
}

test('agent transport validates the token, flushes before save and shares the queue', async () => {
  const events: string[] = [];
  const queue = new SerialQueue();
  const socket = new FakeSocket();
  handleAgentSocket(socket as unknown as Socket, {
    token: 'secret-token',
    flush: async () => {
      events.push('flush');
    },
    queue,
    call: async (name, args) => {
      events.push('call:' + name + ':' + String(args.path));
      return { name, revision: 7 };
    },
  });

  socket.send(
    JSON.stringify({
      id: 'save-1',
      token: 'secret-token',
      name: 'project_save',
      args: { path: '/tmp/story' },
    }) + '\n',
  );
  const reply = await waitForReply(socket);
  assert.deepEqual(events, ['flush', 'call:project_save:/tmp/story']);
  assert.deepEqual(reply, { id: 'save-1', result: { name: 'project_save', revision: 7 } });

  socket.send(
    JSON.stringify({ id: 'bad-token', token: 'wrong', name: 'pages_add', args: {} }) + '\n',
  );
  const denied = await waitForReply(socket);
  assert.match(String(denied.error), /UNAUTHORIZED/);
  assert.deepEqual(events, ['flush', 'call:project_save:/tmp/story']);
});

test('agent transport queues concurrent lines in order and recovers from a failed request', async () => {
  const queue = new SerialQueue();
  const socket = new FakeSocket();
  const seen: string[] = [];
  handleAgentSocket(socket as unknown as Socket, {
    token: 'token',
    flush: async () => {},
    queue,
    call: async (name) => {
      seen.push(name);
      if (name === 'fail') throw Error('boom');
      return name;
    },
  });

  for (const [id, name] of [
    ['1', 'first'],
    ['2', 'fail'],
    ['3', 'third'],
  ] as const)
    socket.send(JSON.stringify({ id, token: 'token', name, args: {} }) + '\n');

  const replies = await Promise.all([
    waitForReply(socket),
    waitForReply(socket),
    waitForReply(socket),
  ]);
  assert.deepEqual(seen, ['first', 'fail', 'third']);
  assert.deepEqual(
    replies.map((reply) => (reply.error ? 'error' : reply.result)),
    ['first', 'error', 'third'],
  );
});

test('oversized frames close the socket instead of buffering forever', () => {
  const socket = new FakeSocket();
  handleAgentSocket(socket as unknown as Socket, {
    token: 'token',
    flush: async () => {},
    queue: new SerialQueue(),
    call: async () => null,
  });
  socket.send('x'.repeat(1024 * 1024 + 1));
  assert.equal(socket.destroyed, true);
});

test('the agent pipe name is stable and platform specific', () => {
  assert.match(agentPipePath('win32', 42, 'C:/temp'), /picture-book-studio-42$/);
  assert.match(agentPipePath('linux', 42, '/tmp'), /picture-book-studio-42\.sock$/);
});
