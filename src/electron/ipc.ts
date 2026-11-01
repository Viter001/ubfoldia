import type { IpcMain } from 'electron';
import type { FlushCoordinator } from './flush';
import type { LeaveCoordinator } from './leave';
import type { SerialQueue } from './queue';
import type { StudioRouter } from './router';

export const FLUSH_ACTIONS = new Set(['save', 'open', 'new', 'recent-open']);

/**
 * Registers the whitelisted renderer bridge. Requests that save or switch the
 * project flush the focused editor before joining the shared serial queue.
 */
export function registerStudioIpc(options: {
  ipcMain: Pick<IpcMain, 'on' | 'handle'>;
  trusted: (event: { sender: unknown; senderFrame: unknown }) => boolean;
  queue: SerialQueue;
  flusher: FlushCoordinator;
  leave: LeaveCoordinator;
  router: StudioRouter;
}) {
  options.ipcMain.on('flush-editor-done', (event, id, error) => {
    if (!options.trusted(event) || typeof id !== 'string') return;
    options.flusher.settle(id, typeof error === 'string' ? error : undefined);
  });

  options.ipcMain.on('leave-response', (event, id, choice) => {
    if (!options.trusted(event) || typeof id !== 'string') return;
    if (choice !== 'save' && choice !== 'discard' && choice !== 'cancel') return;
    options.leave.respond(id, choice);
  });

  options.ipcMain.handle('studio', async (event, action, payload) => {
    if (!options.trusted(event)) throw Error('INVALID_SENDER');
    try {
      if (typeof action === 'string' && FLUSH_ACTIONS.has(action)) await options.flusher.flush();
      const value = await options.queue.run(() => options.router.dispatch(action, payload));
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
