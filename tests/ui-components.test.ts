import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandService, createProject } from '../src/core/project.ts';
import { CommandRibbon } from '../src/ui/CommandRibbon.tsx';
import { PageWorkspace } from '../src/ui/PageWorkspace.tsx';
import { FlowInspector } from '../src/ui/FlowInspector.tsx';

function sample() {
  const service = new CommandService(createProject('界面测试', 1280, 720));
  const pageId = service.execute({ type: 'page.add', name: '第一页' }).id!;
  const layerId = service.execute({ type: 'layer.add', pageId, kind: 'text' }).id!;
  return { project: service.snapshot(), pageId, layerId };
}

const noop = () => {};

test('the ribbon keeps tab ids, group labels and the original button names', () => {
  const { project } = sample();
  const html = renderToStaticMarkup(
    React.createElement(CommandRibbon, {
      group: '开始',
      onGroup: noop,
      mode: 'flow',
      page: null,
      layer: null,
      project,
      canUndo: false,
      canRedo: false,
      onCommand: noop,
      onNew: noop,
      onOpen: noop,
      onSave: noop,
      onUndo: noop,
      onRedo: noop,
      onAddPage: noop,
      onAddText: noop,
      onAddImage: noop,
      onImport: noop,
      onPreview: noop,
      onShowFlow: noop,
      onShowPage: noop,
      onFit: noop,
    }),
  );
  assert.match(html, /id="command-tab-开始"/);
  assert.match(html, /id="command-ribbon"/);
  assert.match(html, /aria-label="开始命令"/);
  assert.match(html, /role="group" aria-label="编辑历史"/);
  for (const name of ['撤销', '重做', '＋ 新增页面', '导入素材', '预览当前页'])
    assert.ok(html.includes(name), name);
  assert.match(html, /流程工作区/);
});

test('page workspace and inspector keep their stable classes and controls', () => {
  const { project, pageId, layerId } = sample();
  const page = project.pages.find((item) => item.id === pageId)!;
  const layer = page.layers.find((item) => item.id === layerId)!;
  const html = renderToStaticMarkup(
    React.createElement(PageWorkspace, {
      project,
      page,
      layer,
      selectedLayerId: layerId,
      tab: 'layers',
      missing: [],
      onTab: noop,
      onSelectLayer: noop,
      onAddLayer: noop,
      onImport: noop,
      onPlay: noop,
      onStop: noop,
      onCommand: noop,
    }),
  );
  assert.match(html, /class="editor-layout"/);
  assert.match(html, /class="library"/);
  assert.match(html, /class="layer-row active"/);
  assert.match(html, /class="editor-canvas"/);
  assert.match(html, /class="inspector"/);
  assert.match(html, /<span>文字内容<\/span>/);
  assert.match(html, /<span>进场动画<\/span>|进场动画/);
  assert.match(html, /删除图层/);
});

test('flow inspector still exposes page, exit and agent sections', () => {
  const { project } = sample();
  const page = project.pages[0];
  const html = renderToStaticMarkup(
    React.createElement(FlowInspector, {
      project,
      page,
      hasEdge: false,
      selectedEdgeId: '',
      approvedRoots: [],
      onCommand: noop,
      onEditPage: noop,
      onDeletePage: noop,
      onApprove: noop,
    }),
  );
  assert.match(html, /class="inspector"/);
  assert.match(html, /页面与出口/);
  assert.match(html, /编辑页面 ↗/);
  assert.match(html, /删除页面/);
  assert.match(html, /class="agent-panel"/);
  assert.match(html, /授权素材文件夹/);
});
