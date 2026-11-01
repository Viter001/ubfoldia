import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLeave, isTrustedSender, type LeaveFlow } from '../src/electron/leave.ts';
import type { LeaveChoice, LeavePrompt, LeaveResult } from '../src/shared/leave.ts';

function harness(overrides: Partial<LeaveFlow> = {}) {
  const requests: LeavePrompt[] = [];
  const notices: LeaveResult[] = [];
  const choices: LeaveChoice[] = [];
  const stats = { saves: 0, failures: 0 };
  const flow: LeaveFlow = {
    isDirty: () => true,
    id: () => 'leave-1',
    projectName: () => '林间来信',
    request: (prompt) => requests.push(prompt),
    nextChoice: async () => {
      const choice = choices.shift();
      if (!choice) throw Error('测试缺少选择结果');
      return choice;
    },
    save: async () => {
      stats.saves++;
      if (stats.failures > 0) {
        stats.failures--;
        throw Error('磁盘已满');
      }
    },
    notify: (result) => notices.push(result),
    ...overrides,
  };
  return { flow, requests, notices, choices, stats };
}

test('a clean project leaves immediately without a prompt or save', async () => {
  const h = harness({ isDirty: () => false });
  assert.equal(await confirmLeave(h.flow, 'close'), true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.stats.saves, 0);
  assert.equal(h.notices.length, 0);
});

test('cancel keeps the project open and never saves', async () => {
  const h = harness();
  h.choices.push('cancel');
  assert.equal(await confirmLeave(h.flow, 'open'), false);
  assert.deepEqual(h.requests, [{ id: 'leave-1', reason: 'open', projectName: '林间来信' }]);
  assert.equal(h.stats.saves, 0);
  assert.equal(h.notices.length, 0);
});

test('a failed save reports the error and still lets the user cancel', async () => {
  const h = harness();
  h.choices.push('save', 'cancel');
  h.stats.failures = 1;
  assert.equal(await confirmLeave(h.flow, 'new'), false);
  assert.equal(h.stats.saves, 1);
  assert.deepEqual(h.notices, [{ id: 'leave-1', ok: false, error: '磁盘已满' }]);
  assert.equal(h.requests.length, 1, 'the prompt is not stacked again after a failure');
});

test('a failed save can be retried until saving succeeds', async () => {
  const h = harness();
  h.choices.push('save', 'save');
  h.stats.failures = 1;
  assert.equal(await confirmLeave(h.flow, 'close'), true);
  assert.equal(h.stats.saves, 2);
  assert.deepEqual(h.notices, [
    { id: 'leave-1', ok: false, error: '磁盘已满' },
    { id: 'leave-1', ok: true, closed: true },
  ]);
});

test('discard leaves without saving and closes the prompt', async () => {
  const h = harness();
  h.choices.push('discard');
  assert.equal(await confirmLeave(h.flow, 'close'), true);
  assert.equal(h.stats.saves, 0);
  assert.deepEqual(h.notices, [{ id: 'leave-1', ok: true, closed: true }]);
});

test('a renderer that cannot be asked rejects instead of hanging', async () => {
  const h = harness({
    request: () => {
      throw Error('窗口不可用');
    },
  });
  await assert.rejects(confirmLeave(h.flow, 'close'), /窗口不可用/);
  assert.equal(h.stats.saves, 0);
});

test('only the main window frame is trusted', () => {
  const sender = { main: true };
  const frame = { top: true };
  assert.equal(isTrustedSender(sender, frame, sender, frame), true);
  assert.equal(isTrustedSender(sender, { other: true }, sender, frame), false);
  assert.equal(isTrustedSender({ other: true }, frame, sender, frame), false);
  assert.equal(isTrustedSender(null, null, sender, frame), false);
});
import { LeaveCoordinator } from '../src/electron/leave.ts';

function coordinatorHarness(
  overrides: {
    dirty?: () => boolean;
    save?: () => Promise<void>;
    timeoutMs?: number;
    gone?: boolean;
  } = {},
) {
  const requests: LeavePrompt[] = [];
  const results: LeaveResult[] = [];
  let saves = 0;
  let failNext = false;
  const coordinator = new LeaveCoordinator({
    session: {
      dirty: overrides.dirty ?? (() => true),
      active: () => ({ project: { name: '林间来信' } }),
      save: async () => {
        saves++;
        if (overrides.save) return overrides.save();
        if (failNext) {
          failNext = false;
          throw Error('磁盘已满');
        }
      },
    },
    sendRequest: (prompt) => requests.push(prompt),
    sendResult: (result) => results.push(result),
    id: () => 'leave-test',
    timeoutMs: overrides.timeoutMs ?? 1000,
  });
  if (overrides.gone) coordinator.markRendererGone();
  return {
    coordinator,
    requests,
    results,
    saves: () => saves,
    failNextSave: () => {
      failNext = true;
    },
  };
}

test('leave coordinator cancels without saving and reopens for the next attempt', async () => {
  const h = coordinatorHarness();
  const pending = h.coordinator.mayLeave('open');
  assert.deepEqual(h.requests, [{ id: 'leave-test', reason: 'open', projectName: '林间来信' }]);
  assert.equal(h.coordinator.open, true);
  h.coordinator.respond('leave-test', 'cancel');
  assert.equal(await pending, false);
  assert.equal(h.saves(), 0);
  assert.equal(h.coordinator.open, false);
  assert.deepEqual(h.results, []);
});

test('leave coordinator keeps a failed save open for retry', async () => {
  const h = coordinatorHarness();
  h.failNextSave();
  const pending = h.coordinator.mayLeave('new');
  h.coordinator.respond('leave-test', 'save');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.results, [{ id: 'leave-test', ok: false, error: '磁盘已满' }]);
  assert.equal(h.coordinator.open, true, 'the same prompt stays open');
  h.coordinator.respond('leave-test', 'save');
  assert.equal(await pending, true);
  assert.equal(h.saves(), 2);
  assert.deepEqual(h.results.at(-1), { id: 'leave-test', ok: true, closed: true });
});

test('an unanswered leave prompt times out as a cancelled operation', async () => {
  const h = coordinatorHarness({ timeoutMs: 15 });
  assert.equal(await h.coordinator.mayLeave('close'), false);
  assert.deepEqual(h.results, [
    { id: 'leave-test', ok: false, closed: true, error: '等待确认超时，操作已取消。' },
  ]);
  assert.equal(h.coordinator.open, false);
});

test('a destroyed renderer cancels pending prompts and refuses new ones', async () => {
  const h = coordinatorHarness();
  const pending = h.coordinator.mayLeave('close');
  h.coordinator.markRendererGone();
  assert.equal(await pending, false);
  assert.equal(h.coordinator.open, false);
  await assert.rejects(h.coordinator.mayLeave('close'), /窗口不可用/);
});
