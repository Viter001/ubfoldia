import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WINDOW_TITLE,
  WindowTitleBar,
  applyDocumentTitle,
  showsWindowTitleBar,
  windowTitle,
} from '../src/ui/WindowTitleBar.tsx';

test('the custom title bar is a Windows-only affordance', () => {
  assert.equal(showsWindowTitleBar('win32'), true);
  for (const platform of ['darwin', 'linux', 'freebsd', 'aix', '', undefined, null])
    assert.equal(showsWindowTitleBar(platform), false);
});

test('the window title stays compact and only marks an unsaved project', () => {
  assert.equal(windowTitle(), WINDOW_TITLE);
  assert.equal(windowTitle(null), WINDOW_TITLE);
  assert.equal(windowTitle('   '), WINDOW_TITLE);
  assert.equal(windowTitle('林间来信'), '未视之视 · 林间来信');
  assert.equal(windowTitle(' 林间来信 ', false), '未视之视 · 林间来信');
  assert.equal(windowTitle('林间来信', true), '未视之视 · 林间来信 · 未保存');
  assert.equal(WINDOW_TITLE, '未视之视 · 交互叙事工作台');
});

test('document.title follows the visible title on every platform', () => {
  const target = { title: WINDOW_TITLE };
  assert.equal(
    applyDocumentTitle('未视之视 · 林间来信 · 未保存', target),
    '未视之视 · 林间来信 · 未保存',
  );
  assert.equal(target.title, '未视之视 · 林间来信 · 未保存');
  assert.equal(applyDocumentTitle(WINDOW_TITLE, null), WINDOW_TITLE);
});

test('Windows renders a single drag strip with the project title', () => {
  const html = renderToStaticMarkup(
    React.createElement(WindowTitleBar, {
      platform: 'win32',
      projectName: '林间来信',
      dirty: true,
    }),
  );
  assert.match(html, /<div class="window-titlebar">/);
  assert.match(
    html,
    /<span class="window-title" title="未视之视 · 林间来信 · 未保存">未视之视 · 林间来信<\/span>/,
  );
  assert.match(html, /<span class="save-status">● 未保存<\/span>/);
  assert.equal((html.match(/<button/g) ?? []).length, 0, 'no hand-made window buttons');
});

test('Windows welcome screen keeps the full workspace title', () => {
  const html = renderToStaticMarkup(React.createElement(WindowTitleBar, { platform: 'win32' }));
  assert.match(html, /<div class="window-titlebar">/);
  assert.ok(html.includes(WINDOW_TITLE));
  assert.doesNotMatch(html, /class="save-status"/);
  assert.equal((html.match(/<button/g) ?? []).length, 0, 'no hand-made window buttons');
});

test('other platforms keep the native frame and render nothing', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(renderToStaticMarkup(React.createElement(WindowTitleBar, { platform })), '');
  }
});
