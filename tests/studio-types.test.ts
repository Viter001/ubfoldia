import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImportResultValue, State, StudioBridge, StudioResult } from '../src/shared/studio.ts';
import type { useStudioSession } from '../src/ui/useStudioSession.ts';

declare const bridge: StudioBridge;
declare const invoke: ReturnType<typeof useStudioSession>['invoke'];

/**
 * Compile-time only: this function is never executed. It proves that the
 * preload bridge and the session hook keep each action tied to its payload and
 * result, so a wrong command shape is rejected by tsc instead of any cast.
 */
async function studioContract() {
  const stateResult: StudioResult<'state'> = await bridge.invoke('state');
  const created: StudioResult<'new'> = await bridge.invoke('new', {
    name: '契约',
    width: 1280,
    height: 720,
  });
  const commandResult: StudioResult<'command'> = await bridge.invoke('command', {
    type: 'page.add',
    name: '页面',
  });
  const imported: StudioResult<'import'> = await bridge.invoke('import');

  const stateFromHook: State | null = await invoke('state');
  const commandFromHook: State | null = await invoke('command', {
    type: 'page.add',
    name: '页面',
  });
  const importFromHook: ImportResultValue | null = await invoke('import');

  if (commandResult.ok) {
    const state: State = commandResult.value;
    // @ts-expect-error a command returns the session State, not import results
    const wrong: ImportResultValue = commandResult.value;
    void state;
    void wrong;
  }

  // @ts-expect-error command requires a payload
  await bridge.invoke('command');
  // @ts-expect-error the command payload is a core Command, not an arbitrary string
  await bridge.invoke('command', 'page.add');
  // @ts-expect-error a page.add command needs its name
  await bridge.invoke('command', { type: 'page.add' });
  // @ts-expect-error state takes no payload
  await bridge.invoke('state', {});
  // @ts-expect-error unknown action
  await bridge.invoke('unknown-action');
  // @ts-expect-error new requires a project input
  await bridge.invoke('new');
  // @ts-expect-error the hook payload is a core Command too
  await invoke('command', { type: 'page.add' });
  // @ts-expect-error the hook keeps no-payload actions strict
  await invoke('state', {});

  void stateResult;
  void created;
  void imported;
  void stateFromHook;
  void commandFromHook;
  void importFromHook;
}
void studioContract;

test('studio bridge and session hook keep action payloads and results associated', () =>
  assert.ok(true));
