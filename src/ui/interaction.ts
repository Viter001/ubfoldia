import type { Project } from '../core/project';

export const COMMAND_GROUPS = ['文件', '开始', '插入', '转场', '动画', '视图'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];
export type WorkspaceMode = 'flow' | 'page';
export type LibraryTab = 'layers' | 'assets';

/**
 * Interaction-only state: workspace, current selection and transient UI tabs.
 * Project content stays in the session snapshot; a revision update keeps valid
 * selections, while a project identity change resets everything.
 */
export type InteractionState = {
  projectId: string | null;
  mode: WorkspaceMode;
  pageId: string;
  layerId: string;
  edgeId: string;
  commandGroup: CommandGroup;
  libraryTab: LibraryTab;
  /** Incremented when the flow viewport should return to the default framing. */
  viewportEpoch: number;
};

export const initialInteraction: InteractionState = {
  projectId: null,
  mode: 'flow',
  pageId: '',
  layerId: '',
  edgeId: '',
  commandGroup: '开始',
  libraryTab: 'layers',
  viewportEpoch: 0,
};

export type InteractionAction =
  | { type: 'sync'; project: Project | null }
  | { type: 'replace'; project: Project | null }
  | { type: 'select-page'; pageId: string }
  | { type: 'edit-page'; pageId: string }
  | { type: 'select-layer'; layerId: string }
  | { type: 'select-edge'; pageId: string; edgeId: string }
  | { type: 'mode'; mode: WorkspaceMode }
  | { type: 'command-group'; group: CommandGroup }
  | { type: 'library-tab'; tab: LibraryTab }
  | { type: 'reset-view' };

function reset(projectId: string | null, viewportEpoch: number): InteractionState {
  return { ...initialInteraction, projectId, viewportEpoch };
}

function sameProject(state: InteractionState, project: Project): InteractionState {
  const page = project.pages.find((item) => item.id === state.pageId);
  if (!page) {
    if (!state.pageId && !state.layerId && !state.edgeId && state.mode === 'flow') return state;
    return { ...state, pageId: '', layerId: '', edgeId: '', mode: 'flow' };
  }
  const layerStale = !!state.layerId && !page.layers.some((item) => item.id === state.layerId);
  const edgeStale = !!state.edgeId && !page.exits.some((item) => item.id === state.edgeId);
  if (!layerStale && !edgeStale) return state;
  return {
    ...state,
    ...(layerStale ? { layerId: '' } : {}),
    ...(edgeStale ? { edgeId: '' } : {}),
  };
}

export function interactionReducer(
  state: InteractionState,
  action: InteractionAction,
): InteractionState {
  switch (action.type) {
    case 'sync': {
      const project = action.project;
      if (!project) {
        if (state.projectId === null) return state;
        return reset(null, state.viewportEpoch + 1);
      }
      if (state.projectId !== project.id) return reset(project.id, state.viewportEpoch + 1);
      return sameProject(state, project);
    }
    case 'replace':
      // new/open/recent-open are session replacements even when the same
      // project is re-opened; only revision updates keep valid selections.
      return reset(action.project?.id ?? null, state.viewportEpoch + 1);
    case 'select-page': {
      const samePage = state.pageId === action.pageId;
      return {
        ...state,
        pageId: action.pageId,
        edgeId: '',
        ...(samePage ? {} : { layerId: '' }),
      };
    }
    case 'edit-page':
      return {
        ...state,
        mode: 'page',
        pageId: action.pageId,
        layerId: '',
        edgeId: '',
        commandGroup: '开始',
      };
    case 'select-layer':
      return { ...state, layerId: action.layerId };
    case 'select-edge':
      return { ...state, pageId: action.pageId, edgeId: action.edgeId };
    case 'mode':
      if (action.mode === 'page' && !state.pageId) return state;
      return { ...state, mode: action.mode };
    case 'command-group':
      return { ...state, commandGroup: action.group };
    case 'library-tab':
      return { ...state, libraryTab: action.tab };
    case 'reset-view':
      return { ...state, viewportEpoch: state.viewportEpoch + 1 };
  }
}
