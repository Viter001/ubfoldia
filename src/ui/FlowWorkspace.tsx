import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  useStore,
  useViewport,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
  type Viewport,
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
  FLOW_ARRANGE_GAP,
  FLOW_ARRANGE_START_Y,
  FLOW_COLUMN_STEP_X,
  arrangeFlowCards,
  clampFlowViewport,
  columnIndexForX,
  flowColumnRange,
  levelForX,
  resolveVerticalCollisions,
  snapXToColumn,
  snapYToAdjacentCard,
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
const PAGE_CARD_WIDTH = 244;

function PageCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { page, project, warnings, missing, level, onEdit } = data;
  return (
    <div className={`page-card ${selected ? 'active' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="flow-target-handle"
        data-page-id={page.id}
        aria-label={`连接到「${page.name}」`}
        title="把连线拖到这里以连接本页"
      />
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
          <Handle
            type="source"
            id={e.id}
            position={Position.Right}
            className="flow-source-handle"
            data-page-id={page.id}
            data-exit-id={e.id}
            aria-label={`从「${e.label || '继续'}」出口拖出连线`}
            title="从这里拖出连线到目标页"
            style={{ top: '50%' }}
          />
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

/**
 * MiniMap draws its mask as one SVG path containing both the minimap outer
 * rectangle and the viewport rectangle. Styling that path strokes both rings,
 * so this portal adds a single, dedicated viewport frame instead.
 */
function MiniMapViewportFrame() {
  const viewport = useViewport();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const nodeCount = useStore((state) => state.nodes.length);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.flow-minimap'));
  }, []);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!host || !frame) return;
    const svg = host.querySelector<SVGSVGElement>('.react-flow__minimap-svg');
    const viewBox = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (
      !svg ||
      !viewBox ||
      viewBox.length !== 4 ||
      viewBox.some((value) => !Number.isFinite(value))
    )
      return;
    const [x, y, width, height] = viewBox;
    const svgBox = svg.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const worldWidth = canvasWidth / viewport.zoom;
    const worldHeight = canvasHeight / viewport.zoom;
    const viewX = -viewport.x / viewport.zoom;
    const viewY = -viewport.y / viewport.zoom;
    frame.style.left = `${((viewX - x) / width) * svgBox.width + svgBox.left - hostBox.left}px`;
    frame.style.top = `${((viewY - y) / height) * svgBox.height + svgBox.top - hostBox.top}px`;
    frame.style.width = `${(worldWidth / width) * svgBox.width}px`;
    frame.style.height = `${(worldHeight / height) * svgBox.height}px`;
  }, [host, viewport, canvasWidth, canvasHeight, nodeCount]);

  if (!host) return null;
  return createPortal(<div ref={frameRef} className="flow-minimap-viewport-frame" />, host);
}

export function FlowWorkspace({
  project,
  selectedPageId,
  selectedPageIds,
  selectedEdgeId,
  missing,
  view,
  flowRef,
  fitEpoch,
  arrangeEpoch,
  onSelectPage,
  onSelectPages,
  onClearSelection,
  onEditPage,
  onSelectEdge,
  onMovePages,
  onConnect,
  onAddPage,
}: {
  project: Project;
  selectedPageId: string;
  selectedPageIds: string[];
  selectedEdgeId: string;
  missing: string[];
  view: FlowViewStore;
  flowRef: { current: FlowInstance | null };
  fitEpoch: number;
  arrangeEpoch: number;
  onSelectPage: (pageId: string, additive?: boolean) => void;
  onSelectPages: (pageIds: string[]) => void;
  onClearSelection: () => void;
  onEditPage: (pageId: string) => void;
  onSelectEdge: (edgeId: string, pageId: string) => void;
  onMovePages: (updates: Array<{ pageId: string; position: { x: number; y: number } }>) => void;
  onConnect: (source: string, exitId: string, target: string) => void;
  onAddPage: () => void;
}) {
  const [nodes, setNodes] = useState<Node<CardData>[]>([]);
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [snapGuide, setSnapGuide] = useState<{ x: number; y: number } | null>(null);
  const lastFit = useRef(fitEpoch);
  const lastArrange = useRef(arrangeEpoch);

  useEffect(() => {
    const warnings = issues(project);
    setNodes(
      project.pages.map((p) => ({
        id: p.id,
        type: 'page',
        // Old projects keep their stored x; the canvas only projects it onto
        // the nearest column. Nothing is written until the user drags.
        position: { x: snapXToColumn(p.position.x), y: p.position.y },
        selected: selectedPageIds.includes(p.id),
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
  }, [project, selectedPageIds, missing, onEditPage]);

  const viewportBounds = useMemo(() => {
    if (!project.pages.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const page of project.pages) {
      const x = snapXToColumn(page.position.x);
      const height = PAGE_CARD_BASE_HEIGHT + page.exits.length * PAGE_EXIT_HEIGHT;
      minX = Math.min(minX, x);
      minY = Math.min(minY, page.position.y);
      maxX = Math.max(maxX, x + PAGE_CARD_WIDTH);
      maxY = Math.max(maxY, page.position.y + height);
    }
    return { minX, minY, maxX, maxY };
  }, [project.pages]);
  const canvasRef = useRef<HTMLElement | null>(null);
  const clampViewport = useCallback(
    (next: Viewport) => {
      const canvas = canvasRef.current;
      if (!canvas) return next;
      return clampFlowViewport(next, canvas.clientWidth, canvas.clientHeight, viewportBounds);
    },
    [viewportBounds],
  );

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

  useEffect(() => {
    if (arrangeEpoch === lastArrange.current) return;
    lastArrange.current = arrangeEpoch;
    const current = flowRef.current?.getNodes();
    if (!current?.length) return;
    const heightFor = (id: string) => {
      const node = current.find((item) => item.id === id);
      const page = project.pages.find((item) => item.id === id);
      return (
        node?.measured?.height ??
        PAGE_CARD_BASE_HEIGHT + (page?.exits.length ?? 0) * PAGE_EXIT_HEIGHT
      );
    };
    const arranged = arrangeFlowCards(
      current.map((node) => ({
        id: node.id,
        position: node.position,
        height: heightFor(node.id),
      })),
      FLOW_ARRANGE_START_Y,
      FLOW_ARRANGE_GAP,
    );
    const positions = new Map(arranged.map((item) => [item.id, item.position]));
    const updates = arranged.flatMap((item) => {
      const stored = project.pages.find((page) => page.id === item.id)?.position;
      return !stored || stored.x !== item.position.x || stored.y !== item.position.y
        ? [{ pageId: item.id, position: item.position }]
        : [];
    });
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    );
    if (updates.length) onMovePages(updates);
    window.setTimeout(fitFlow, 100);
  }, [arrangeEpoch]);

  useEffect(
    () => () => {
      flowRef.current = null;
    },
    [flowRef],
  );

  return (
    <main className="flow-canvas" ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={view.viewport}
        onInit={(inst) => {
          flowRef.current = inst;
          // Remounts after the page workspace or preview must reuse the last
          // recorded framing instead of starting from a fresh fit.
          inst.setViewport(clampViewport({ ...view.viewport }));
        }}
        onMove={(_, next) => {
          const clamped = clampViewport(next);
          rememberViewport(view, clamped);
          if (clamped.x !== next.x || clamped.y !== next.y) flowRef.current?.setViewport(clamped);
        }}
        onMoveEnd={(_, next) => {
          const clamped = clampViewport(next);
          rememberViewport(view, clamped);
          if (clamped.x !== next.x || clamped.y !== next.y) flowRef.current?.setViewport(clamped);
        }}
        onNodesChange={(changes) => setNodes((n) => applyNodeChanges(changes, n))}
        onNodeClick={(event, n) =>
          onSelectPage(n.id, event.shiftKey || event.ctrlKey || event.metaKey)
        }
        onSelectionEnd={() => {
          const selected = flowRef.current
            ?.getNodes()
            .filter((node) => node.selected)
            .map((node) => node.id);
          if (selected) onSelectPages(selected);
        }}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        onPaneClick={onClearSelection}
        onNodeDoubleClick={(_, n) => onEditPage(n.id)}
        onNodeDrag={(_, dragged) => {
          const selected = new Set(
            selectedPageIds.includes(dragged.id) ? selectedPageIds : [dragged.id],
          );
          selected.add(dragged.id);
          const targetX = snapXToColumn(dragged.position.x);
          const page = project.pages.find((item) => item.id === dragged.id);
          const currentNodes = flowRef.current?.getNodes() ?? nodes;
          const draggedHeight =
            dragged.measured?.height ??
            PAGE_CARD_BASE_HEIGHT + (page?.exits.length ?? 0) * PAGE_EXIT_HEIGHT;
          const otherCards = currentNodes
            .filter((item) => !selected.has(item.id))
            .map((item) => ({
              id: item.id,
              position: item.position,
              height:
                item.measured?.height ??
                PAGE_CARD_BASE_HEIGHT +
                  (project.pages.find((candidate) => candidate.id === item.id)?.exits.length ?? 0) *
                    PAGE_EXIT_HEIGHT,
            }));
          const targetY = snapYToAdjacentCard(
            dragged.position.y,
            targetX,
            draggedHeight,
            otherCards,
          );
          // The guide marks the gap between cards, not the dragged card's top
          // edge; otherwise snapping above a lower card looks like a far-away
          // "higher dashed line".
          const guideY = targetY < dragged.position.y ? targetY + draggedHeight + 4 : targetY - 4;
          setSnapGuide(targetY === dragged.position.y ? null : { x: targetX, y: guideY });
        }}
        onNodeDragStop={(_, dragged) => {
          const current = flowRef.current?.getNodes() ?? nodes;
          const draggedNode = current.find((node) => node.id === dragged.id);
          if (!draggedNode) return;
          const selected = new Set(
            selectedPageIds.includes(dragged.id) ? selectedPageIds : [dragged.id],
          );
          selected.add(dragged.id);
          const targetX = snapXToColumn(draggedNode.position.x);
          const otherNodes = current.filter((node) => !selected.has(node.id));
          const draggedPage = project.pages.find((page) => page.id === draggedNode.id);
          const draggedHeight =
            draggedNode.measured?.height ??
            PAGE_CARD_BASE_HEIGHT + (draggedPage?.exits.length ?? 0) * PAGE_EXIT_HEIGHT;
          const otherPages = otherNodes.map((node) => ({
            id: node.id,
            position: node.position,
            height:
              node.measured?.height ??
              PAGE_CARD_BASE_HEIGHT +
                (project.pages.find((page) => page.id === node.id)?.exits.length ?? 0) *
                  PAGE_EXIT_HEIGHT,
          }));
          const targetY = snapYToAdjacentCard(
            draggedNode.position.y,
            targetX,
            draggedHeight,
            otherPages,
          );
          const delta = {
            x: targetX - draggedNode.position.x,
            y: targetY - draggedNode.position.y,
          };
          if (!allowOverlap) {
            const group = current
              .filter((node) => selected.has(node.id))
              .map((node) => {
                const page = project.pages.find((item) => item.id === node.id);
                return {
                  id: node.id,
                  x: node.position.x + delta.x,
                  y: node.position.y + delta.y,
                  height:
                    node.measured?.height ??
                    PAGE_CARD_BASE_HEIGHT + (page?.exits.length ?? 0) * PAGE_EXIT_HEIGHT,
                };
              });
            const others = otherPages.map((page) => ({
              id: page.id,
              x: page.position.x,
              y: page.position.y,
              height: page.height,
            }));
            delta.y += resolveVerticalCollisions(group, others);
          }
          setSnapGuide(null);
          const updates: Array<{ pageId: string; position: { x: number; y: number } }> = [];
          const nextPositions = new Map<string, { x: number; y: number }>();
          for (const node of current) {
            if (!selected.has(node.id)) continue;
            const position = {
              x: node.position.x + delta.x,
              y: node.position.y + delta.y,
            };
            nextPositions.set(node.id, position);
            const stored = project.pages.find((page) => page.id === node.id)?.position;
            if (!stored || stored.x !== position.x || stored.y !== position.y)
              updates.push({ pageId: node.id, position });
          }
          if (!updates.length) return;
          setNodes((currentNodes) =>
            currentNodes.map((node) => {
              const position = nextPositions.get(node.id);
              return position ? { ...node, position } : node;
            }),
          );
          // One batch command keeps the whole multi-card drag as one undo step.
          onMovePages(updates);
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
        {snapGuide && (
          <ViewportPortal>
            <div
              className="flow-snap-guide"
              style={{
                position: 'absolute',
                left: xForColumnIndex(columnIndexForX(snapGuide.x)),
                top: snapGuide.y,
                width: FLOW_COLUMN_STEP_X,
                zIndex: 3,
              }}
            />
          </ViewportPortal>
        )}
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          className="flow-minimap"
          ariaLabel="流程缩略图"
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => (node.selected ? 'var(--accent)' : 'var(--minimap-node)')}
          nodeStrokeColor="var(--minimap-node-stroke)"
          nodeBorderRadius={2}
          maskColor="var(--minimap-mask)"
          maskStrokeColor="transparent"
          maskStrokeWidth={0}
        />
        <MiniMapViewportFrame />
      </ReactFlow>
      <label className="flow-overlap-toggle">
        <input
          type="checkbox"
          checked={allowOverlap}
          onChange={(event) => setAllowOverlap(event.target.checked)}
        />
        允许卡片重叠
      </label>
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
      <div className="canvas-hint">
        拖动画布平移 · 滚轮缩放 · Shift＋拖动框选卡片 · 右侧圆点拖到目标页左侧圆点连线
      </div>
    </main>
  );
}
