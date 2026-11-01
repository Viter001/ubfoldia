import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewMenu, previewOptions } from '../src/ui/PreviewMenu.tsx';

const noop = () => {};

test('preview options disable start and current page independently', () => {
  assert.deepEqual(
    previewOptions('start', 'current').map(({ label, disabled }) => ({ label, disabled })),
    [
      { label: '从头预览', disabled: false },
      { label: '从当前页预览', disabled: false },
    ],
  );
  assert.deepEqual(
    previewOptions(null, 'current').map(({ label, disabled }) => ({ label, disabled })),
    [
      { label: '从头预览', disabled: true },
      { label: '从当前页预览', disabled: false },
    ],
  );
  assert.deepEqual(
    previewOptions('start', null).map(({ label, disabled }) => ({ label, disabled })),
    [
      { label: '从头预览', disabled: false },
      { label: '从当前页预览', disabled: true },
    ],
  );
  assert.deepEqual(
    previewOptions(null, null).map(({ label, disabled }) => ({ label, disabled })),
    [
      { label: '从头预览', disabled: true },
      { label: '从当前页预览', disabled: true },
    ],
  );
});

test('the split preview control exposes visible and accessible labels', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewMenu, {
      startPageId: 'start',
      currentPageId: 'current',
      onPreview: noop,
    }),
  );
  assert.match(html, /<div class="preview-control" role="group" aria-label="预览">/);
  assert.match(html, /class="preview-primary" aria-label="从头预览">▶ 预览<\/button>/);
  assert.match(html, /class="preview-toggle" aria-label="预览选项"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /class="preview-menu"/, 'the menu is closed until requested');
});

test('the primary preview button disables without a start page', () => {
  const html = renderToStaticMarkup(
    React.createElement(PreviewMenu, {
      startPageId: null,
      currentPageId: 'current',
      onPreview: noop,
    }),
  );
  assert.match(html, /class="preview-primary" aria-label="从头预览" disabled=""/);
});
