import { contextBridge, ipcRenderer } from 'electron';
import type { LeaveChoice, LeavePrompt, LeaveResult } from '../shared/leave';
import { flushFocusedEditor } from './flush';

function listen<T>(channel: string, callback: (value: T) => void) {
  const handler = (_: unknown, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Flush the focused DOM editor before the main process saves or closes.
// The state request is a queue barrier after the blur-triggered edit command.
ipcRenderer.on('flush-editor', async (_, requestId: string) => {
  try {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const error = await flushFocusedEditor(active, () => ipcRenderer.invoke('studio', 'state'));
    ipcRenderer.send('flush-editor-done', requestId, error);
  } catch (error) {
    ipcRenderer.send('flush-editor-done', requestId, String(error));
  }
});

contextBridge.exposeInMainWorld('studio', {
  // Read-only platform hint used for renderer-side window chrome decisions.
  platform: process.platform,
  setTitleBarTheme: (theme: {
    backgroundColor: string;
    overlayColor: string;
    symbolColor: string;
  }) => ipcRenderer.send('titlebar-theme', theme),
  invoke: (action: string, payload?: unknown) => ipcRenderer.invoke('studio', action, payload),
  subscribe: (callback: (state: unknown) => void) => listen('state', callback),
  onLeaveRequest: (callback: (prompt: LeavePrompt) => void) => listen('leave-request', callback),
  onLeaveResult: (callback: (result: LeaveResult) => void) => listen('leave-result', callback),
  respondLeave: (id: string, choice: LeaveChoice) => ipcRenderer.send('leave-response', id, choice),
});
