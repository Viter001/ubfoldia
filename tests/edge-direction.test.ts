import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/core/project.ts';
import {
  EDGE_CYCLE_NOTE,
  EDGE_DIRECTION_COLORS,
  EDGE_DIRECTION_LEGEND,
  classifyEdge,
  createEdgeClassifier,
} from '../src/ui/edge-direction.ts';

function project(links: Record<string, string[]>, xs: Record<string, number>): Project {
  return {
    pages: Object.keys(xs).map((id) => ({
      id,
      position: { x: xs[id], y: 0 },
      exits: (links[id] ?? []).map((target, index) => ({
        id: `${id}-${index}`,
        label: '',
        target,
      })),
    })),
  } as unknown as Project;
}

test('non-cycle rightward and same-column connections are forward', () => {
  const right = project({ a: ['b'] }, { a: 80, b: 440 });
  assert.equal(classifyEdge(right, 'a', 'b'), 'forward');

  // Raw x moved left, but both pages project onto the same column.
  const sameColumn = project({ a: ['b'] }, { a: 700, b: 650 });
  assert.equal(classifyEdge(sameColumn, 'a', 'b'), 'forward');
});

test('a leftward connection without a return path is back', () => {
  const p = project({ a: [], b: ['a'] }, { a: 80, b: 440 });
  assert.equal(classifyEdge(p, 'b', 'a'), 'back');
});

test('cycle edges use loop for forward/same direction and loop-back for left', () => {
  const p = project({ a: ['b'], b: ['a'] }, { a: 80, b: 440 });
  assert.equal(classifyEdge(p, 'a', 'b'), 'loop');
  assert.equal(classifyEdge(p, 'b', 'a'), 'loop-back');

  const sameColumn = project({ a: ['b'], b: ['a'] }, { a: 300, b: 350 });
  assert.equal(classifyEdge(sameColumn, 'a', 'b'), 'loop');
  assert.equal(classifyEdge(sameColumn, 'b', 'a'), 'loop');
});

test('larger cycles classify by column direction inside the cycle', () => {
  const p = project({ a: ['b'], b: ['c'], c: ['a'] }, { a: 80, b: 440, c: 800 });
  assert.equal(classifyEdge(p, 'a', 'b'), 'loop');
  assert.equal(classifyEdge(p, 'b', 'c'), 'loop');
  assert.equal(classifyEdge(p, 'c', 'a'), 'loop-back');
});

test('missing pages and exits are safe', () => {
  const p = project({ a: ['missing'] }, { a: 80 });
  assert.equal(classifyEdge(p, 'a', 'missing'), 'forward');
  assert.equal(classifyEdge(p, 'missing', 'a'), 'forward');
});

test('the classifier memoizes reachability without mutating the project', () => {
  const p = project({ a: ['b'], b: ['c'], c: ['a'], d: ['a'] }, { a: 80, b: 440, c: 800, d: 1160 });
  const before = JSON.stringify(p);
  const classify = createEdgeClassifier(p);
  for (let i = 0; i < 5; i++) {
    assert.equal(classify('a', 'b'), 'loop');
    assert.equal(classify('b', 'a'), 'loop-back');
    assert.equal(classify('d', 'a'), 'back');
  }
  assert.equal(JSON.stringify(p), before);
});

test('the four direction colors and legend labels match the approved contract', () => {
  assert.deepEqual(EDGE_DIRECTION_COLORS, {
    forward: '#4ec97a',
    back: '#7896ff',
    loop: '#dfff00',
    'loop-back': '#d99aff',
  });
  assert.deepEqual(
    EDGE_DIRECTION_LEGEND.map((item) => item.label),
    ['前进', '循环', '后退', '循环后退'],
  );
  assert.equal(EDGE_CYCLE_NOTE, '循环 = 环内前进');
});
