import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { issues, type Page, type Project } from '../core/project';
import { Scene } from './Scene';
import { classifyEdge, EDGE_DIRECTION_COLORS } from './edge-direction';
import { rememberViewport, type FlowViewStore } from './flow-view';

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
export type FlowInstance = ReactFlowInstance<Node<CardData>, any>;

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
        position: p.position,
        selected: p.id === selectedPageId,
        data: {
          page: p,
          project,
          warnings: warnings.get(p.id) ?? [],
          missing,
          onEdit: onEditPage,
        },
      })),
    );
  }, [project, selectedPageId, missing, onEditPage]);

  const edges = useMemo(
    () =>
      project.pages.flatMap((p) =>
        p.exits
          .filter((e) => e.target)
          .map((e) => {
            const direction = classifyEdge(project, p.id, e.target!);
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
      ),
    [project, selectedEdgeId],
  );

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
        onNodeDragStop={(_, n) => onMovePage(n.id, n.position)}
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
  );
}
