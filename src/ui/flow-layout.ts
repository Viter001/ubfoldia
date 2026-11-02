/**
 * Flow columns are the layout levels of the story graph. This module keeps the
 * projection pure so the canvas, edge colors and tests all agree on one rule:
 * an arbitrary x belongs to the nearest column, never to a negative level.
 */

/** Left edge of column 0. */
export const FLOW_COLUMN_ORIGIN_X = 80;
/** Distance between two column origins; the card itself is 244px wide. */
export const FLOW_COLUMN_STEP_X = 360;
/** Upper bound for rendered column backgrounds (visible range first). */
export const FLOW_COLUMN_MAX = 60;
/** Extra columns rendered on each side of the strict viewport intersection. */
export const FLOW_COLUMN_OVERSCAN = 0;

const NODE_HEIGHT_FALLBACK = 320;
const NODE_TOP_PADDING = 40;

export type FlowColumnViewport = { x: number; y: number; zoom: number };
export type FlowNodePosition = { x: number; y: number; height?: number };
export type FlowColumnRange = {
  /** First rendered column level (zero-based, inclusive). */
  start: number;
  /** Last rendered column level (zero-based, inclusive). */
  end: number;
  /** Top edge of the rendered column band in flow coordinates. */
  top: number;
  /** Bottom edge of the rendered column band in flow coordinates. */
  bottom: number;
};

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Nearest column for any x; negative positions clamp to the first column. */
export function columnIndexForX(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.round((x - FLOW_COLUMN_ORIGIN_X) / FLOW_COLUMN_STEP_X));
}

/** Column origin for a level; invalid or negative indexes clamp to column 0. */
export function xForColumnIndex(index: number): number {
  const column = Number.isFinite(index) ? Math.max(0, Math.round(index)) : 0;
  return FLOW_COLUMN_ORIGIN_X + column * FLOW_COLUMN_STEP_X;
}

/** Snap a dragged card's x to the column grid while leaving y untouched. */
export function snapXToColumn(x: number): number {
  return xForColumnIndex(columnIndexForX(x));
}

/** Human-facing level number (column 0 is level 1). */
export function levelForX(x: number): number {
  return columnIndexForX(x) + 1;
}

/**
 * Rendered column window. The window must cover the viewport and the current
 * node columns, but stays bounded even when an old project contains pages far
 * outside the visible area or the canvas is zoomed far out.
 */
export function flowColumnRange({
  viewport,
  width,
  height,
  positions = [],
  maxColumns = FLOW_COLUMN_MAX,
  overscan = FLOW_COLUMN_OVERSCAN,
}: {
  viewport: FlowColumnViewport;
  width: number;
  height: number;
  positions?: readonly FlowNodePosition[];
  maxColumns?: number;
  overscan?: number;
}): FlowColumnRange {
  const zoom = finite(viewport.zoom, 1) > 0 ? finite(viewport.zoom, 1) : 1;
  const viewX = finite(viewport.x, 0);
  const viewY = finite(viewport.y, 0);
  const canvasWidth = finite(width, 0);
  const canvasHeight = finite(height, 0);
  const hasViewport = canvasWidth > 0 && canvasHeight > 0;
  const extra = Math.max(0, Math.floor(finite(overscan, 0)));

  let nodeMinColumn: number | undefined;
  let nodeMaxColumn: number | undefined;
  let nodeTop: number | undefined;
  let nodeBottom: number | undefined;

  for (const position of positions) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    const column = columnIndexForX(position.x);
    nodeMinColumn = nodeMinColumn === undefined ? column : Math.min(nodeMinColumn, column);
    nodeMaxColumn = nodeMaxColumn === undefined ? column : Math.max(nodeMaxColumn, column);
    const nodeHeight =
      Number.isFinite(position.height) && (position.height ?? 0) > 0
        ? (position.height as number)
        : NODE_HEIGHT_FALLBACK;
    nodeTop =
      nodeTop === undefined
        ? position.y - NODE_TOP_PADDING
        : Math.min(nodeTop, position.y - NODE_TOP_PADDING);
    nodeBottom =
      nodeBottom === undefined
        ? position.y + nodeHeight
        : Math.max(nodeBottom, position.y + nodeHeight);
  }

  let visibleStart: number | undefined;
  let visibleEnd: number | undefined;
  if (hasViewport) {
    const left = -viewX / zoom;
    const right = (canvasWidth - viewX) / zoom;
    visibleStart = Math.max(
      0,
      Math.floor((left - FLOW_COLUMN_ORIGIN_X) / FLOW_COLUMN_STEP_X) - extra,
    );
    visibleEnd = Math.max(
      visibleStart,
      Math.floor((right - FLOW_COLUMN_ORIGIN_X) / FLOW_COLUMN_STEP_X) + extra,
    );
  }

  let start = visibleStart ?? nodeMinColumn ?? 0;
  let end = visibleEnd ?? nodeMaxColumn ?? start;
  if (nodeMinColumn !== undefined) start = Math.min(start, nodeMinColumn);
  if (nodeMaxColumn !== undefined) end = Math.max(end, nodeMaxColumn);
  if (end < start) end = start;

  const limit = Math.max(1, Math.floor(finite(maxColumns, FLOW_COLUMN_MAX)));
  if (end - start + 1 > limit) {
    if (visibleStart !== undefined && visibleEnd !== undefined) {
      const visibleCount = visibleEnd - visibleStart + 1;
      if (visibleCount >= limit) {
        start = visibleStart;
        end = start + limit - 1;
      } else {
        start = visibleStart;
        end = visibleEnd;
        let spare = limit - (end - start + 1);
        if (nodeMaxColumn !== undefined && nodeMaxColumn > end) {
          const add = Math.min(spare, nodeMaxColumn - end);
          end += add;
          spare -= add;
        }
        if (spare > 0) start = Math.max(0, start - spare);
      }
    } else if (nodeMinColumn !== undefined) {
      start = nodeMinColumn;
      end = Math.min(nodeMaxColumn ?? start, start + limit - 1);
    }
  }

  let top = 0;
  let bottom = 1;
  if (hasViewport) {
    top = -viewY / zoom;
    bottom = (canvasHeight - viewY) / zoom;
  }
  if (nodeTop !== undefined) top = Math.min(top, nodeTop);
  if (nodeBottom !== undefined) bottom = Math.max(bottom, nodeBottom);
  if (bottom <= top) bottom = top + 1;

  return { start, end, top, bottom };
}
