import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, CommandService, type Command, type Envelope } from '../src/core/project.ts';

const fresh = () => new CommandService(createProject('测试工程', 1280, 720));
const addPage = (s: CommandService, name: string) => s.execute({ type: 'page.add', name }).id!;
const envelope = (
  s: CommandService,
  requestId: string,
  expectedRevision = s.project.revision,
): Envelope => ({ projectId: s.project.id, requestId, expectedRevision });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('runtime payloads cannot patch ids, types, layers, or unknown command fields', () => {
  const s = fresh();
  const pageId = addPage(s, 'A'),
    targetId = addPage(s, 'B');
  const layerId = s.execute({ type: 'layer.add', pageId, kind: 'text' }).id!;
  const before = s.snapshot(),
    revision = s.project.revision;
  for (const payload of [
    { type: 'page.patch', pageId: targetId, patch: { id: 'injected' } },
    { type: 'page.patch', pageId: targetId, patch: { layers: [] } },
    { type: 'layer.patch', pageId, layerId, patch: { id: 'injected' } },
    { type: 'layer.patch', pageId, layerId, patch: { type: 'image' } },
    { type: 'page.delete', pageId, cascade: true },
    { type: 'page.add', name: 'X', layers: [] },
    { type: 'page.reorder', pageId, index: 0 },
  ]) {
    assert.throws(() => s.execute(payload as unknown as Command), /INVALID_COMMAND|未知命令/);
  }
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.project.revision, revision);
});

test('allowed page and layer patches still work without changing stable ids', () => {
  const s = fresh();
  const pageId = addPage(s, 'A');
  const layerId = s.execute({ type: 'layer.add', pageId, kind: 'text' }).id!;
  s.execute({
    type: 'page.patch',
    pageId,
    patch: { name: '新名字', background: '#112233', position: { x: 12, y: 34 } },
  });
  s.execute({
    type: 'layer.patch',
    pageId,
    layerId,
    patch: {
      visible: false,
      x: 1,
      y: 2,
      width: 320,
      height: 240,
      fontSize: 24,
      color: '#ffffff',
      align: 'center',
      effect: { type: 'fade', duration: 1.2 },
    },
  });
  const page = s.project.pages[0],
    layer = page.layers[0];
  assert.equal(page.id, pageId);
  assert.equal(page.name, '新名字');
  assert.equal(layer.id, layerId);
  assert.equal(layer.type, 'text');
  assert.equal(layer.visible, false);
  assert.deepEqual(layer.effect, { type: 'fade', duration: 1.2 });
});

test('retries are idempotent even when command object keys are reordered', () => {
  const s = fresh();
  const first = s.execute({ type: 'page.add', name: 'A' }, envelope(s, 'r1', 0));
  const second = s.execute({ name: 'A', type: 'page.add' }, envelope(s, 'r1', 0));
  assert.deepEqual(second, first);
  assert.equal(s.project.pages.length, 1);
  const other = s.execute({ type: 'page.add', name: 'B' }, envelope(s, 'r2', s.project.revision));
  const before = s.snapshot(),
    revision = s.project.revision;
  assert.deepEqual(s.execute({ name: 'A', type: 'page.add' }, envelope(s, 'r1', 0)), first);
  assert.equal(s.project.revision, revision);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(other.revision, 2);
  assert.throws(() => s.execute({ type: 'page.add', name: 'C' }, envelope(s, 'r3', 1)), /REVISION/);
  assert.throws(
    () => s.execute({ type: 'page.add', name: 'DIFFERENT' }, envelope(s, 'r1', 0)),
    /REQUEST_REUSED/,
  );
  assert.deepEqual(s.snapshot(), before);
});

test('revisions increase monotonically while project, page, and layer ids remain stable', () => {
  const s = fresh();
  const projectId = s.project.id;
  assert.match(projectId, uuid);
  assert.equal(s.project.revision, 0);
  const pageId = addPage(s, 'A');
  assert.match(pageId, uuid);
  assert.equal(s.project.revision, 1);
  const layerId = s.execute({ type: 'layer.add', pageId, kind: 'text' }).id!;
  assert.match(layerId, uuid);
  assert.equal(s.project.revision, 2);
  s.execute({ type: 'page.patch', pageId, patch: { name: '改过的名字' } });
  assert.equal(s.project.revision, 3);
  assert.equal(s.project.pages[0].id, pageId);
  assert.equal(s.project.pages[0].layers[0].id, layerId);
  s.undo();
  assert.equal(s.project.revision, 4);
  assert.equal(s.project.pages[0].name, 'A');
  assert.equal(s.project.pages[0].id, pageId);
  s.redo();
  assert.equal(s.project.revision, 5);
  assert.equal(s.project.pages[0].name, '改过的名字');
  assert.equal(s.project.id, projectId);
});

test('deleting a page cascades edges and undo/redo restores stable references', () => {
  const s = fresh();
  const a = addPage(s, 'A'),
    b = addPage(s, 'B'),
    c = addPage(s, 'C');
  s.execute({ type: 'start.set', pageId: a });
  const aToB = s.execute({ type: 'exit.add', pageId: a, label: '去 B', target: b }).id!;
  const bToA = s.execute({ type: 'exit.add', pageId: b, label: '回 A', target: a }).id!;
  const bToC = s.execute({ type: 'exit.add', pageId: b, label: '去 C', target: c }).id!;
  const before = s.snapshot(),
    deletedRevision = s.project.revision;
  s.execute({ type: 'page.delete', pageId: a });
  assert.deepEqual(
    s.project.pages.map((p) => p.id),
    [b, c],
  );
  assert.equal(s.project.startPageId, null);
  assert.equal(
    s.project.pages[0].exits.some((e) => e.target === a),
    false,
  );
  assert.deepEqual(
    s.project.pages[0].exits.map((e) => e.id),
    [bToC],
  );
  s.undo();
  assert.deepEqual(s.project.pages, before.pages);
  assert.equal(s.project.startPageId, a);
  assert.deepEqual(
    s.project.pages[0].exits.map((e) => e.id),
    [aToB],
  );
  assert.deepEqual(
    s.project.pages[1].exits.map((e) => e.id),
    [bToA, bToC],
  );
  assert.equal(s.project.revision, deletedRevision + 2);
  s.redo();
  assert.equal(s.project.startPageId, null);
  assert.deepEqual(
    s.project.pages.map((p) => p.id),
    [b, c],
  );
  assert.equal(s.project.revision, deletedRevision + 3);
});

test('failed commands preserve state, history, redo stack, and do not cache receipts', () => {
  const s = fresh();
  const a = addPage(s, 'A');
  addPage(s, 'B');
  s.undo();
  const before = s.snapshot(),
    revision = s.project.revision;
  const failed = envelope(s, 'retryable', revision);
  assert.throws(
    () => s.execute({ type: 'exit.add', pageId: a, label: '自身', target: a }, failed),
    /INVALID_TARGET/,
  );
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.project.revision, revision);
  assert.equal(s.canRedo, true);
  const bad = envelope(s, 'bad-shape', revision);
  assert.throws(
    () =>
      s.execute(
        { type: 'page.patch', pageId: a, patch: { layers: [] } } as unknown as Command,
        bad,
      ),
    /INVALID_COMMAND/,
  );
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.canRedo, true);
  assert.equal(s.canUndo, true);
  s.redo();
  assert.equal(s.project.pages.length, 2);
  assert.equal(s.canRedo, false);
  const now = s.project.revision;
  const result = s.execute({ type: 'page.add', name: 'C' }, envelope(s, 'bad-shape', now));
  assert.equal(result.revision, now + 1);
  assert.equal(s.project.pages.length, 3);
});

test('failed commands do not add an undo step', () => {
  const s = fresh();
  const a = addPage(s, 'A');
  const revision = s.project.revision;
  assert.throws(
    () => s.execute({ type: 'exit.add', pageId: a, label: '自身', target: a }),
    /INVALID_TARGET/,
  );
  assert.equal(s.project.revision, revision);
  assert.equal(s.canUndo, true);
  s.undo();
  assert.equal(s.project.pages.length, 0);
  assert.equal(s.project.revision, revision + 1);
});

test('envelopes require valid project ids and string request ids within the limit', () => {
  const s = fresh();
  const projectId = s.project.id;
  const add = { type: 'page.add', name: 'A' } as const;
  assert.throws(
    () => s.execute(add, { projectId: 'other', requestId: 'ok', expectedRevision: 0 }),
    /PROJECT_MISMATCH/,
  );
  for (const requestId of [123, '', 'x'.repeat(129)]) {
    assert.throws(
      () => s.execute(add, { projectId, requestId, expectedRevision: 0 } as unknown as Envelope),
      /INVALID_REQUEST_ID/,
    );
  }
  assert.equal(s.project.pages.length, 0);
  assert.equal(s.project.revision, 0);
});

test('batch page moves are one atomic command and one undo step', () => {
  const s = fresh();
  const a = addPage(s, 'A'),
    b = addPage(s, 'B'),
    c = addPage(s, 'C');
  const before = s.snapshot();
  const revision = s.project.revision;
  s.execute({
    type: 'pages.move',
    updates: [
      { pageId: a, position: { x: 80, y: 80 } },
      { pageId: b, position: { x: 440, y: 80 } },
      { pageId: c, position: { x: 800, y: 350 } },
    ],
  });
  assert.deepEqual(
    s.project.pages.map((page) => page.position),
    [
      { x: 80, y: 80 },
      { x: 440, y: 80 },
      { x: 800, y: 350 },
    ],
  );
  assert.equal(s.project.revision, revision + 1);
  s.undo();
  assert.deepEqual(s.snapshot().pages, before.pages);
  s.redo();
  assert.deepEqual(
    s.project.pages.map((page) => page.position),
    [
      { x: 80, y: 80 },
      { x: 440, y: 80 },
      { x: 800, y: 350 },
    ],
  );
});

test('batch page patches apply only supported appearance fields to every page', () => {
  const s = fresh();
  const a = addPage(s, 'A'),
    b = addPage(s, 'B');
  const before = s.snapshot();
  s.execute({
    type: 'pages.patch',
    pageIds: [a, b],
    patch: {
      background: '#123456',
      transition: { type: 'fade', duration: 1.4 },
    },
  });
  for (const page of s.project.pages) {
    assert.equal(page.background, '#123456');
    assert.deepEqual(page.transition, { type: 'fade', duration: 1.4 });
    assert.equal(page.exits.length, 0);
  }
  assert.throws(
    () =>
      s.execute({
        type: 'pages.patch',
        pageIds: [a],
        patch: { name: '批量改名' },
      } as unknown as Command),
    /INVALID_COMMAND/,
  );
  assert.throws(
    () => s.execute({ type: 'pages.move', updates: [] } as unknown as Command),
    /INVALID_COMMAND/,
  );
  s.undo();
  assert.deepEqual(s.snapshot().pages, before.pages);
});

test('batch commands reject duplicate or missing pages without mutating state', () => {
  const s = fresh();
  const a = addPage(s, 'A'),
    b = addPage(s, 'B');
  const before = s.snapshot();
  assert.throws(
    () =>
      s.execute({
        type: 'pages.move',
        updates: [
          { pageId: a, position: { x: 0, y: 0 } },
          { pageId: a, position: { x: 1, y: 1 } },
        ],
      }),
    /DUPLICATE_PAGE/,
  );
  assert.throws(
    () =>
      s.execute({
        type: 'pages.patch',
        pageIds: [a, 'missing'],
        patch: { background: '#111111' },
      }),
    /页面不存在/,
  );
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.canUndo, true, 'failed batch commands do not add history');
  s.undo();
  assert.equal(s.project.pages.length, 1);
  s.redo();
  assert.deepEqual(
    s.project.pages.map((page) => page.id),
    [a, b],
  );
});
