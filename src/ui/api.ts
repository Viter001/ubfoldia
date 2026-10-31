import type { Project } from '../core/project';
import type { RecentProject } from '../electron/recent-projects';
import type { LeaveChoice, LeavePrompt, LeaveResult } from '../shared/leave';
export type { RecentProject };
export type RecentProjectsResult = {
  entries: RecentProject[];
  warning: string;
};
export type State = {
  project: Project | null;
  root: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  missing: string[];
  approvedRoots: string[];
  recentWarning?: string;
};
declare global {
  interface Window {
    studio: {
      /** process.platform of the desktop host; read-only. */
      platform: string;
      invoke: (
        action: string,
        payload?: unknown,
      ) => Promise<{ ok: boolean; value: any; error?: string }>;
      subscribe: (fn: (state: State) => void) => () => void;
      onLeaveRequest: (fn: (prompt: LeavePrompt) => void) => () => void;
      onLeaveResult: (fn: (result: LeaveResult) => void) => () => void;
      respondLeave: (id: string, choice: LeaveChoice) => void;
    };
  }
}
export const assetURL = (p: Project, id: string) => `book-asset://${p.id}/${id}`;
