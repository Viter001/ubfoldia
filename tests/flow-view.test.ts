import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandService, createProject } from '../src/core/project.ts';
import {
  createFlowViewStore,
  flowFitKey,
  needsAutoFit,
  rememberViewport,
  resetFlowView,
  syncFlowSession,
} from '../src/ui/flow-view.ts';

const framed = { x: -180, y: 64, zoom: 0.55 };

test('a flow viewport survives page-workspace and preview round trips', () => {
  const view = createFlowViewStore();
  const project = createProject('视口回归', 1280, 720);
  view.fitted = flowFitKey(project, 1);
  rememberViewport(view, framed);

  // Switching to the page workspace or the preview player only unmounts the
  // canvas; the owner of this small state is not remounted with it.
  assert.equal(needsAutoFit(view, project, 1, false), false);
  assert.equal(needsAutoFit(view, project, 1, true), false);
  assert.deepEqual(view.viewport, framed);
  assert.equal(view.fitted, flowFitKey(project, 1));
});

test('returning to the flow workspace keeps the last pan and zoom instead of refitting', () => {
  const view = createFlowViewStore();
  const project = createProject('视口回归', 1280, 720);
  rememberViewport(view, framed);
  view.fitted = flowFitKey(project, 2);

  // Page workspace -> flow, then preview -> flow: both leave the store alone.
  assert.deepEqual(view.viewport, framed);
  assert.equal(needsAutoFit(view, project, 2, true), false, 'no second automatic fit');
});

test('a successful session replacement resets viewport and fitted state', () => {
  const view = createFlowViewStore();
  const project = createProject('旧工程', 1280, 720);
  rememberViewport(view, framed);
  view.fitted = flowFitKey(project, 3);

  const changed = syncFlowSession(view, 3, 4);
  assert.equal(changed, true);
  assert.deepEqual(view.viewport, { x: 40, y: 40, zoom: 0.8 });
  assert.equal(view.fitted, '', 'the replacement project fits once');
  const nextService = new CommandService(createProject('新工程', 1280, 720));
  nextService.execute({ type: 'page.add', name: '第一页' });
  assert.equal(needsAutoFit(view, nextService.snapshot(), 4, true), true);
});

test('cancelled or failed switches keep the current viewport and fitted memory', () => {
  const view = createFlowViewStore();
  const project = createProject('当前工程', 1280, 720);
  rememberViewport(view, framed);
  view.fitted = flowFitKey(project, 5);

  // Cancel/failure paths never bump the session epoch, so no reset is requested.
  assert.equal(syncFlowSession(view, 5, 5), false);
  assert.deepEqual(view.viewport, framed);
  assert.equal(view.fitted, flowFitKey(project, 5));
  assert.equal(needsAutoFit(view, project, 5, true), false);
});

test('an empty project does not schedule an automatic fit', () => {
  const view = createFlowViewStore();
  const project = createProject('空白工程', 1280, 720);
  assert.equal(needsAutoFit(view, project, 1, true), false);
  resetFlowView(view);
  assert.equal(view.fitted, '');
});
