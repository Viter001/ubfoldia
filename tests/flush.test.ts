import test from 'node:test';
import assert from 'node:assert/strict';
import { flushFocusedEditor } from '../src/electron/flush.ts';

test('blurs the focused editor before syncing state', async () => {
  const order: string[] = [];
  const error = await flushFocusedEditor(
    {
      blur() {
        order.push('blur');
      },
    },
    async () => {
      assert.deepEqual(order, ['blur']);
      order.push('state');
      return { ok: true };
    },
  );
  assert.equal(error, null);
  assert.deepEqual(order, ['blur', 'state']);
});

test('returns the state sync error so the main process can abort', async () => {
  const error = await flushFocusedEditor(null, async () => ({ ok: false, error: '状态失败' }));
  assert.equal(error, '状态失败');
});

test('uses a readable fallback when the bridge gives no error text', async () => {
  assert.equal(await flushFocusedEditor(null, async () => ({ ok: false })), '状态同步失败');
});
import { FlushCoordinator } from '../src/electron/flush.ts';

test('coordinates a flush request with the renderer and settles exactly once', async () => {
  const sent: string[] = [];
  const coordinator = new FlushCoordinator({
    send: (id) => sent.push(id),
    isAvailable: () => true,
    id: () => 'flush-1',
    timeoutMs: 1000,
  });
  const pending = coordinator.flush();
  assert.deepEqual(sent, ['flush-1']);
  coordinator.settle('flush-1', '状态失败');
  await assert.rejects(pending, /状态失败/);
  coordinator.settle('flush-1');
  assert.deepEqual(sent, ['flush-1']);
});

test('a renderer that never answers rejects the flush instead of hanging forever', async () => {
  const coordinator = new FlushCoordinator({
    send: () => {},
    isAvailable: () => true,
    id: () => 'flush-slow',
    timeoutMs: 10,
  });
  await assert.rejects(coordinator.flush(), /编辑器未响应/);
});

test('an unavailable window fails before sending, and destroy rejects pending flushes', async () => {
  const unavailable = new FlushCoordinator({
    send: () => assert.fail('must not send'),
    isAvailable: () => false,
  });
  await assert.rejects(unavailable.flush(), /窗口不可用/);

  const coordinator = new FlushCoordinator({
    send: () => {},
    isAvailable: () => true,
    id: () => 'flush-destroyed',
    timeoutMs: 1000,
  });
  const pending = coordinator.flush();
  coordinator.cancelAll('窗口已销毁');
  await assert.rejects(pending, /窗口已销毁/);
});
