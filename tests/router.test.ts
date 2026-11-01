import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../src/core/project.ts';
import { saveProject } from '../src/electron/storage.ts';
import { ProjectSession } from '../src/electron/session.ts';
import { SerialQueue } from '../src/electron/queue.ts';
import { RecentProjectsService } from '../src/electron/recent-store.ts';
import { AssetService } from '../src/electron/assets.ts';
import { AgentService } from '../src/electron/agent.ts';
import { StudioRouter, type StudioDialogs } from '../src/electron/router.ts';
import type { State } from '../src/shared/studio.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(join(tmpdir(), 'router-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const userData = join(base, 'user-data');
  const dir = join(base, 'story');
  await saveProject(dir, createProject('林间来信', 1280, 720));
  const session = new ProjectSession();
  const recent = new RecentProjectsService(() => userData);
  const decoder = {
    decodeImage: async () => ({ width: 2, height: 2 }),
    decodeAudio: async () => ({ duration: 1.5 }),
  };
  const assets = new AssetService({ session, decoder });
  const published: State[] = [];
  const publish = async () => {
    const snapshot = await session.state();
    published.push(snapshot);
    return snapshot;
  };
  const agent = new AgentService({ session, assets, publish });
  const agentResets = { count: 0 };
  const resetAgent = agent.reset.bind(agent);
  agent.reset = () => {
    agentResets.count += 1;
    resetAgent();
  };
  const queue = new SerialQueue();
  const leaveReasons: string[] = [];
  const leave = {
    mayLeave: async (reason: string) => {
      leaveReasons.push(reason);
      return true;
    },
  };
  const dialogs: StudioDialogs = {
    pickNewProjectDirectory: async () => null,
    pickProjectFile: async () => null,
    pickImportFiles: async () => null,
    pickApprovedDirectory: async () => null,
  };
  const router = new StudioRouter({ session, recent, assets, agent, leave, dialogs, publish });
  return {
    base,
    dir,
    userData,
    session,
    recent,
    assets,
    agent,
    agentResets,
    queue,
    leave,
    dialogs,
    router,
    published,
    leaveReasons,
  };
}

function lastState(f: Fixture) {
  return f.published[f.published.length - 1];
}

test('opening a project replaces the session and records it as recent', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');

  const state = await f.router.handle('open');
  assert.equal(state?.project?.name, '林间来信');
  assert.equal(state?.root, f.dir);
  assert.equal(f.session.dirty(), false);
  assert.deepEqual(f.leaveReasons, ['open']);
  assert.equal(lastState(f).project?.name, '林间来信');
  const history = await f.recent.read();
  assert.deepEqual(
    history.entries.map((entry) => entry.name),
    ['林间来信'],
  );

  const recent = await f.router.handle('recent-open', f.dir);
  assert.equal(recent?.project?.name, '林间来信');
  assert.deepEqual(f.leaveReasons, ['open', 'open']);
});

test('cancelling ordinary open keeps the current project and only republishes it', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const projectId = f.session.active().project.id;
  const before = f.published.length;

  f.dialogs.pickProjectFile = async () => null;
  assert.equal(await f.router.handle('open'), null);
  assert.equal(f.session.active().project.id, projectId);
  assert.equal(f.session.projectRoot, f.dir);
  assert.ok(f.published.length > before, 'the renderer still receives a state refresh');
  assert.equal(lastState(f).project?.id, projectId);
});

test('cancelling new leaves no project behind and never writes a directory', async (t) => {
  const f = await fixture(t);
  const target = join(f.base, 'fresh');
  f.dialogs.pickNewProjectDirectory = async () => null;

  assert.equal(await f.router.handle('new', { name: '新故事', width: 1280, height: 720 }), null);
  assert.equal((await f.session.state()).project, null);
  await assert.rejects(access(join(target, 'project.json')));
});

test('creating a project writes it, opens it, and records it as recent', async (t) => {
  const f = await fixture(t);
  const target = join(f.base, 'fresh');
  f.dialogs.pickNewProjectDirectory = async () => target;

  const state = await f.router.handle('new', { name: '新故事', width: 720, height: 1280 });
  assert.equal(state?.project?.name, '新故事');
  assert.equal(state?.root, target);
  const saved = JSON.parse(await readFile(join(target, 'project.json'), 'utf8'));
  assert.equal(saved.name, '新故事');
  assert.equal(state?.project?.width, 720);
  assert.equal(f.session.dirty(), false);

  const history = await f.recent.read();
  assert.deepEqual(
    history.entries.map((entry) => entry.name),
    ['新故事'],
    'a created project is a completed switch and enters the recent history',
  );
});

test('creating into a directory that already has a project fails without replacing the session', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const projectId = f.session.active().project.id;
  f.dialogs.pickNewProjectDirectory = async () => f.dir;

  await assert.rejects(
    f.router.handle('new', { name: '覆盖', width: 1280, height: 720 }),
    /已有工程/,
  );
  assert.equal(f.session.active().project.id, projectId);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'project.json'), 'utf8')).name, '林间来信');
});

test('creating a project finishes the switch: recent history, warning cleanup and agent reset', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  f.recent.setWarning('旧的最近工程提示');
  const resetsBefore = f.agentResets.count;
  const target = join(f.base, 'fresh');
  f.dialogs.pickNewProjectDirectory = async () => target;

  const state = await f.router.handle('new', { name: '新故事', width: 720, height: 1280 });
  assert.equal(state?.project?.name, '新故事');
  assert.equal(state?.recentWarning, undefined, 'a completed switch drops the stale warning');
  assert.equal(f.agentResets.count, resetsBefore + 1, 'agent receipts reset with the session');

  const history = await f.recent.read();
  assert.deepEqual(
    history.entries.map((entry) => entry.name),
    ['新故事', '林间来信'],
    'the created project is remembered as the newest entry',
  );
  assert.equal(history.entries[0].path, target);
  const persisted = JSON.parse(await readFile(join(f.userData, 'recent-projects.json'), 'utf8'));
  assert.equal(persisted[0].name, '新故事', 'the recent record reached disk, not just memory');
  assert.equal(f.recent.takeWarning(), '');
});

test('cancelling new keeps the recent history, pending warning and agent receipts untouched', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  f.recent.setWarning('旧的最近工程提示');
  const before = await f.recent.read();
  const resetsBefore = f.agentResets.count;

  f.dialogs.pickNewProjectDirectory = async () => null;
  assert.equal(await f.router.handle('new', { name: '取消', width: 720, height: 1280 }), null);
  assert.equal(f.agentResets.count, resetsBefore, 'cancelling is not a completed switch');
  assert.deepEqual((await f.recent.read()).entries, before.entries);
  assert.equal(f.recent.takeWarning(), '旧的最近工程提示');
});

test('declining the unsaved-changes prompt does not finish or reset the switch', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  f.recent.setWarning('旧的最近工程提示');
  const resetsBefore = f.agentResets.count;
  f.leave.mayLeave = async (reason: string) => {
    f.leaveReasons.push(reason);
    return false;
  };

  assert.equal(await f.router.handle('new', { name: '取消', width: 720, height: 1280 }), null);
  assert.equal(f.agentResets.count, resetsBefore);
  assert.equal(f.recent.takeWarning(), '旧的最近工程提示');
});

test('the dynamic dispatch boundary validates command payloads at runtime', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const revision = f.session.active().project.revision;

  await assert.rejects(f.router.dispatch('command', { type: 'page.explode' }), /未知命令/);
  await assert.rejects(f.router.dispatch('command', { type: 'page.add' }), /INVALID_COMMAND/);
  await assert.rejects(f.router.dispatch('not-an-action'), /未知操作/);
  assert.equal(f.session.active().project.revision, revision, 'rejected commands do not mutate');
});

test('UI and agent commands share one serial queue and one undo history', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const project = f.session.active().project;
  assert.equal(project.revision, 0);

  const ui = f.queue.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return f.router.handle('command', { type: 'page.add', name: '人工页面' });
  });
  const agent = f.queue.run(() =>
    f.agent.call('pages_add', {
      projectId: project.id,
      requestId: 'agent-one',
      expectedRevision: 1,
      name: 'Agent 页面',
    }),
  );

  const uiState = await ui;
  const agentResult = (await agent) as { revision: number; id: string };
  assert.equal(uiState?.project?.revision, 1);
  assert.equal(agentResult.revision, 2);
  assert.deepEqual(
    (await f.session.state()).project?.pages.map((page) => page.name),
    ['人工页面', 'Agent 页面'],
  );

  const undone = await f.queue.run(() => f.router.handle('undo'));
  assert.equal(undone?.project?.pages.length, 1);
  assert.equal(undone?.project?.pages[0].name, '人工页面');

  const failed = f.queue.run(async () => {
    throw Error('队列失败');
  });
  const recovered = f.queue.run(() => f.router.handle('redo'));
  await assert.rejects(failed, /队列失败/);
  assert.equal((await recovered)?.project?.pages.length, 2);
});

test('a failed recent open reports a helpful error and keeps the old project', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const projectId = f.session.active().project.id;
  await f.recent.remember('已移动', join(f.base, 'moved-away'));

  await assert.rejects(
    f.router.handle('recent-open', join(f.base, 'moved-away')),
    /工程文件不存在或已被移动/,
  );
  assert.equal(f.session.active().project.id, projectId);
});

test('cancelling the import picker does not touch the project', async (t) => {
  const f = await fixture(t);
  f.dialogs.pickProjectFile = async () => join(f.dir, 'project.json');
  await f.router.handle('open');
  const before = f.session.active().project.revision;
  f.dialogs.pickImportFiles = async () => null;
  assert.equal(await f.router.handle('import'), null);
  assert.equal(f.session.active().project.revision, before);
});
