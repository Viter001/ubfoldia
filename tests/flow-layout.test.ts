import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_COLUMN_MAX,
  FLOW_COLUMN_ORIGIN_X,
  FLOW_COLUMN_STEP_X,
  columnIndexForX,
  flowColumnRange,
  levelForX,
  snapXToColumn,
  xForColumnIndex,
} from '../src/ui/flow-layout.ts';

test('arbitrary x values map to the nearest column and clamp at zero', () => {
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X), 0);
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X - 1), 0);
  assert.equal(columnIndexForX(-5000), 0);
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X + 1), 0);
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X - 1), 1);
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X), 1);
  assert.equal(columnIndexForX(FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X * 2 + 140), 2);
  assert.equal(
    columnIndexForX(FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X * 2 + FLOW_COLUMN_STEP_X / 2),
    3,
    'half a step rounds to the next column',
  );
  assert.equal(columnIndexForX(Number.NaN), 0);
  assert.equal(columnIndexForX(Number.POSITIVE_INFINITY), 0);
});

test('snapping only moves x to the column origin and is idempotent', () => {
  const snapped = snapXToColumn(677);
  assert.equal(snapped, FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X * 2);
  assert.equal(snapXToColumn(snapped), snapped);
  assert.equal(xForColumnIndex(3), FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X * 3);
  assert.equal(xForColumnIndex(-2), FLOW_COLUMN_ORIGIN_X);
  assert.equal(levelForX(677), 3);
  assert.equal(levelForX(-100), 1);
});

test('visible columns cover the viewport and existing node columns', () => {
  const range = flowColumnRange({
    viewport: { x: 0, y: 0, zoom: 1 },
    width: 720,
    height: 600,
    positions: [
      { x: 80, y: 100 },
      { x: 2000, y: 260 },
    ],
  });
  assert.equal(range.start, 0);
  assert.equal(range.end, 5, 'the far node column is included');
  const columns = range.end - range.start + 1;
  assert.ok(columns > 0 && columns <= FLOW_COLUMN_MAX);
  assert.ok(range.top <= 100);
  assert.ok(range.bottom >= 600);
  assert.ok(range.bottom >= 260 + 300);
});

test('columns stay bounded when a project has distant node columns', () => {
  const range = flowColumnRange({
    viewport: { x: 0, y: 0, zoom: 1 },
    width: 720,
    height: 600,
    positions: [
      { x: 80, y: 120 },
      { x: 80 + FLOW_COLUMN_STEP_X * 500, y: 120 },
    ],
    maxColumns: 12,
  });
  assert.equal(range.end - range.start + 1, 12);
  assert.equal(range.start, 0, 'the visible column remains covered first');
});

test('a panned viewport keeps covering visible columns and nearby nodes', () => {
  const range = flowColumnRange({
    viewport: { x: -1000, y: 100, zoom: 1 },
    width: 720,
    height: 600,
    positions: [{ x: 80, y: 100 }],
  });
  assert.equal(range.start, 0, 'the existing node column stays available');
  assert.ok(range.end >= 4, 'visible columns to the right stay available');
  assert.ok(range.top <= -100, 'the visible top and node top are both covered');
});

test('columns cap the visible span when zoomed far out', () => {
  const range = flowColumnRange({
    viewport: { x: 0, y: 0, zoom: 0.2 },
    width: 1200,
    height: 700,
    positions: [{ x: 80, y: 100 }],
    maxColumns: 8,
  });
  assert.equal(range.start, 0);
  assert.equal(range.end, 7);
});

test('missing viewport metrics fall back to node columns safely', () => {
  const range = flowColumnRange({
    viewport: { x: 0, y: 0, zoom: 0 },
    width: 0,
    height: 0,
    positions: [{ x: 1500, y: 400 }],
  });
  assert.equal(range.start, 4);
  assert.equal(range.end, 4);
  assert.ok(range.top <= 400);
  assert.ok(range.bottom >= 400);

  const empty = flowColumnRange({
    viewport: { x: 0, y: 0, zoom: Number.NaN },
    width: Number.NaN,
    height: Number.NaN,
  });
  assert.deepEqual({ start: empty.start, end: empty.end }, { start: 0, end: 0 });
});
