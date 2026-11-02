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
  /** Primary selected page; it drives the inspector in flow mode. */
  pageId: string;
  /** All selected pages; always contains pageId when pageId is non-empty. */
  selectedPageIds: string[];
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
  selectedPageIds: [],
  layerId: '',
  edgeId: '',
  commandGroup: '开始',
  libraryTab: 'layers',
  viewportEpoch: 0,
};

export type InteractionAction =
  | { type: 'sync'; project: Project | null }
  | { type: 'replace'; project: Project | null }
  | { type: 'select-page'; pageId: string; additive?: boolean }
  | { type: 'select-pages'; pageIds: string[] }
  | { type: 'clear-selection' }
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

function withPrimary(
  state: InteractionState,
  pageIds: string[],
  primary?: string,
): InteractionState {
  const selectedPageIds = [...new Set(pageIds.filter(Boolean))];
  const pageId =
    primary && selectedPageIds.includes(primary)
      ? primary
      : selectedPageIds.includes(state.pageId)
        ? state.pageId
        : (selectedPageIds[selectedPageIds.length - 1] ?? '');
  return {
    ...state,
    pageId,
    selectedPageIds,
    edgeId: '',
    ...(pageId === state.pageId ? {} : { layerId: '' }),
  };
}

function sameProject(state: InteractionState, project: Project): InteractionState {
  const pages = new Map(project.pages.map((item) => [item.id, item]));
  let selectedPageIds = state.selectedPageIds.filter((id) => pages.has(id));
  let pageId = pages.has(state.pageId) ? state.pageId : (selectedPageIds.at(-1) ?? '');
  if (pageId && !selectedPageIds.includes(pageId)) selectedPageIds = [...selectedPageIds, pageId];

  if (!pageId) {
    if (
      !state.pageId &&
      !state.layerId &&
      !state.edgeId &&
      !state.selectedPageIds.length &&
      state.mode === 'flow'
    )
      return state;
    return {
      ...state,
      pageId: '',
      selectedPageIds: [],
      layerId: '',
      edgeId: '',
      mode: 'flow',
    };
  }

  const page = pages.get(pageId)!;
  const layerStale = !!state.layerId && !page.layers.some((item) => item.id === state.layerId);
  const edgeStale = !!state.edgeId && !page.exits.some((item) => item.id === state.edgeId);
  if (!layerStale && !edgeStale && selectedPageIds.length === state.selectedPageIds.length)
    return state;
  return {
    ...state,
    pageId,
    selectedPageIds,
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
      if (!action.additive) return withPrimary(state, [action.pageId], action.pageId);
      const selected = new Set(state.selectedPageIds);
      const wasSelected = selected.has(action.pageId);
      if (wasSelected) selected.delete(action.pageId);
      else selected.add(action.pageId);
      const primary = wasSelected
        ? selected.has(state.pageId)
          ? state.pageId
          : (Array.from(selected).at(-1) ?? '')
        : action.pageId;
      return withPrimary(state, Array.from(selected), primary);
    }
    case 'select-pages':
      return withPrimary(state, action.pageIds);
    case 'clear-selection':
      return {
        ...state,
        pageId: '',
        selectedPageIds: [],
        layerId: '',
        edgeId: '',
        mode: 'flow',
      };
    case 'edit-page':
      return {
        ...state,
        mode: 'page',
        pageId: action.pageId,
        selectedPageIds: [action.pageId],
        layerId: '',
        edgeId: '',
        commandGroup: '开始',
      };
    case 'select-layer':
      return { ...state, layerId: action.layerId };
    case 'select-edge':
      return {
        ...state,
        pageId: action.pageId,
        selectedPageIds: [action.pageId],
        edgeId: action.edgeId,
      };
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
