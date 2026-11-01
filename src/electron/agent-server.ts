import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { SerialQueue } from './queue';

export function agentPipePath(platform: NodeJS.Platform, pid: number, tempDir: string) {
  return platform === 'win32'
    ? `\\\\.\\pipe\\picture-book-studio-${pid}`
    : join(tempDir, `picture-book-studio-${pid}.sock`);
}

export async function writeAgentEndpoint(
  userDataDir: string,
  endpoint: { pipe: string; token: string },
): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, 'agent-endpoint.json'), JSON.stringify(endpoint), {
    mode: 0o600,
  });
}

export type AgentTransportOptions = {
  token: string;
  flush: () => Promise<void>;
  queue: SerialQueue;
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Newline-delimited JSON on one socket. The transport holds no project:
 * every request is validated by token and forwarded to the shared queue.
 */
export function handleAgentSocket(socket: Socket, options: AgentTransportOptions) {
  socket.setEncoding('utf8');
  let buffer = '';
  socket.setTimeout(30000, () => socket.destroy());
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > 1024 * 1024) {
      socket.destroy();
      return;
    }
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      socket.setTimeout(0);
      void (async () => {
        try {
          const request = JSON.parse(line);
          if (request.token !== options.token) throw Error('UNAUTHORIZED');
          if (request.name === 'project_save') await options.flush();
          const result = await options.queue.run(() =>
            options.call(request.name, request.args ?? {}),
          );
          if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result }) + '\n');
          socket.setTimeout(30000);
        } catch (error) {
          if (!socket.destroyed) socket.write(JSON.stringify({ error: String(error) }) + '\n');
          socket.setTimeout(30000);
        }
      })();
    }
  });
  socket.on('error', () => {});
}

export function startAgentTransport(options: { pipe: string } & AgentTransportOptions): Server {
  return createServer((socket) => handleAgentSocket(socket, options));
}
