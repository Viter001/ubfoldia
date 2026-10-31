import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_RECENT_PROJECTS,
  addRecentProject,
  parseRecentProjects,
  readRecentProjects,
  recentProjectsFile,
  removeRecentProject,
  writeRecentProjects,
  type RecentProject,
} from '../src/electron/recent-projects.ts';

const entry = (name: string, path: string, at: string): RecentProject => ({
  name,
  path,
  lastOpenedAt: at,
});

test('recent projects persist, sort newest first, and read back the same entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recent-test-'));
  try {
    await writeRecentProjects(dir, [
      entry('较旧工程', join(dir, 'older'), '2026-01-01T00:00:00.000Z'),
      entry('最新工程', join(dir, 'newest'), '2026-03-01T00:00:00.000Z'),
      entry('中间工程', join(dir, 'middle'), '2026-02-01T00:00:00.000Z'),
    ]);
    const file = recentProjectsFile(dir);
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(
      onDisk.map((item: RecentProject) => item.name),
      ['最新工程', '中间工程', '较旧工程'],
    );
    const result = await readRecentProjects(dir);
    assert.equal(result.warning, '');
    assert.deepEqual(
      result.entries.map((item) => item.name),
      ['最新工程', '中间工程', '较旧工程'],
    );
    assert.deepEqual(result.entries[0], {
      name: '最新工程',
      path: join(dir, 'newest'),
      lastOpenedAt: '2026-03-01T00:00:00.000Z',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('re-adding a project canonicalizes Windows paths, updates the name, and keeps one record', async () => {
  const first = addRecentProject(
    [],
    { name: '旧名称', path: 'C:\\Books\\Story', lastOpenedAt: '2026-01-01T00:00:00.000Z' },
    'win32',
  );
  const next = addRecentProject(
    first,
    { name: '新名称', path: 'c:\\books\\story\\', lastOpenedAt: '2026-02-01T00:00:00.000Z' },
    'win32',
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].name, '新名称');
  assert.equal(next[0].path, 'c:\\books\\story');
  assert.equal(next[0].lastOpenedAt, '2026-02-01T00:00:00.000Z');
});

test('the history is capped at ten entries, newest first', () => {
  let entries: RecentProject[] = [];
  for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i++) {
    entries = addRecentProject(entries, {
      name: '工程 ' + i,
      path: join(tmpdir(), 'recent-cap-' + i),
      lastOpenedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    });
  }
  assert.equal(entries.length, MAX_RECENT_PROJECTS);
  assert.equal(entries[0].name, '工程 12');
  assert.equal(entries.at(-1)?.name, '工程 3');
});

test('missing history is empty, while corrupt history is ignored with a visible warning and left untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recent-test-'));
  try {
    assert.deepEqual(await readRecentProjects(dir), { entries: [], warning: '' });
    const file = recentProjectsFile(dir);
    await writeFile(file, '{broken json', 'utf8');
    const result = await readRecentProjects(dir);
    assert.deepEqual(result.entries, []);
    assert.match(result.warning, /损坏|无法读取/);
    assert.equal(await readFile(file, 'utf8'), '{broken json');
    assert.deepEqual(parseRecentProjects('{"not":"a list"}').entries, []);
    assert.match(parseRecentProjects('{"not":"a list"}').warning, /格式/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid additions cannot replace valid history', () => {
  const valid = entry('保留工程', join(tmpdir(), 'recent-valid'), '2026-04-01T00:00:00.000Z');
  assert.deepEqual(addRecentProject([valid], { name: '相对路径', path: 'relative/story' }), [
    valid,
  ]);
  assert.deepEqual(addRecentProject([valid], { name: '', path: join(tmpdir(), 'blank') }), [valid]);
});

test('invalid records are filtered without rejecting valid history', () => {
  const good = entry('可用工程', join(tmpdir(), 'recent-good'), '2026-04-01T00:00:00.000Z');
  const result = parseRecentProjects(
    JSON.stringify([
      good,
      { name: '', path: join(tmpdir(), 'empty-name'), lastOpenedAt: good.lastOpenedAt },
      { name: '相对路径', path: 'relative/story', lastOpenedAt: good.lastOpenedAt },
      { name: '坏时间', path: join(tmpdir(), 'bad-time'), lastOpenedAt: 'not-a-date' },
      null,
    ]),
  );
  assert.deepEqual(result.entries, [good]);
  assert.match(result.warning, /4 条/);
});

test('removing a recent entry rewrites only the history and never deletes project files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recent-test-'));
  const project = join(dir, 'project');
  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'project.json'), '{"keep":true}', 'utf8');
    const history = [
      entry('保留工程', project, '2026-05-01T00:00:00.000Z'),
      entry('其他工程', join(dir, 'other'), '2026-04-01T00:00:00.000Z'),
    ];
    await writeRecentProjects(dir, history);
    const remaining = removeRecentProject(history, join(project, '.'));
    assert.deepEqual(
      remaining.map((item) => item.name),
      ['其他工程'],
    );
    await writeRecentProjects(dir, remaining);
    assert.equal(await readFile(join(project, 'project.json'), 'utf8'), '{"keep":true}');
    assert.deepEqual(
      (await readRecentProjects(dir)).entries.map((item) => item.name),
      ['其他工程'],
    );
    await writeRecentProjects(dir, []);
    assert.deepEqual(await readRecentProjects(dir), { entries: [], warning: '' });
    await access(join(project, 'project.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed atomic history write cleans its temporary file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recent-test-'));
  try {
    await mkdir(recentProjectsFile(dir));
    await assert.rejects(
      writeRecentProjects(dir, [entry('写不进去', join(dir, 'x'), '2026-01-01T00:00:00.000Z')]),
    );
    assert.deepEqual(await readdir(dir), ['recent-projects.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
