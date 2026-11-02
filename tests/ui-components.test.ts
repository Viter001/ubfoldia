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

function ribbon(
  group: Parameters<typeof CommandRibbon>[0]['group'],
  project = sample().project,
  page = null,
  mode: 'flow' | 'page' = 'flow',
  defaultCollapsed = false,
) {
  return renderToStaticMarkup(
    React.createElement(CommandRibbon, {
      group,
      onGroup: noop,
      mode,
      page,
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
      defaultCollapsed,
    }),
  );
}

test('the workspace toolbar keeps the tablist pure and preview beside the workspace switch', () => {
  const html = ribbon('开始');
  assert.doesNotMatch(html, /class="topbar"/);
  assert.match(html, /<div class="workspace-toolbar">/);

  const nav =
    html.match(
      /<nav class="command-tabs" role="tablist" aria-label="命令分组">([\s\S]*?)<\/nav>/,
    )?.[1] ?? '';
  assert.equal(
    (nav.match(/<button/g) ?? []).length,
    6,
    'only the six tab buttons live in the tablist',
  );
  assert.doesNotMatch(nav, /workspace-context|workspace-switch|preview-control/);

  assert.match(html, /<\/nav><div class="workspace-context">/);
  assert.match(
    html,
    /<div class="workspace-actions"><div class="workspace-switch" role="group" aria-label="工作区切换">/,
  );
  assert.match(html, /<div class="preview-control" role="group" aria-label="预览">/);
  assert.match(html, /class="preview-primary" aria-label="从头预览">▶ 预览<\/button>/);
  assert.match(html, /class="preview-toggle" aria-label="预览选项"/);
  assert.match(html, /aria-label="预览选项" aria-haspopup="menu" aria-expanded="false"/);
  assert.equal((html.match(/class="preview-primary"/g) ?? []).length, 1);
});

test('the ribbon toggle expands and collapses the detailed tabpanel', () => {
  const expanded = ribbon('开始');
  assert.match(
    expanded,
    /class="ribbon-toggle" aria-expanded="true" aria-controls="command-ribbon">收起工具区<\/button>/,
  );
  assert.match(expanded, /id="command-ribbon"[^>]*class="command-ribbon"/);
  assert.doesNotMatch(expanded, /id="command-ribbon"[^>]*hidden/);
  assert.match(expanded, /aria-label="预览"/);
  assert.match(expanded, /role="tab" id="command-tab-开始"/);

  const collapsed = ribbon('开始', sample().project, null, 'flow', true);
  assert.match(
    collapsed,
    /class="ribbon-toggle" aria-expanded="false" aria-controls="command-ribbon">展开工具区<\/button>/,
  );
  assert.match(collapsed, /id="command-ribbon"[^>]*hidden=""/);
  assert.match(collapsed, /流程工作区/);
  assert.match(collapsed, /aria-label="预览"/);
});

test('the ribbon keeps tab ids, group labels and the original file controls', () => {
  const start = ribbon('开始');
  assert.match(start, /id="command-tab-开始"/);
  assert.match(start, /id="command-ribbon"/);
  assert.match(start, /aria-label="开始命令"/);
  assert.match(start, /role="group" aria-label="编辑历史"/);
  for (const name of ['撤销', '重做', '＋ 新增页面', '导入素材'])
    assert.ok(start.includes(name), name);
  assert.equal(start.includes('预览当前页'), false, '开始 has no duplicate preview group');
  assert.match(start, /流程工作区/);

  const file = ribbon('文件');
  for (const name of ['新建', '打开', '保存']) assert.ok(file.includes(name), name);
});

test('preview groups are gone from 开始/转场/动画 while their edit controls remain', () => {
  const expected = {
    文件: ['工程'],
    开始: ['编辑历史', '页面', '素材'],
    插入: ['内容', '素材', '页面'],
    转场: ['页面转场', '计时', '换页方式'],
    动画: ['对象动画', '计时', '触发与排序'],
    视图: ['工作区', '画布'],
  } as const;
  for (const [group, labels] of Object.entries(expected)) {
    const html = ribbon(group as keyof typeof expected);
    for (const label of labels) {
      assert.match(
        html,
        new RegExp('class="ribbon-group" role="group" aria-label="' + label + '"'),
      );
    }
    if (group !== '开始' && group !== '插入') {
      assert.equal(
        html.includes('<div class="ribbon-group-title">预览</div>'),
        false,
        group + ' has no preview group',
      );
    }
  }
  assert.equal(ribbon('转场').includes('预览当前页'), false);
  assert.equal(ribbon('动画').includes('预览当前页'), false);
});

test('the primary preview button disables without a start page while the toggle stays available', () => {
  const { project } = sample();
  const html = ribbon('开始', { ...project, startPageId: null });
  assert.match(html, /class="preview-primary" aria-label="从头预览" disabled=""/);
  assert.match(html, /class="preview-toggle" aria-label="预览选项"/);
  assert.doesNotMatch(html, /class="preview-toggle" aria-label="预览选项"[^>]*disabled/);
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
