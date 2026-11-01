import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../src/core/project.ts';
import { saveProject } from '../src/electron/storage.ts';
import { ProjectSession } from '../src/electron/session.ts';

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(join(tmpdir(), 'session-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test('opening a project sets root and starts clean; edits make it dirty and save resets the baseline', async (t) => {
  const base = await workspace(t);
  const dir = join(base, 'story');
  const project = createProject('林间来信', 1280, 720);
  await saveProject(dir, project);

  const session = new ProjectSession();
  assert.equal(session.dirty(), false);
  assert.equal((await session.state()).project, null);

  await session.open(dir);
  const opened = await session.state();
  assert.equal(opened.root, dir);
  assert.equal(opened.project?.name, '林间来信');
  assert.equal(opened.dirty, false);

  session.active().execute({ type: 'page.add', name: '第一页' });
  assert.equal(session.dirty(), true);
  await session.save();
  assert.equal(session.dirty(), false);
  assert.equal((await session.state()).dirty, false);
});

test('a failed switch keeps the current project, root, dirtiness and save baseline', async (t) => {
  const base = await workspace(t);
  const first = join(base, 'first');
  await saveProject(first, createProject('保留的工程', 1280, 720));
  const session = new ProjectSession();
  await session.open(first);
  session.active().execute({ type: 'page.add', name: '未保存页' });
  const dirtyState = await session.state();
  assert.equal(dirtyState.dirty, true);

  await assert.rejects(session.open(join(base, 'missing')), /ENOENT/);

  const after = await session.state();
  assert.equal(after.project?.id, dirtyState.project?.id);
  assert.equal(after.root, first);
  assert.equal(after.dirty, true, 'the unsaved edit is still detected against the old baseline');
});

test('switching to another project resets approval and media caches', async (t) => {
  const base = await workspace(t);
  const first = join(base, 'first');
  const second = join(base, 'second');
  await saveProject(first, createProject('第一个', 1280, 720));
  await saveProject(second, createProject('第二个', 1280, 720));
  const session = new ProjectSession();
  await session.open(first);
  session.approveRoot(base);
  session.media.set('fake/asset', join(base, 'file.png'));

  await session.open(second);
  const state = await session.state();
  assert.equal(state.project?.name, '第二个');
  assert.equal(state.root, second);
  assert.deepEqual(state.approvedRoots, []);
  assert.equal(session.media.size, 0);
});

test('state reports missing assets without caching their media path', async (t) => {
  const base = await workspace(t);
  const dir = join(base, 'story');
  const project = createProject('封面', 1280, 720);
  project.assets.push({
    id: 'cover',
    name: 'cover.png',
    kind: 'image',
    path: 'assets/cover.png',
    mime: 'image/png',
    width: 100,
    height: 100,
  });
  await saveProject(dir, project);
  const session = new ProjectSession();
  await session.open(dir);
  const state = await session.state();
  assert.deepEqual(state.missing, ['cover']);
  assert.equal(session.media.size, 0);
});
