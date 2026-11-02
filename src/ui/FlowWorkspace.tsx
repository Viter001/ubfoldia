import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  ViewportPortal,
  applyNodeChanges,
  useStore,
  useViewport,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { issues, type Page, type Project } from '../core/project';
import { Scene } from './Scene';
import {
  EDGE_CYCLE_NOTE,
  EDGE_DIRECTION_COLORS,
  EDGE_DIRECTION_LEGEND,
  createEdgeClassifier,
} from './edge-direction';
import { rememberViewport, type FlowViewStore } from './flow-view';
import {
  FLOW_COLUMN_STEP_X,
  flowColumnRange,
  levelForX,
  snapXToColumn,
  xForColumnIndex,
} from './flow-layout';

type CardData = {
  page: Page;
  project: Project;
  warnings: string[];
  missing: string[];
  level: number;
  onEdit: (id: string) => void;
};

const PAGE_CARD_BASE_HEIGHT = 240;
const PAGE_EXIT_HEIGHT = 34;

function PageCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { page, project, warnings, missing, level, onEdit } = data;
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
      <div className="page-level">第 {level} 层</div>
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
export type FlowInstance = ReactFlowInstance<Node<CardData>, any>;

/**
 * Decorative level columns live in the React Flow viewport portal, so they pan
 * and zoom exactly like the cards but are not nodes and never enter fitView.
 * pointer-events stay off; the visible range plus existing node columns is
 * bounded by the pure flowColumnRange helper.
 */
function FlowColumns({ project }: { project: Project }) {
  const viewport = useViewport();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const positions = useMemo(
    () =>
      project.pages.map((page) => ({
        x: page.position.x,
        y: page.position.y,
        height: PAGE_CARD_BASE_HEIGHT + page.exits.length * PAGE_EXIT_HEIGHT,
      })),
    [project.pages],
  );
  const range = flowColumnRange({ viewport, width, height, positions });
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const visibleTop = -viewport.y / zoom;
  const labelTop = Math.max(range.top, visibleTop) + 8 / zoom;
  const columns = [];
  for (let index = range.start; index <= range.end; index++) columns.push(index);

  return (
    <ViewportPortal>
      <div
        className="flow-columns"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: -1,
          pointerEvents: 'none',
        }}
      >
        {columns.map((index) => (
          <div
            key={index}
            className="flow-column"
            data-level={index + 1}
            style={{
              position: 'absolute',
              left: xForColumnIndex(index),
              top: range.top,
              width: FLOW_COLUMN_STEP_X,
              height: range.bottom - range.top,
            }}
          >
            <span className="flow-column-label" style={{ top: labelTop - range.top }}>
              第 {index + 1} 层
            </span>
          </div>
        ))}
      </div>
    </ViewportPortal>
  );
}

export function FlowWorkspace({
  project,
  selectedPageId,
  selectedEdgeId,
  missing,
  view,
  flowRef,
  fitEpoch,
  onSelectPage,
  onEditPage,
  onSelectEdge,
  onMovePage,
  onConnect,
  onAddPage,
}: {
  project: Project;
  selectedPageId: string;
  selectedEdgeId: string;
  missing: string[];
  view: FlowViewStore;
  flowRef: { current: FlowInstance | null };
  fitEpoch: number;
  onSelectPage: (pageId: string) => void;
  onEditPage: (pageId: string) => void;
  onSelectEdge: (edgeId: string, pageId: string) => void;
  onMovePage: (pageId: string, position: { x: number; y: number }) => void;
  onConnect: (source: string, exitId: string, target: string) => void;
  onAddPage: () => void;
}) {
  const [nodes, setNodes] = useState<Node<CardData>[]>([]);
  const lastFit = useRef(fitEpoch);

  useEffect(() => {
    const warnings = issues(project);
    setNodes(
      project.pages.map((p) => ({
        id: p.id,
        type: 'page',
        // Old projects keep their stored x; the canvas only projects it onto
        // the nearest column. Nothing is written until the user drags.
        position: { x: snapXToColumn(p.position.x), y: p.position.y },
        selected: p.id === selectedPageId,
        data: {
          page: p,
          project,
          warnings: warnings.get(p.id) ?? [],
          missing,
          level: levelForX(p.position.x),
          onEdit: onEditPage,
        },
      })),
    );
  }, [project, selectedPageId, missing, onEditPage]);

  const edges = useMemo(() => {
    const classify = createEdgeClassifier(project);
    return project.pages.flatMap((p) =>
      p.exits
        .filter((e) => e.target)
        .map((e) => {
          const direction = classify(p.id, e.target!);
          const stroke = EDGE_DIRECTION_COLORS[direction];
          const selected = e.id === selectedEdgeId;
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
    );
  }, [project, selectedEdgeId]);

  function fitFlow() {
    const inst = flowRef.current;
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
    if (fitEpoch === lastFit.current) return;
    lastFit.current = fitEpoch;
    fitFlow();
  }, [fitEpoch]);

  useEffect(
    () => () => {
      flowRef.current = null;
    },
    [flowRef],
  );

  return (
    <main className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={view.viewport}
        onInit={(inst) => {
          flowRef.current = inst;
          // Remounts after the page workspace or preview must reuse the last
          // recorded framing instead of starting from a fresh fit.
          inst.setViewport({ ...view.viewport });
        }}
        onMove={(_, v) => {
          rememberViewport(view, v);
        }}
        onMoveEnd={(_, v) => {
          rememberViewport(view, v);
        }}
        onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes, n))}
        onNodeClick={(_, n) => onSelectPage(n.id)}
        onNodeDoubleClick={(_, n) => onEditPage(n.id)}
        onNodeDragStop={(_, n) => {
          const position = { x: snapXToColumn(n.position.x), y: n.position.y };
          const stored = project.pages.find((page) => page.id === n.id)?.position;
          if (stored && stored.x === position.x && stored.y === position.y) return;
          if (position.x !== n.position.x) {
            setNodes((current) =>
              current.map((node) => (node.id === n.id ? { ...node, position } : node)),
            );
          }
          // Only the dragged page's snapped x and preserved y are committed;
          // exits, targets and playback semantics never enter this patch.
          onMovePage(n.id, position);
        }}
        onEdgeClick={(_, e) => {
          const p = project.pages.find((candidate) => candidate.exits.some((x) => x.id === e.id));
          if (p) onSelectEdge(e.id, p.id);
        }}
        onConnect={(c) => {
          if (c.source && c.target && c.sourceHandle) onConnect(c.source, c.sourceHandle, c.target);
        }}
        isValidConnection={(c) => c.source !== c.target}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <FlowColumns project={project} />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!project.pages.length && (
        <div className="canvas-empty">
          <h2>第一张页面，故事的起点</h2>
          <p>新增页面，再拖动出口连接下一页。</p>
          <button className="primary" onClick={onAddPage}>
            ＋ 新增页面
          </button>
        </div>
      )}
      <div className="flow-legend" aria-label="连线方向图例">
        {EDGE_DIRECTION_LEGEND.map(({ direction, label }) => (
          <span key={direction} data-direction={direction}>
            <i style={{ background: EDGE_DIRECTION_COLORS[direction] }} />
            {label}
          </span>
        ))}
        <small className="flow-legend-note">{EDGE_CYCLE_NOTE}</small>
      </div>
      <div className="canvas-hint">拖动画布平移 · 滚轮缩放 · 双击卡片编辑页面</div>
    </main>
  );
}
