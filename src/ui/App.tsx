import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  type NodeProps,
  type Node,
  type Viewport,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { issues, type Project, type Page, type Layer, type Command } from '../core/project';
import { type State, assetURL } from './api';
import { Scene, Player } from './Scene';
import { LeaveDialog } from './LeaveDialog';
import { RecentProjects } from './RecentProjects';
import { globalKeyIntent, leaveReducer, type LeaveChoice, type LeaveState } from './leave';
import { classifyEdge, EDGE_DIRECTION_COLORS, type EdgeDirection } from './edge-direction';
import { WindowTitleBar } from './WindowTitleBar';
const commandGroups = ['文件', '开始', '插入', '转场', '动画', '视图'] as const;
type CommandGroup = (typeof commandGroups)[number];
type CardData = {
  page: Page;
  project: Project;
  warnings: string[];
  missing: string[];
  onEdit: (id: string) => void;
};
function PageCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { page, project, warnings, missing, onEdit } = data;
  return (
    <div className={`page-card ${selected ? 'active' : ''}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <div className="card-heading">
        <span className="card-number">
          {String(project.pages.findIndex((x) => x.id === page.id) + 1).padStart(2, '0')}
        </span>
        <strong>{page.name}</strong>
        {project.startPageId === page.id && <span className="start-tag">起点</span>}
      </div>
      <div className="card-preview" onDoubleClick={() => onEdit(page.id)}>
        <Scene project={project} page={page} missing={missing} />
      </div>
      <div className="card-actions">
        <button className="nodrag" onClick={() => onEdit(page.id)}>
          编辑页面 ↗
        </button>
        <span title={warnings.join('、')} className={warnings.length ? 'warning' : 'muted'}>
          {warnings.length ? '待完善' : '页面就绪'}
        </span>
      </div>
      {page.exits.map((e, i) => (
        <div className="exit-port" key={e.id}>
          <span>
            {String(i + 1).padStart(2, '0')} · {e.label || '继续'}
          </span>
          <Handle type="source" id={e.id} position={Position.Right} style={{ top: '50%' }} />
        </div>
      ))}
    </div>
  );
}
const nodeTypes = { page: PageCard };
const empty: State = {
  project: null,
  root: '',
  dirty: false,
  canUndo: false,
  canRedo: false,
  missing: [],
  approvedRoots: [],
};
function Field({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        key={String(value)}
        type={type}
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(e) => {
          const v = type === 'number' ? Number(e.target.value) : e.target.value;
          if (v !== value) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function RibbonGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={title}>
      <div className="ribbon-group-controls">{children}</div>
      <span className="ribbon-group-title">{title}</span>
    </div>
  );
}
export function App() {
  const [state, setState] = useState(empty),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [mode, setMode] = useState<'flow' | 'page'>('flow'),
    [selected, setSelected] = useState(''),
    [layerId, setLayerId] = useState(''),
    [edgeId, setEdgeId] = useState(''),
    [nodes, setNodes] = useState<Node<CardData>[]>([]),
    [newDialog, setNewDialog] = useState(false),
    [newName, setNewName] = useState('我的互动绘本'),
    [size, setSize] = useState('1280x720'),
    [dims, setDims] = useState({ width: '1280', height: '720' }),
    [newError, setNewError] = useState(''),
    [deleting, setDeleting] = useState(false),
    [preview, setPreview] = useState<{ snapshot: Project; startId: string } | null>(null),
    [tab, setTab] = useState<'layers' | 'assets'>('layers'),
    [commandTab, setCommandTab] = useState<CommandGroup>('开始');
  const [leave, dispatchLeave] = useReducer(leaveReducer, null);
  const leaveRef = useRef<LeaveState>(null);
  const viewport = useRef<Viewport>({ x: 40, y: 40, zoom: 0.8 });
  const flow = useRef<ReactFlowInstance<Node<CardData>, any> | null>(null);
  const fitted = useRef('');
  const audition = useRef<HTMLAudioElement | null>(null);
  const project = state.project,
    page = project?.pages.find((p) => p.id === selected),
    layer = page?.layers.find((l) => l.id === layerId);
  const missingSet = useMemo(() => new Set(state.missing), [state.missing]);
  const imageMissing = (l: Layer) =>
    l.type === 'image' &&
    (!l.assetId || !project?.assets.some((a) => a.id === l.assetId) || missingSet.has(l.assetId));
  async function invoke(action: string, payload?: unknown) {
    setError('');
    if (action === 'open' || action === 'new') stopAudition();
    try {
      const r = await window.studio.invoke(action, payload);
      if (!r.ok) throw Error(r.error);
      if (r.value?.project !== undefined) setState(r.value);
      if (r.value?.recentWarning) setMessage(r.value.recentWarning);
      return r.value;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (action === 'new') setNewError(message);
      return null;
    }
  }
  async function openRecent(path: string) {
    setError('');
    setMessage('');
    stopAudition();
    const r = await window.studio.invoke('recent-open', path);
    if (!r.ok) throw Error(r.error || '无法打开最近工程');
    if (!r.value?.project) return false;
    setState(r.value);
    if (r.value.recentWarning) setMessage(r.value.recentWarning);
    setMode('flow');
    setCommandTab('开始');
    setSelected('');
    setLayerId('');
    setEdgeId('');
    viewport.current = { x: 40, y: 40, zoom: 0.8 };
    flow.current?.setViewport({ x: 40, y: 40, zoom: 0.8 });
    return true;
  }
  const command = (c: Command) => invoke('command', c);
  function edit(id: string) {
    setSelected(id);
    setLayerId('');
    setMode('page');
    setCommandTab('开始');
    setEdgeId('');
  }
  function showFlow() {
    setMode('flow');
    stopAudition();
  }
  function showPage() {
    if (page) setMode('page');
  }
  function stopAudition() {
    if (audition.current) {
      audition.current.pause();
      audition.current.src = '';
      audition.current = null;
    }
  }
  function play(id: string) {
    stopAudition();
    if (!project) return;
    const a = new Audio(assetURL(project, id));
    audition.current = a;
    a.play().catch(() => setError('无法试听此素材，请检查文件。'));
  }
  async function start(id: string | null) {
    if (!project || !id) return;
    stopAudition();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const latest = await invoke('state');
    if (latest?.project?.pages.some((p: Page) => p.id === id))
      setPreview({ snapshot: structuredClone(latest.project), startId: id });
  }
  function openNew() {
    setNewError('');
    setNewDialog(true);
  }
  function answerLeave(choice: LeaveChoice) {
    if (!leave || leave.busy) return;
    const id = leave.prompt.id;
    if (choice === 'cancel') {
      dispatchLeave({ type: 'cancel' });
      window.studio.respondLeave(id, choice);
      return;
    }
    dispatchLeave({ type: 'responding' });
    try {
      window.studio.respondLeave(id, choice);
    } catch {
      dispatchLeave({
        type: 'result',
        result: { id, ok: false, error: '无法提交保存确认，请重试。' },
      });
    }
  }
  function fitFlow() {
    const inst = flow.current;
    if (!inst) return;
    let tries = 0;
    const run = () => {
      const ns = inst.getNodes();
      if (ns.length && ns.every((n) => n.measured?.width && n.measured?.height)) {
        inst.fitView({ padding: 0.2, maxZoom: 1 });
        return;
      }
      if (++tries < 40) setTimeout(run, 50);
    };
    run();
  }
  useEffect(() => {
    leaveRef.current = leave;
  }, [leave]);
  useEffect(() => {
    invoke('state');
    const off = window.studio.subscribe(setState);
    const offLeave = window.studio.onLeaveRequest((prompt) => {
      setError('');
      dispatchLeave({ type: 'request', prompt });
    });
    const offResult = window.studio.onLeaveResult((result) => {
      dispatchLeave({ type: 'result', result });
      if (result.closed && !result.ok && leaveRef.current?.prompt.id === result.id)
        setError(result.error || '操作已取消。');
    });
    return () => {
      off();
      offLeave();
      offResult();
      stopAudition();
    };
  }, []);
  useEffect(() => {
    if (!project) return;
    const warnings = issues(project);
    setNodes(
      project.pages.map((p) => ({
        id: p.id,
        type: 'page',
        position: p.position,
        selected: p.id === selected,
        data: {
          page: p,
          project,
          warnings: warnings.get(p.id) ?? [],
          missing: state.missing,
          onEdit: edit,
        },
      })),
    );
    if (selected && !project.pages.some((p) => p.id === selected)) {
      setSelected('');
      setLayerId('');
      setMode('flow');
    }
  }, [project, selected, state.missing]);
  useEffect(() => {
    if (!project || fitted.current === project.id) return;
    if (!project.pages.length) {
      fitted.current = project.id;
      return;
    }
    const id = project.id;
    const t = setTimeout(() => {
      fitFlow();
      fitted.current = id;
    }, 60);
    return () => clearTimeout(t);
  }, [project?.id, project?.pages.length, nodes.length]);
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
        invoke('save');
        return;
      }
      if (intent === 'undo' || intent === 'redo') {
        e.preventDefault();
        invoke(intent);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [preview, leave]);
  const edges = useMemo(
    () =>
      project?.pages.flatMap((p) =>
        p.exits
          .filter((e) => e.target)
          .map((e) => {
            const direction = classifyEdge(project, p.id, e.target!);
            const stroke = EDGE_DIRECTION_COLORS[direction];
            const selected = e.id === edgeId;
            return {
              id: e.id,
              source: p.id,
              target: e.target!,
              sourceHandle: e.id,
              targetHandle: 'in',
              label: e.label || '继续',
              selected,
              className: selected ? 'edge-selected' : undefined,
              data: { direction },
              style: { stroke, strokeWidth: selected ? 3 : 2 },
              labelStyle: { fill: stroke, fontWeight: selected ? 700 : 400 },
              markerEnd: { type: 'arrowclosed' as any, color: stroke },
            };
          }),
      ) ?? [],
    [project, edgeId],
  );
  async function addPage() {
    if (!project) return;
    const before = new Set(project.pages.map((p) => p.id));
    const s = await command({ type: 'page.add', name: `页面 ${project.pages.length + 1}` });
    const p = s?.project?.pages.find((p: Page) => !before.has(p.id));
    if (p) setSelected(p.id);
  }
  function patchPage(patch: Partial<Page>) {
    if (page) command({ type: 'page.patch', pageId: page.id, patch });
  }
  function patchLayer(patch: Partial<Layer>) {
    if (page && layer) command({ type: 'layer.patch', pageId: page.id, layerId: layer.id, patch });
  }
  async function addLayer(kind: 'text' | 'image', assetId?: string) {
    if (!page) return;
    const ids = new Set(page.layers.map((l) => l.id));
    const s = await command({ type: 'layer.add', pageId: page.id, kind, assetId });
    const l = s?.project.pages
      .find((p: Page) => p.id === page.id)
      ?.layers.find((l: Layer) => !ids.has(l.id));
    if (l) setLayerId(l.id);
  }
  function addText() {
    if (!page) return;
    setMode('page');
    void addLayer('text');
  }
  function addImage() {
    if (!page) return;
    setTab('assets');
    setMode('page');
  }
  async function importAssets() {
    const r = await invoke('import');
    if (r?.results) {
      const failures = r.results.filter((x: any) => !x.ok);
      setMessage(
        `导入成功 ${r.results.length - failures.length} 个${failures.length ? '；失败 ' + failures.map((x: any) => x.path + '：' + x.error).join('；') : ''}`,
      );
      setTab('assets');
    }
  }
  const edgePage = project?.pages.find((p) => p.exits.some((e) => e.id === edgeId));
  const edge = edgePage?.exits.find((e) => e.id === edgeId);
  const leaveDialog = leave ? (
    <LeaveDialog
      key={leave.prompt.id}
      prompt={leave.prompt}
      busy={leave.busy}
      error={leave.error}
      onSave={() => answerLeave('save')}
      onDiscard={() => answerLeave('discard')}
      onCancel={() => answerLeave('cancel')}
    />
  ) : null;
  if (preview)
    return (
      <div className="app player-shell">
        <WindowTitleBar />
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
      <WindowTitleBar />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">绘</span>
          <div>
            <strong>绘境</strong>
            <small>交互叙事工作台</small>
          </div>
        </div>
        <div className="project-title">
          {project?.name || '开始一个新故事'}
          {project && <span className="save-status">{state.dirty ? '● 未保存' : '已保存'}</span>}
        </div>
        <div className="top-actions">
          <button onClick={openNew}>新建</button>
          <button onClick={() => invoke('open')}>打开</button>
          {project && (
            <>
              <button onClick={() => invoke('save')} title="Ctrl+S">
                保存
              </button>
              <button
                className="primary"
                disabled={!project.startPageId}
                onClick={() => start(project.startPageId)}
              >
                ▶ 从头预览
              </button>
            </>
          )}
        </div>
      </header>
      {(error || message) && (
        <div role="status" className={`banner ${error ? 'error' : ''}`}>
          <span>{error || message}</span>
          <button
            onClick={() => {
              setError('');
              setMessage('');
            }}
          >
            关闭
          </button>
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
          <button className="large" onClick={() => invoke('open')}>
            打开已有工程
          </button>
          <RecentProjects onOpen={openRecent} />
        </main>
      ) : (
        <>
          <nav className="command-tabs" role="tablist" aria-label="命令分组">
            {commandGroups.map((group) => (
              <button
                key={group}
                type="button"
                role="tab"
                id={`command-tab-${group}`}
                aria-controls="command-ribbon"
                aria-selected={commandTab === group}
                tabIndex={commandTab === group ? 0 : -1}
                className={`command-tab${commandTab === group ? ' active' : ''}`}
                onClick={() => setCommandTab(group)}
                onKeyDown={(event) => {
                  const index = commandGroups.indexOf(group);
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const next =
                    commandGroups[
                      (index + (event.key === 'ArrowRight' ? 1 : -1) + commandGroups.length) %
                        commandGroups.length
                    ];
                  setCommandTab(next);
                  document.getElementById(`command-tab-${next}`)?.focus();
                }}
              >
                {group}
              </button>
            ))}
            <div className="workspace-context">
              {mode === 'page' && page ? (
                <>
                  <button type="button" onClick={showFlow}>
                    ← 返回流程
                  </button>
                  <span className="divider" />
                  <strong>{page.name}</strong>
                </>
              ) : (
                <>
                  <span className="eyebrow">故事结构</span>
                  <strong>流程工作区</strong>
                  <span className="pill">{project.pages.length} 个页面</span>
                </>
              )}
            </div>
            <div className="workspace-switch" role="group" aria-label="工作区切换">
              <button
                type="button"
                className={mode === 'flow' ? 'active' : ''}
                aria-pressed={mode === 'flow'}
                onClick={showFlow}
              >
                ◇ 流程编排
              </button>
              <button
                type="button"
                className={mode === 'page' ? 'active' : ''}
                aria-pressed={mode === 'page'}
                disabled={!page}
                onClick={showPage}
              >
                ▣ 页面编辑
              </button>
            </div>
          </nav>
          <div
            id="command-ribbon"
            className="command-ribbon"
            role="tabpanel"
            aria-labelledby={`command-tab-${commandTab}`}
          >
            <div className="command-tools" role="toolbar" aria-label={`${commandTab}命令`}>
              {commandTab === '文件' && (
                <>
                  <RibbonGroup title="工程">
                    <button type="button" onClick={openNew}>
                      新建
                    </button>
                    <button type="button" onClick={() => invoke('open')}>
                      打开
                    </button>
                    <button type="button" onClick={() => invoke('save')}>
                      保存
                    </button>
                  </RibbonGroup>
                  <small className="muted">新建、打开或保存当前工程</small>
                </>
              )}
              {commandTab === '开始' && (
                <>
                  <RibbonGroup title="编辑历史">
                    <button
                      type="button"
                      disabled={!state.canUndo}
                      onClick={() => invoke('undo')}
                      title="Ctrl+Z"
                    >
                      撤销
                    </button>
                    <button
                      type="button"
                      disabled={!state.canRedo}
                      onClick={() => invoke('redo')}
                      title="Ctrl+Shift+Z"
                    >
                      重做
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="页面">
                    {mode === 'flow' ? (
                      <button type="button" className="primary" onClick={addPage}>
                        ＋ 新增页面
                      </button>
                    ) : (
                      <>
                        <button type="button" disabled={!page} onClick={addText}>
                          ＋ 添加文字
                        </button>
                        <button type="button" disabled={!page} onClick={addImage}>
                          ＋ 添加图片
                        </button>
                      </>
                    )}
                  </RibbonGroup>
                  <RibbonGroup title="素材">
                    <button type="button" onClick={importAssets}>
                      导入素材
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="预览">
                    <button type="button" disabled={!page} onClick={() => start(page?.id ?? null)}>
                      预览当前页
                    </button>
                  </RibbonGroup>
                  <small className="muted">
                    {mode === 'flow' ? '编排故事的路径与节奏' : '编辑页面中的内容与图层'}
                  </small>
                </>
              )}
              {commandTab === '插入' && (
                <>
                  <RibbonGroup title="内容">
                    <button type="button" disabled={!page} onClick={addText}>
                      ＋ 添加文字
                    </button>
                    <button type="button" disabled={!page} onClick={addImage}>
                      ＋ 添加图片
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="素材">
                    <button type="button" onClick={importAssets}>
                      导入素材
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="页面">
                    <button type="button" onClick={addPage}>
                      ＋ 新增页面
                    </button>
                  </RibbonGroup>
                  <small className="muted">
                    {page ? '把文字、图片与素材放进故事' : '先选择一张页面，再添加内容'}
                  </small>
                </>
              )}
              {commandTab === '转场' && (
                <>
                  <RibbonGroup title="预览">
                    <button
                      type="button"
                      disabled={!page}
                      title="在阅读预览中观察实际转场"
                      onClick={() => start(page?.id ?? null)}
                    >
                      预览当前页
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="页面转场">
                    {page ? (
                      <>
                        <label className="field ribbon-field">
                          <span>效果</span>
                          <select
                            aria-label="页面转场效果"
                            value={page.transition.type}
                            onChange={(e) =>
                              patchPage({
                                transition: {
                                  ...page.transition,
                                  type: e.target.value as 'none' | 'fade',
                                },
                              })
                            }
                          >
                            <option value="none">无</option>
                            <option value="fade">交叉淡化</option>
                          </select>
                        </label>
                        <span className="ribbon-placeholder">更多转场效果 · 后续填充</span>
                      </>
                    ) : (
                      <small className="muted">先选择一张页面</small>
                    )}
                  </RibbonGroup>
                  <RibbonGroup title="计时">
                    {page ? (
                      <Field
                        label="时长（秒）"
                        type="number"
                        min={0.1}
                        max={3}
                        step={0.1}
                        disabled={page.transition.type !== 'fade'}
                        value={page.transition.duration}
                        onChange={(duration) =>
                          patchPage({ transition: { ...page.transition, duration } })
                        }
                      />
                    ) : (
                      <small className="muted">先选择一张页面</small>
                    )}
                  </RibbonGroup>
                  <RibbonGroup title="换页方式">
                    <span className="ribbon-placeholder">自动换页 · 后续填充</span>
                  </RibbonGroup>
                </>
              )}
              {commandTab === '动画' && (
                <>
                  <RibbonGroup title="预览">
                    <button
                      type="button"
                      disabled={!page}
                      title="在阅读预览中观察图层进场动画"
                      onClick={() => start(page?.id ?? null)}
                    >
                      预览当前页
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="对象动画">
                    {layer ? (
                      <>
                        <label className="field ribbon-field">
                          <span>动作</span>
                          <select
                            aria-label="图层动画动作"
                            value={layer.effect.type}
                            onChange={(e) =>
                              patchLayer({
                                effect: {
                                  ...layer.effect,
                                  type: e.target.value as 'none' | 'fade',
                                },
                              })
                            }
                          >
                            <option value="none">无</option>
                            <option value="fade">淡入</option>
                          </select>
                        </label>
                        <span className="ribbon-placeholder">更多动画效果 · 后续填充</span>
                      </>
                    ) : (
                      <small className="muted">请先选择图层</small>
                    )}
                  </RibbonGroup>
                  <RibbonGroup title="计时">
                    {layer ? (
                      <Field
                        label="时长（秒）"
                        type="number"
                        min={0.1}
                        max={3}
                        step={0.1}
                        disabled={layer.effect.type !== 'fade'}
                        value={layer.effect.duration}
                        onChange={(duration) =>
                          patchLayer({ effect: { ...layer.effect, duration } })
                        }
                      />
                    ) : (
                      <small className="muted">请先选择图层</small>
                    )}
                  </RibbonGroup>
                  <RibbonGroup title="触发与排序">
                    <span className="ribbon-placeholder">触发条件与图层排序 · 后续填充</span>
                  </RibbonGroup>
                </>
              )}
              {commandTab === '视图' && (
                <>
                  <RibbonGroup title="工作区">
                    <button type="button" disabled={mode === 'flow'} onClick={showFlow}>
                      ◇ 流程编排
                    </button>
                    <button type="button" disabled={mode === 'page' || !page} onClick={showPage}>
                      ▣ 页面编辑
                    </button>
                  </RibbonGroup>
                  <RibbonGroup title="画布">
                    <button type="button" disabled={mode !== 'flow'} onClick={fitFlow}>
                      适应画布
                    </button>
                  </RibbonGroup>
                  <small className="muted">切换工作区与画布视图</small>
                </>
              )}
            </div>
          </div>
          {mode === 'flow' ? (
            <div className="flow-layout">
              <main className="flow-canvas">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  defaultViewport={viewport.current}
                  onInit={(inst) => {
                    flow.current = inst;
                  }}
                  onMove={(_, v) => {
                    viewport.current = v;
                  }}
                  onMoveEnd={(_, v) => {
                    viewport.current = v;
                  }}
                  onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes, n))}
                  onNodeClick={(_, n) => {
                    setSelected(n.id);
                    setEdgeId('');
                  }}
                  onNodeDoubleClick={(_, n) => edit(n.id)}
                  onNodeDragStop={(_, n) =>
                    command({ type: 'page.patch', pageId: n.id, patch: { position: n.position } })
                  }
                  onEdgeClick={(_, e) => {
                    setEdgeId(e.id);
                    const p = project.pages.find((p) => p.exits.some((x) => x.id === e.id));
                    if (p) setSelected(p.id);
                  }}
                  onConnect={(c) => {
                    if (c.source && c.target && c.sourceHandle)
                      command({
                        type: 'exit.patch',
                        pageId: c.source,
                        exitId: c.sourceHandle,
                        target: c.target,
                      });
                  }}
                  isValidConnection={(c) => c.source !== c.target}
                  deleteKeyCode={null}
                  minZoom={0.2}
                  maxZoom={1.5}
                >
                  <Background gap={24} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                {!project.pages.length && (
                  <div className="canvas-empty">
                    <h2>第一张页面，故事的起点</h2>
                    <p>新增页面，再拖动出口连接下一页。</p>
                    <button className="primary" onClick={addPage}>
                      ＋ 新增页面
                    </button>
                  </div>
                )}
                <div className="flow-legend" aria-label="连线方向图例">
                  {(
                    [
                      ['forward', '前进'],
                      ['loop', '循环'],
                      ['back', '后退'],
                    ] as const
                  ).map(([direction, label]) => (
                    <span key={direction}>
                      <i style={{ background: EDGE_DIRECTION_COLORS[direction] }} />
                      {label}
                    </span>
                  ))}
                </div>
                <div className="canvas-hint">拖动画布平移 · 滚轮缩放 · 双击卡片编辑页面</div>
              </main>
              <aside className="inspector">
                <div className="panel-title">{edge ? '连接属性' : '页面与出口'}</div>
                {page ? (
                  <>
                    <Field
                      label="页面名称"
                      value={page.name}
                      onChange={(name) => patchPage({ name })}
                    />
                    <div className="row">
                      <button onClick={() => edit(page.id)}>编辑页面 ↗</button>
                      <button
                        disabled={project.startPageId === page.id}
                        onClick={() => command({ type: 'start.set', pageId: page.id })}
                      >
                        {project.startPageId === page.id ? '当前起点' : '设为起点'}
                      </button>
                    </div>
                    <div className="section-heading">
                      <strong>选择出口</strong>
                      <button
                        onClick={() =>
                          command({
                            type: 'exit.add',
                            pageId: page.id,
                            label: page.exits.length ? '新的选择' : '继续',
                            target: null,
                          })
                        }
                      >
                        ＋ 新增
                      </button>
                    </div>
                    <p className="help">
                      每个出口对应一个阅读按钮。拖动卡片右侧圆点连接目标页，也可以在这里选择。
                    </p>
                    {page.exits.map((e) => (
                      <div
                        className={`exit-editor ${e.id === edgeId ? 'selected' : ''}`}
                        key={e.id}
                      >
                        <Field
                          label="按钮文字"
                          value={e.label}
                          onChange={(label) =>
                            command({ type: 'exit.patch', pageId: page.id, exitId: e.id, label })
                          }
                        />
                        <label className="field">
                          <span>前往页面</span>
                          <select
                            value={e.target ?? ''}
                            onChange={(ev) =>
                              command({
                                type: 'exit.patch',
                                pageId: page.id,
                                exitId: e.id,
                                target: ev.target.value || null,
                              })
                            }
                          >
                            <option value="">未连接</option>
                            {project.pages
                              .filter((p) => p.id !== page.id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className="text-danger"
                          onClick={() =>
                            command({ type: 'exit.delete', pageId: page.id, exitId: e.id })
                          }
                        >
                          删除出口
                        </button>
                      </div>
                    ))}
                    {!page.exits.length && (
                      <div className="empty-note">没有出口，这一页将作为故事终点。</div>
                    )}
                    <button className="danger full" onClick={() => setDeleting(true)}>
                      删除页面
                    </button>
                  </>
                ) : (
                  <div className="empty-note">选择一张页面卡片，编辑名称、起点与出口。</div>
                )}
                <div className="agent-panel">
                  <span className="eyebrow">外部 AI 协作</span>
                  <p>允许 Agent 从指定文件夹导入素材。工程修改会同步到这里。</p>
                  <button onClick={() => invoke('approve')}>授权素材文件夹</button>
                  <small>
                    {state.approvedRoots.length
                      ? `已授权 ${state.approvedRoots.length} 个文件夹`
                      : '尚未授权素材文件夹'}
                  </small>
                </div>
              </aside>
            </div>
          ) : (
            page && (
              <div className="editor-layout">
                <aside className="library">
                  <div className="tabs">
                    <button
                      className={tab === 'layers' ? 'active' : ''}
                      onClick={() => setTab('layers')}
                    >
                      图层
                    </button>
                    <button
                      className={tab === 'assets' ? 'active' : ''}
                      onClick={() => setTab('assets')}
                    >
                      素材
                    </button>
                  </div>
                  {tab === 'layers' ? (
                    <>
                      <p className="help padded">上方图层显示在前。隐藏后仍可从列表恢复。</p>
                      {[...page.layers].reverse().map((l) => (
                        <div className={`layer-row ${l.id === layerId ? 'active' : ''}`} key={l.id}>
                          <button className="layer-name" onClick={() => setLayerId(l.id)}>
                            <span>{l.type === 'image' ? '▧' : 'T'}</span>
                            {l.name}
                            {imageMissing(l) && (
                              <span className="layer-warn" title="图片文件缺失，需要替换">
                                ⚠
                              </span>
                            )}
                          </button>
                          {imageMissing(l) && (
                            <button
                              className="layer-replace"
                              title="在右侧替换这张图片"
                              onClick={() => setLayerId(l.id)}
                            >
                              替换
                            </button>
                          )}
                          <button
                            aria-label={`${l.visible ? '隐藏' : '显示'} ${l.name}`}
                            title={l.visible ? '隐藏图层' : '显示图层'}
                            onClick={() =>
                              command({
                                type: 'layer.patch',
                                pageId: page.id,
                                layerId: l.id,
                                patch: { visible: !l.visible },
                              })
                            }
                          >
                            {l.visible ? '◉' : '○'}
                          </button>
                        </div>
                      ))}
                      {!page.layers.length && (
                        <p className="empty-note">添加文字或从素材库选择图片，开始制作这一页。</p>
                      )}
                      <button className="full padded" onClick={() => setLayerId('')}>
                        页面属性
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="full" onClick={importAssets}>
                        ＋ 导入图片与音频
                      </button>
                      <div className="asset-list">
                        {project.assets.map((a) => (
                          <div className="asset-item" key={a.id}>
                            {a.kind === 'image' ? (
                              <img src={assetURL(project, a.id)} alt={a.name} />
                            ) : (
                              <div className="audio-icon">♫</div>
                            )}
                            <strong title={a.name}>{a.name}</strong>
                            <small>
                              {state.missing.includes(a.id)
                                ? '⚠ 素材缺失'
                                : a.kind === 'image'
                                  ? `${a.width} × ${a.height}`
                                  : `音频 · ${a.duration?.toFixed(1)} 秒`}
                            </small>
                            {a.kind === 'image' ? (
                              <button onClick={() => addLayer('image', a.id)}>添加到页面</button>
                            ) : (
                              <button onClick={() => play(a.id)}>试听</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button onClick={stopAudition}>停止试听</button>
                    </>
                  )}
                </aside>
                <main className="editor-canvas">
                  <div className="canvas-caption">
                    <span>{page.name}</span>
                    <span>
                      {project.width} × {project.height}
                    </span>
                  </div>
                  <Scene
                    project={project}
                    page={page}
                    missing={state.missing}
                    editing
                    selected={layerId}
                    onSelect={setLayerId}
                    onMove={(id, patch) =>
                      command({ type: 'layer.patch', pageId: page.id, layerId: id, patch })
                    }
                  />
                  <div className="canvas-hint">拖动图层定位 · 右下角调整尺寸 · Ctrl+Z 撤销</div>
                </main>
                <aside className="inspector">
                  <div className="panel-title">
                    {layer ? '图层属性' : '页面属性'}
                    {layer && <button onClick={() => setLayerId('')}>页面</button>}
                  </div>
                  {layer ? (
                    <>
                      <Field
                        label="图层名称"
                        value={layer.name}
                        onChange={(name) => patchLayer({ name })}
                      />
                      <div className="field-grid">
                        {(['x', 'y', 'width', 'height'] as const).map((key, i) => (
                          <Field
                            key={key}
                            label={['X', 'Y', '宽度', '高度'][i]}
                            type="number"
                            value={Math.round(layer[key])}
                            onChange={(v) => patchLayer({ [key]: v })}
                          />
                        ))}
                      </div>
                      {layer.type === 'text' ? (
                        <>
                          <label className="field">
                            <span>文字内容</span>
                            <textarea
                              key={layer.text}
                              defaultValue={layer.text}
                              onBlur={(e) => patchLayer({ text: e.target.value })}
                            />
                          </label>
                          <Field
                            label="字号"
                            type="number"
                            min={1}
                            max={500}
                            value={layer.fontSize}
                            onChange={(fontSize) => patchLayer({ fontSize })}
                          />
                          <Field
                            label="文字颜色"
                            type="color"
                            value={layer.color}
                            onChange={(color) => patchLayer({ color })}
                          />
                          <label className="field">
                            <span>对齐</span>
                            <select
                              value={layer.align}
                              onChange={(e) =>
                                patchLayer({ align: e.target.value as Layer['align'] })
                              }
                            >
                              <option value="left">左对齐</option>
                              <option value="center">居中</option>
                              <option value="right">右对齐</option>
                            </select>
                          </label>
                        </>
                      ) : (
                        <label className="field">
                          <span>替换图片</span>
                          <select
                            value={layer.assetId ?? ''}
                            onChange={(e) => patchLayer({ assetId: e.target.value })}
                          >
                            {(!layer.assetId ||
                              !project.assets.some((a) => a.id === layer.assetId)) && (
                              <option value={layer.assetId ?? ''}>⚠ 当前图片缺失</option>
                            )}
                            {project.assets
                              .filter((a) => a.kind === 'image')
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      {layer.type === 'image' && imageMissing(layer) && (
                        <p className="help">
                          图片文件缺失或引用失效：从上方图片列表选择其他素材即可替换。
                        </p>
                      )}
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={layer.visible}
                          onChange={(e) => patchLayer({ visible: e.target.checked })}
                        />
                        显示图层
                      </label>
                      <div className="section-heading">
                        <strong>进场动画</strong>
                      </div>
                      <label className="field">
                        <span>动作</span>
                        <select
                          value={layer.effect.type}
                          onChange={(e) =>
                            patchLayer({
                              effect: { ...layer.effect, type: e.target.value as 'none' | 'fade' },
                            })
                          }
                        >
                          <option value="none">无</option>
                          <option value="fade">淡入</option>
                        </select>
                      </label>
                      {layer.effect.type === 'fade' && (
                        <Field
                          label="时长（秒）"
                          type="number"
                          min={0.1}
                          max={3}
                          step={0.1}
                          value={layer.effect.duration}
                          onChange={(duration) =>
                            patchLayer({ effect: { ...layer.effect, duration } })
                          }
                        />
                      )}
                      <div className="row">
                        <button
                          onClick={() =>
                            command({
                              type: 'layer.move',
                              pageId: page.id,
                              layerId: layer.id,
                              delta: 1,
                            })
                          }
                        >
                          上移一层
                        </button>
                        <button
                          onClick={() =>
                            command({
                              type: 'layer.move',
                              pageId: page.id,
                              layerId: layer.id,
                              delta: -1,
                            })
                          }
                        >
                          下移一层
                        </button>
                      </div>
                      <button
                        className="danger full"
                        onClick={() =>
                          command({ type: 'layer.delete', pageId: page.id, layerId: layer.id })
                        }
                      >
                        删除图层
                      </button>
                    </>
                  ) : (
                    <>
                      <Field
                        label="页面名称"
                        value={page.name}
                        onChange={(name) => patchPage({ name })}
                      />
                      <Field
                        label="背景颜色"
                        type="color"
                        value={page.background}
                        onChange={(background) => patchPage({ background })}
                      />
                      <div className="section-heading">
                        <strong>页面转场</strong>
                      </div>
                      <label className="field">
                        <span>效果</span>
                        <select
                          value={page.transition.type}
                          onChange={(e) =>
                            patchPage({
                              transition: {
                                ...page.transition,
                                type: e.target.value as 'none' | 'fade',
                              },
                            })
                          }
                        >
                          <option value="none">无</option>
                          <option value="fade">交叉淡化</option>
                        </select>
                      </label>
                      {page.transition.type === 'fade' && (
                        <Field
                          label="时长（秒）"
                          type="number"
                          min={0.1}
                          max={3}
                          step={0.1}
                          value={page.transition.duration}
                          onChange={(duration) =>
                            patchPage({ transition: { ...page.transition, duration } })
                          }
                        />
                      )}
                      <div className="section-heading">
                        <strong>页面音频</strong>
                      </div>
                      {(['music', 'voice'] as const).map((kind) => (
                        <div className="audio-track" key={kind}>
                          <strong>{kind === 'music' ? '♫ 背景音频' : '♩ 人物配音'}</strong>
                          <small>
                            {kind === 'music' ? '进入页面循环播放' : '进入页面播放一次'}
                          </small>
                          <select
                            aria-label={kind === 'music' ? '背景音频' : '人物配音'}
                            value={page[kind]?.assetId ?? ''}
                            onChange={(e) =>
                              patchPage({
                                [kind]: e.target.value
                                  ? { assetId: e.target.value, volume: page[kind]?.volume ?? 0.8 }
                                  : null,
                              })
                            }
                          >
                            <option value="">未绑定音频</option>
                            {project.assets
                              .filter((a) => a.kind === 'audio')
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                          {page[kind] && (
                            <>
                              <Field
                                label="音量 0—1"
                                type="number"
                                min={0}
                                max={1}
                                step={0.1}
                                value={page[kind]!.volume}
                                onChange={(volume) =>
                                  patchPage({ [kind]: { ...page[kind]!, volume } })
                                }
                              />
                              <div className="row">
                                <button onClick={() => play(page[kind]!.assetId)}>试听</button>
                                <button onClick={stopAudition}>停止</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </aside>
              </div>
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
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              const width = Number(dims.width),
                height = Number(dims.height);
              if (
                !Number.isInteger(width) ||
                !Number.isInteger(height) ||
                width < 200 ||
                width > 4096 ||
                height < 200 ||
                height > 4096
              ) {
                setNewError('宽度和高度需为 200–4096 之间的整数。');
                return;
              }
              const result = await invoke('new', { name: newName, width, height });
              if (result) {
                setNewDialog(false);
                setNewError('');
                setMode('flow');
                setCommandTab('开始');
                setSelected('');
                viewport.current = { x: 40, y: 40, zoom: 0.8 };
                flow.current?.setViewport({ x: 40, y: 40, zoom: 0.8 });
              }
            }}
          >
            <span className="eyebrow">新的创作</span>
            <h2>给故事一个起点</h2>
            <label className="field">
              <span>工程名称</span>
              <input
                autoFocus
                required
                maxLength={300}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>页面尺寸</span>
              <select
                value={size}
                onChange={(e) => {
                  const v = e.target.value;
                  setSize(v);
                  setNewError('');
                  if (v !== 'custom') {
                    const [w, h] = v.split('x').map(Number);
                    setDims({ width: String(w), height: String(h) });
                  }
                }}
              >
                <option value="1280x720">横向 · 1280 × 720</option>
                <option value="720x1280">纵向 · 720 × 1280</option>
                <option value="1024x1024">方形 · 1024 × 1024</option>
                <option value="custom">自定义尺寸</option>
              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                <span>宽度（200–4096）</span>
                <input
                  type="number"
                  min={200}
                  max={4096}
                  step={1}
                  inputMode="numeric"
                  value={dims.width}
                  onChange={(e) => {
                    setDims((d) => ({ ...d, width: e.target.value }));
                    setSize('custom');
                  }}
                />
              </label>
              <label className="field">
                <span>高度（200–4096）</span>
                <input
                  type="number"
                  min={200}
                  max={4096}
                  step={1}
                  inputMode="numeric"
                  value={dims.height}
                  onChange={(e) => {
                    setDims((d) => ({ ...d, height: e.target.value }));
                    setSize('custom');
                  }}
                />
              </label>
            </div>
            {newError && (
              <p className="form-error" role="alert">
                {newError}
              </p>
            )}
            <p className="help">下一步选择工程文件夹。页面共用此尺寸，创建后不再更改。</p>
            <div className="row end">
              <button type="button" onClick={() => setNewDialog(false)}>
                取消
              </button>
              <button className="primary" type="submit">
                选择位置并创建
              </button>
            </div>
          </form>
        </div>
      )}
      {deleting && page && project && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>删除“{page.name}”？</h2>
            <p>
              将同时删除{' '}
              {page.exits.length +
                project.pages
                  .filter((p) => p.id !== page.id)
                  .flatMap((p) => p.exits)
                  .filter((e) => e.target === page.id).length}{' '}
              条关联出口。可通过撤销恢复。
              {project.startPageId === page.id ? '删除后需要重新设置起点。' : ''}
            </p>
            <div className="row end">
              <button onClick={() => setDeleting(false)}>取消</button>
              <button
                className="danger"
                onClick={async () => {
                  await command({ type: 'page.delete', pageId: page.id });
                  setDeleting(false);
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
      {leaveDialog}
    </div>
  );
}
