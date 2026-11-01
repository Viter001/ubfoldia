import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../src/electron/queue.ts';

test('tasks run in submission order even when an earlier task is slow', async () => {
  const queue = new SerialQueue();
  const order: string[] = [];
  const first = queue.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    order.push('first');
    return 1;
  });
  const second = queue.run(() => {
    order.push('second');
    return 2;
  });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first', 'second']);
});

test('a failed task rejects its caller but the shared queue keeps running', async () => {
  const queue = new SerialQueue();
  const failed = queue.run(async () => {
    throw Error('保存失败');
  });
  const next = queue.run(() => '继续');
  await assert.rejects(failed, /保存失败/);
  assert.equal(await next, '继续');
});

test('a rejected task does not poison later UI and agent work', async () => {
  const queue = new SerialQueue();
  const seen: string[] = [];
  const agent = queue.run(() => {
    seen.push('agent');
  });
  const ui = queue.run(async () => {
    seen.push('ui');
    throw Error('版本冲突');
  });
  const after = queue.run(() => {
    seen.push('after');
    return 'ok';
  });
  await agent;
  await assert.rejects(ui, /版本冲突/);
  assert.equal(await after, 'ok');
  assert.deepEqual(seen, ['agent', 'ui', 'after']);
});
