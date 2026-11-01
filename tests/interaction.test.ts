import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandService, createProject, type Project } from '../src/core/project.ts';
import {
  initialInteraction,
  interactionReducer,
  type InteractionState,
} from '../src/ui/interaction.ts';

function projectWithPage() {
  const service = new CommandService(createProject('故事', 1280, 720));
  const pageId = service.execute({ type: 'page.add', name: '第一页' }).id!;
  const layerId = service.execute({ type: 'layer.add', pageId, kind: 'text' }).id!;
  const exitId = service.execute({ type: 'exit.add', pageId, label: '继续', target: null }).id!;
  return { service, project: service.snapshot(), pageId, layerId, exitId };
}

function selectedState(project: Project, pageId: string, layerId: string, edgeId: string) {
  let state = interactionReducer(initialInteraction, { type: 'sync', project });
  state = interactionReducer(state, { type: 'edit-page', pageId });
  state = interactionReducer(state, { type: 'select-layer', layerId });
  state = interactionReducer(state, { type: 'command-group', group: '插入' });
  state = interactionReducer(state, { type: 'library-tab', tab: 'assets' });
  state = interactionReducer(state, { type: 'select-edge', pageId, edgeId });
  return state;
}

test('selecting pages, layers and connections records each workspace target', () => {
  const { project, pageId, layerId, exitId } = projectWithPage();
  let state = interactionReducer(initialInteraction, { type: 'sync', project });
  state = interactionReducer(state, { type: 'select-page', pageId });
  assert.equal(state.pageId, pageId);
  state = interactionReducer(state, { type: 'select-layer', layerId });
  assert.equal(state.layerId, layerId);
  state = interactionReducer(state, { type: 'select-edge', pageId, edgeId: exitId });
  assert.equal(state.edgeId, exitId);
  assert.equal(state.pageId, pageId);
  state = interactionReducer(state, { type: 'mode', mode: 'page' });
  assert.equal(state.mode, 'page');
  state = interactionReducer(state, { type: 'mode', mode: 'flow' });
  assert.equal(state.mode, 'flow');
});

test('switching project identity clears selection, workspace mode and transient tabs', () => {
  const first = projectWithPage();
  const second = projectWithPage().project;
  let state = selectedState(first.project, first.pageId, first.layerId, first.exitId);
  const epoch = state.viewportEpoch;
  assert.equal(state.pageId, first.pageId);
  assert.equal(state.mode, 'page');

  state = interactionReducer(state, { type: 'sync', project: second });
  assert.equal(state.projectId, second.id);
  assert.equal(state.mode, 'flow');
  assert.equal(state.pageId, '');
  assert.equal(state.layerId, '');
  assert.equal(state.edgeId, '');
  assert.equal(state.commandGroup, '开始');
  assert.equal(state.libraryTab, 'layers');
  assert.equal(state.viewportEpoch, epoch + 1, 'the flow viewport is reset with the project');
});

test('new, ordinary open and recent open all reset through the same identity change', () => {
  const first = projectWithPage();
  const results: InteractionState[] = [];
  for (const route of ['new', 'open', 'recent'] as const) {
    let state = selectedState(first.project, first.pageId, first.layerId, first.exitId);
    const replacement = projectWithPage().project;
    state = interactionReducer(state, { type: 'replace', project: replacement });
    assert.equal(state.projectId, replacement.id, route);
    assert.equal(state.pageId, '', route);
    assert.equal(state.mode, 'flow', route);
    results.push(state);
  }
  assert.deepEqual({ ...results[1], projectId: results[0].projectId }, results[0]);
  assert.deepEqual({ ...results[2], projectId: results[0].projectId }, results[0]);
});

test('re-opening the same project still resets the workspace and selection', () => {
  const { project, pageId, layerId, exitId } = projectWithPage();
  let state = selectedState(project, pageId, layerId, exitId);
  const epoch = state.viewportEpoch;
  state = interactionReducer(state, { type: 'replace', project });
  assert.equal(state.projectId, project.id);
  assert.equal(state.mode, 'flow');
  assert.equal(state.pageId, '');
  assert.equal(state.layerId, '');
  assert.equal(state.edgeId, '');
  assert.equal(state.viewportEpoch, epoch + 1);
});

test('a revision update of the same project keeps valid selections and the viewport', () => {
  const { service, project, pageId, layerId, exitId } = projectWithPage();
  let state = selectedState(project, pageId, layerId, exitId);
  const epoch = state.viewportEpoch;
  const next = service.execute({ type: 'page.patch', pageId, patch: { name: '改名' } });

  state = interactionReducer(state, { type: 'sync', project: service.snapshot() });
  assert.equal(state.projectId, project.id);
  assert.equal(state.pageId, pageId);
  assert.equal(state.layerId, layerId);
  assert.equal(state.edgeId, exitId);
  assert.equal(state.mode, 'page');
  assert.equal(state.commandGroup, '插入');
  assert.equal(state.libraryTab, 'assets');
  assert.equal(state.viewportEpoch, epoch);
  assert.equal(next.revision, project.revision + 1);
});

test('deleting the selected page clears page, layer, edge and returns to the flow workspace', () => {
  const { service, project, pageId, layerId, exitId } = projectWithPage();
  let state = selectedState(project, pageId, layerId, exitId);
  state = interactionReducer(state, { type: 'mode', mode: 'page' });

  service.execute({ type: 'page.delete', pageId });
  state = interactionReducer(state, { type: 'sync', project: service.snapshot() });

  assert.equal(state.pageId, '');
  assert.equal(state.layerId, '');
  assert.equal(state.edgeId, '');
  assert.equal(state.mode, 'flow');
  assert.equal(state.projectId, project.id, 'same project keeps its identity');
});

test('deleting the selected layer or exit only clears that stale selection', () => {
  const { service, project, pageId, layerId, exitId } = projectWithPage();
  let state = selectedState(project, pageId, layerId, exitId);
  service.execute({ type: 'layer.delete', pageId, layerId });
  state = interactionReducer(state, { type: 'sync', project: service.snapshot() });
  assert.equal(state.layerId, '');
  assert.equal(state.pageId, pageId);
  assert.equal(state.edgeId, exitId);
  assert.equal(state.mode, 'page');

  service.execute({ type: 'exit.delete', pageId, exitId });
  state = interactionReducer(state, { type: 'sync', project: service.snapshot() });
  assert.equal(state.edgeId, '');
  assert.equal(state.pageId, pageId);
});

test('an invalid page selection on the same project falls back to the flow workspace', () => {
  const { project } = projectWithPage();
  let state = interactionReducer(initialInteraction, { type: 'sync', project });
  state = { ...state, pageId: 'missing', layerId: 'missing-layer', mode: 'page' };
  state = interactionReducer(state, { type: 'sync', project });
  assert.equal(state.pageId, '');
  assert.equal(state.layerId, '');
  assert.equal(state.mode, 'flow');
});
