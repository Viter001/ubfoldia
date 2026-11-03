import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Command, Project } from '../core/project';
import { Player } from './Scene';
import { LeaveDialog } from './LeaveDialog';
import { RecentProjects } from './RecentProjects';
import { WindowTitleBar } from './WindowTitleBar';
import { CommandRibbon } from './CommandRibbon';
import { FlowWorkspace, type FlowInstance } from './FlowWorkspace';
import { FlowInspector } from './FlowInspector';
import { PageWorkspace } from './PageWorkspace';
import { NewProjectDialog } from './NewProjectDialog';
import { DeletePageDialog } from './DeletePageDialog';
import { initialInteraction, interactionReducer } from './interaction';
import { useStudioSession } from './useStudioSession';
import { useLeaveDialog } from './useLeaveDialog';
import { useAudition } from './useAudition';
import { useFlowView } from './flow-view';
import { globalKeyIntent } from './leave';
import type { NewProjectInput } from './api';
import { applyTheme, loadTheme, themeById, type ThemeId } from './themes';

export function App() {
  const { state, setState, error, message, setError, setMessage, clearBanner, invoke } =
    useStudioSession();
  const [interaction, dispatch] = useReducer(interactionReducer, initialInteraction);
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const {
    mode,
    pageId,
    selectedPageIds,
    layerId,
    edgeId,
    commandGroup,
    libraryTab,
    viewportEpoch,
  } = interaction;
  const project = state.project;
  const page = project?.pages.find((candidate) => candidate.id === pageId);
  const selectedPages =
    project?.pages.filter((candidate) => selectedPageIds.includes(candidate.id)) ?? [];
  const layer = page?.layers.find((candidate) => candidate.id === layerId);
  const edgePage = project?.pages.find((candidate) =>
    candidate.exits.some((exit) => exit.id === edgeId),
  );
  const edge = edgePage?.exits.find((exit) => exit.id === edgeId);
  const [preview, setPreview] = useState<{ snapshot: Project; startId: string } | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const flowRef = useRef<FlowInstance | null>(null);
  // Owned above the conditionally rendered canvas so pan/zoom and the one-shot
  // fit survive page-workspace and preview round trips.
  const flowView = useFlowView(project, viewportEpoch, mode === 'flow' && !preview);
  const audition = useAudition(project, setError);
  const { leave, answer } = useLeaveDialog(setError);

  useEffect(() => {
    applyTheme(theme);
    const native = themeById(theme).native;
    window.studio?.setTitleBarTheme({
      backgroundColor: native.background,
      overlayColor: native.overlay,
      symbolColor: native.symbol,
    });
  }, [theme]);

  useEffect(() => {
    dispatch({ type: 'sync', project });
  }, [project]);

  // A successful session replacement resets the flow framing; cancelling or
  // failing a switch never bumps the epoch, so the current view is kept.
  useEffect(() => {
    if (flowView.resetEpoch === 0) return;
    flowRef.current?.setViewport({ ...flowView.view.viewport });
  }, [flowView.resetEpoch]);

  const command = useCallback(
    (next: Command) => {
      void invoke('command', next);
    },
    [invoke],
  );
  const edit = useCallback((id: string) => {
    dispatch({ type: 'edit-page', pageId: id });
  }, []);
  const showFlow = useCallback(() => {
    audition.stop();
    dispatch({ type: 'mode', mode: 'flow' });
  }, [audition.stop]);

  function openNew() {
    setError('');
    setNewDialog(true);
  }
  async function openProject() {
    audition.stop();
    const result = await invoke('open');
    if (result?.project) dispatch({ type: 'replace', project: result.project });
  }
  async function openRecent(path: string) {
    audition.stop();
    setError('');
    setMessage('');
    const response = await window.studio.invoke('recent-open', path);
    if (!response.ok) throw Error(response.error || '无法打开最近工程');
    if (!response.value?.project) return false;
    setState(response.value);
    if (response.value.recentWarning) setMessage(response.value.recentWarning);
    dispatch({ type: 'replace', project: response.value.project });
    return true;
  }
  async function createProject(input: NewProjectInput) {
    audition.stop();
    const result = await invoke('new', input);
    if (!result?.project) return false;
    dispatch({ type: 'replace', project: result.project });
    return true;
  }
  async function addPage() {
    if (!project) return;
    const before = new Set(project.pages.map((item) => item.id));
    const result = await invoke('command', {
      type: 'page.add',
      name: `页面 ${project.pages.length + 1}`,
    });
    const created = result?.project?.pages.find((item) => !before.has(item.id));
    if (created) dispatch({ type: 'select-page', pageId: created.id });
  }
  async function addLayer(kind: 'text' | 'image', assetId?: string) {
    if (!page) return;
    const ids = new Set(page.layers.map((item) => item.id));
    const result = await invoke('command', {
      type: 'layer.add',
      pageId: page.id,
      kind,
      assetId,
    });
    const created = result?.project?.pages
      .find((item) => item.id === page.id)
      ?.layers.find((item) => !ids.has(item.id));
    if (created) dispatch({ type: 'select-layer', layerId: created.id });
  }
  function addText() {
    if (!page) return;
    dispatch({ type: 'mode', mode: 'page' });
    void addLayer('text');
  }
  function addImage() {
    if (!page) return;
    dispatch({ type: 'library-tab', tab: 'assets' });
    dispatch({ type: 'mode', mode: 'page' });
  }
  async function importAssets() {
    const result = await invoke('import');
    if (result?.results) {
      const failures = result.results.filter((item) => !item.ok);
      setMessage(
        `导入成功 ${result.results.length - failures.length} 个${failures.length ? '；失败 ' + failures.map((item) => item.path + '：' + item.error).join('；') : ''}`,
      );
      dispatch({ type: 'library-tab', tab: 'assets' });
    }
  }
  async function start(id: string | null) {
    if (!project || !id) return;
    audition.stop();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const latest = await invoke('state');
    if (latest?.project?.pages.some((candidate) => candidate.id === id))
      setPreview({ snapshot: structuredClone(latest.project), startId: id });
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const intent = globalKeyIntent(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          targetTag: target?.tagName,
        },
        { preview: !!preview, leaveOpen: !!leave },
      );
      if (intent === 'exit-preview') {
        setPreview(null);
        return;
      }
      if (intent === 'save') {
        e.preventDefault();
        void invoke('save');
        return;
      }
      if (intent === 'undo' || intent === 'redo') {
        e.preventDefault();
        void invoke(intent);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [preview, leave, invoke]);

  const leaveDialog = leave ? (
    <LeaveDialog
      key={leave.prompt.id}
      prompt={leave.prompt}
      busy={leave.busy}
      error={leave.error}
      onSave={() => answer('save')}
      onDiscard={() => answer('discard')}
      onCancel={() => answer('cancel')}
    />
  ) : null;

  if (preview)
    return (
      <div className="app player-shell">
        <WindowTitleBar projectName={project?.name} dirty={state.dirty} />
        <Player
          snapshot={preview.snapshot}
          startId={preview.startId}
          currentRevision={project?.revision ?? 0}
          missing={state.missing}
          onClose={() => setPreview(null)}
        />
        {error && <div className="toast error">{error}</div>}
        {leaveDialog}
      </div>
    );

  return (
    <div className="app">
      <WindowTitleBar projectName={project?.name} dirty={state.dirty} />
      {(error || message) && (
        <div role="status" className={`banner ${error ? 'error' : ''}`}>
          <span>{error || message}</span>
          <button onClick={clearBanner}>关闭</button>
        </div>
      )}
      {!project ? (
        <main className="welcome">
          <span className="eyebrow">从一页开始，让故事有自己的方向</span>
          <h1>把想象，连成故事。</h1>
          <p>安排每一页的画面与声音，用选择连接不同的旅程。</p>
          <div className="welcome-cards">
            <article>
              <span>01 / 编排</span>
              <h2>看得见的故事路径</h2>
              <p>卡片、分支与回连，让叙事结构一目了然。</p>
            </article>
            <article>
              <span>02 / 创作</span>
              <h2>专注每一页的表达</h2>
              <p>图片、文字、声音与轻盈的动画。</p>
            </article>
            <article>
              <span>03 / 协作</span>
              <h2>与你的 Agent 一起</h2>
              <p>由你掌握编辑，外部 AI 通过工具协助。</p>
            </article>
          </div>
          <button className="primary large" onClick={openNew}>
            ＋ 创建第一个工程
          </button>
          <button className="large" onClick={openProject}>
            打开已有工程
          </button>
          <RecentProjects onOpen={openRecent} />
        </main>
      ) : (
        <>
          <CommandRibbon
            group={commandGroup}
            theme={theme}
            onTheme={(next) => setTheme(next)}
            onGroup={(group) => dispatch({ type: 'command-group', group })}
            mode={mode}
            page={page ?? null}
            layer={layer ?? null}
            project={project}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onCommand={command}
            onNew={openNew}
            onOpen={openProject}
            onSave={() => void invoke('save')}
            onUndo={() => void invoke('undo')}
            onRedo={() => void invoke('redo')}
            onAddPage={addPage}
            onAddText={addText}
            onAddImage={addImage}
            onImport={importAssets}
            onPreview={start}
            onShowFlow={showFlow}
            onShowPage={() => {
              if (page) dispatch({ type: 'mode', mode: 'page' });
            }}
            onFit={flowView.requestFit}
            onArrange={flowView.requestArrange}
          />
          {mode === 'flow' ? (
            <div className="flow-layout">
              <FlowWorkspace
                project={project}
                selectedPageId={pageId}
                selectedPageIds={selectedPageIds}
                selectedEdgeId={edgeId}
                missing={state.missing}
                view={flowView.view}
                flowRef={flowRef}
                fitEpoch={flowView.fitEpoch}
                arrangeEpoch={flowView.arrangeEpoch}
                onSelectPage={(id, additive) =>
                  dispatch({ type: 'select-page', pageId: id, additive })
                }
                onSelectPages={(pageIds) => dispatch({ type: 'select-pages', pageIds })}
                onClearSelection={() => dispatch({ type: 'clear-selection' })}
                onEditPage={edit}
                onSelectEdge={(id, pageId) => dispatch({ type: 'select-edge', pageId, edgeId: id })}
                onMovePages={(updates) => command({ type: 'pages.move', updates })}
                onConnect={(source, exitId, target) =>
                  command({ type: 'exit.patch', pageId: source, exitId, target })
                }
                onAddPage={addPage}
              />
              <FlowInspector
                project={project}
                page={page ?? null}
                selectedPages={selectedPages}
                hasEdge={!!edge}
                selectedEdgeId={edgeId}
                approvedRoots={state.approvedRoots}
                onCommand={command}
                onEditPage={edit}
                onDeletePage={() => setDeleting(true)}
                onSelectAll={() =>
                  dispatch({ type: 'select-pages', pageIds: project.pages.map((item) => item.id) })
                }
                onClearSelection={() => dispatch({ type: 'clear-selection' })}
                onApprove={() => void invoke('approve')}
              />
            </div>
          ) : (
            page && (
              <PageWorkspace
                project={project}
                page={page}
                layer={layer}
                selectedLayerId={layerId}
                tab={libraryTab}
                missing={state.missing}
                onTab={(tab) => dispatch({ type: 'library-tab', tab })}
                onSelectLayer={(id) => dispatch({ type: 'select-layer', layerId: id })}
                onAddLayer={addLayer}
                onImport={importAssets}
                onPlay={audition.play}
                onStop={audition.stop}
                onCommand={command}
              />
            )
          )}
          <footer className="statusbar">
            <span>{state.root}</span>
            <span>
              {state.missing.length
                ? `⚠ ${state.missing.length} 个素材缺失 · 请替换引用`
                : `${project.assets.length} 个素材`}
              {!project.startPageId ? ' · 尚未设置起点' : ''}
            </span>
          </footer>
        </>
      )}
      {newDialog && (
        <NewProjectDialog
          error={error}
          onClose={() => setNewDialog(false)}
          onCreate={createProject}
        />
      )}
      {deleting && page && project && (
        <DeletePageDialog
          project={project}
          page={page}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await invoke('command', { type: 'page.delete', pageId: page.id });
            setDeleting(false);
          }}
        />
      )}
      {leaveDialog}
    </div>
  );
}
