import type { Command, Project } from '../core/project';

/** One entry in the welcome screen's recent-project list. */
export type RecentProject = {
  name: string;
  path: string;
  lastOpenedAt: string;
};

export type RecentProjectsResult = {
  entries: RecentProject[];
  warning: string;
};

/** Snapshot of the desktop session sent to the renderer on every change. */
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

export type NewProjectInput = {
  name: string;
  width: number;
  height: number;
};

export type RecentPathPayload = string | { path?: string };

export type ImportResult = {
  path: string;
  ok: boolean;
  assetId?: string;
  error?: string;
};

export type ImportResultValue = {
  results: ImportResult[];
};

/**
 * Request/response mapping for the single `studio` IPC channel. Keeping the
 * payload and result next to each action lets the renderer and main process
 * agree on the wire shape without relying on `any`.
 */
export type StudioRequests = {
  state: { payload: void; result: State };
  new: { payload: NewProjectInput; result: State | null };
  open: { payload: void; result: State | null };
  'recent-open': { payload: RecentPathPayload; result: State | null };
  'recent-projects': { payload: void; result: RecentProjectsResult };
  'recent-remove': { payload: RecentPathPayload; result: RecentProjectsResult };
  command: { payload: Command; result: State };
  undo: { payload: void; result: State };
  redo: { payload: void; result: State };
  save: { payload: void; result: State };
  import: { payload: void; result: ImportResultValue | null };
  approve: { payload: void; result: State };
};

export type StudioAction = keyof StudioRequests;
export type StudioPayload<A extends StudioAction> = StudioRequests[A]['payload'];
export type StudioValue<A extends StudioAction> = StudioRequests[A]['result'];

export type StudioSuccess<A extends StudioAction> = {
  ok: true;
  value: StudioValue<A>;
};

export type StudioFailure = {
  ok: false;
  error: string;
};

/** Discriminated result carried by the preload bridge; `error` is user-facing text. */
export type StudioResult<A extends StudioAction> = StudioSuccess<A> | StudioFailure;

export type StudioBridge = {
  /** process.platform of the desktop host; read-only. */
  platform: string;
  /** Update the native Windows caption strip when the editor theme changes. */
  setTitleBarTheme: (theme: {
    backgroundColor: string;
    overlayColor: string;
    symbolColor: string;
  }) => void;
  invoke: {
    <A extends StudioAction>(
      action: A,
      ...args: StudioPayload<A> extends void ? [] : [payload: StudioPayload<A>]
    ): Promise<StudioResult<A>>;
  };
  subscribe: (fn: (state: State) => void) => () => void;
  onLeaveRequest: (fn: (prompt: import('./leave').LeavePrompt) => void) => () => void;
  onLeaveResult: (fn: (result: import('./leave').LeaveResult) => void) => () => void;
  respondLeave: (id: string, choice: import('./leave').LeaveChoice) => void;
};
