import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_COLUMN_MAX,
  FLOW_COLUMN_ORIGIN_X,
  FLOW_COLUMN_STEP_X,
  FLOW_CARD_GAP,
  FLOW_VIEWPORT_HORIZONTAL_RATIO,
  FLOW_VIEWPORT_VERTICAL_MIN_OVERLAP,
  FLOW_VERTICAL_SNAP_DISTANCE,
  clampFlowViewport,
  arrangeFlowCards,
  columnIndexForX,
  flowColumnRange,
  levelForX,
  snapXToColumn,
  resolveVerticalCollisions,
  snapYToAdjacentCard,
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

test('vertical snapping targets the gap above or below a same-column card', () => {
  const cards = [
    { id: 'a', position: { x: FLOW_COLUMN_ORIGIN_X, y: 100 }, height: 200 },
    { id: 'b', position: { x: FLOW_COLUMN_ORIGIN_X + 20, y: 160 }, height: 200 },
    { id: 'c', position: { x: FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X, y: 500 }, height: 200 },
  ];
  assert.equal(snapYToAdjacentCard(300, FLOW_COLUMN_ORIGIN_X, 200, cards), 300 + FLOW_CARD_GAP);
  assert.equal(snapYToAdjacentCard(260, FLOW_COLUMN_ORIGIN_X, 200, cards), 260);
  assert.equal(
    snapYToAdjacentCard(360, FLOW_COLUMN_ORIGIN_X, 200, cards),
    360 + FLOW_CARD_GAP,
    'nearest same-column gap is used',
  );
  assert.equal(
    snapYToAdjacentCard(500, FLOW_COLUMN_ORIGIN_X, 200, cards),
    500,
    'other columns do not snap',
  );
  assert.equal(
    snapYToAdjacentCard(300, FLOW_COLUMN_ORIGIN_X, 200, cards, new Set(['a'])),
    300,
    'excluded cards are ignored',
  );
  assert.equal(
    snapYToAdjacentCard(260, FLOW_COLUMN_ORIGIN_X, 200, cards),
    260,
    'threshold is narrow',
  );
});

test('vertical collision resolution moves a dragged group to the nearest gap', () => {
  const group = [{ id: 'drag', x: FLOW_COLUMN_ORIGIN_X, y: 250, height: 200 }];
  const others = [
    { id: 'above', x: FLOW_COLUMN_ORIGIN_X, y: 100, height: 200 },
    { id: 'other-column', x: FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X, y: 250, height: 200 },
  ];
  assert.equal(resolveVerticalCollisions(group, others), 50 + FLOW_CARD_GAP);
  assert.equal(
    resolveVerticalCollisions([{ id: 'drag', x: FLOW_COLUMN_ORIGIN_X, y: 250, height: 200 }], []),
    0,
  );
  const below = [{ id: 'below', x: FLOW_COLUMN_ORIGIN_X, y: 420, height: 200 }];
  assert.equal(resolveVerticalCollisions(group, below), -30 - FLOW_CARD_GAP);
});

test('vertical collision resolution clears multiple nearby cards at once', () => {
  const group = [{ id: 'drag', x: FLOW_COLUMN_ORIGIN_X, y: 250, height: 200 }];
  const neighbors = [
    { id: 'above', x: FLOW_COLUMN_ORIGIN_X, y: 100, height: 200 },
    { id: 'below', x: FLOW_COLUMN_ORIGIN_X, y: 430, height: 200 },
  ];
  const shift = resolveVerticalCollisions(group, neighbors);
  assert.ok(shift < 0, `the group must move above the surrounding cards: ${shift}`);
  const top = group[0].y + shift;
  assert.ok(top + group[0].height + FLOW_CARD_GAP <= 100 || top >= 430 + 200 + FLOW_CARD_GAP);
});

test('one-click arrange removes legacy overlaps while preserving columns', () => {
  const arranged = arrangeFlowCards([
    { id: 'a', position: { x: FLOW_COLUMN_ORIGIN_X, y: 100 }, height: 200 },
    { id: 'b', position: { x: FLOW_COLUMN_ORIGIN_X + 5, y: 120 }, height: 240 },
    { id: 'c', position: { x: FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X, y: 500 }, height: 200 },
  ]);
  assert.deepEqual(arranged, [
    { id: 'a', position: { x: FLOW_COLUMN_ORIGIN_X, y: 80 } },
    { id: 'b', position: { x: FLOW_COLUMN_ORIGIN_X, y: 80 + 200 + FLOW_CARD_GAP } },
    { id: 'c', position: { x: FLOW_COLUMN_ORIGIN_X + FLOW_COLUMN_STEP_X, y: 80 } },
  ]);
});

test('viewport clamping keeps half the width and a vertical flow strip visible', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
  const farRight = clampFlowViewport({ x: -10000, y: -10000, zoom: 1 }, 1000, 600, bounds);
  assert.equal(farRight.x, -(bounds.maxX - 1000 * FLOW_VIEWPORT_HORIZONTAL_RATIO));
  assert.equal(farRight.y, -(bounds.maxY - FLOW_VIEWPORT_VERTICAL_MIN_OVERLAP));

  const farLeft = clampFlowViewport({ x: 10000, y: 10000, zoom: 1 }, 1000, 600, bounds);
  assert.equal(farLeft.x, -(bounds.minX + 500 - 1000));
  assert.equal(farLeft.y, -(bounds.minY + FLOW_VIEWPORT_VERTICAL_MIN_OVERLAP - 600));

  assert.deepEqual(clampFlowViewport({ x: -200, y: -100, zoom: 1 }, 1000, 600, bounds), {
    x: -200,
    y: -100,
    zoom: 1,
  });
});
