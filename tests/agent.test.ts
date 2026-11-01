import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../src/core/project.ts';
import { saveProject } from '../src/electron/storage.ts';
import { ProjectSession } from '../src/electron/session.ts';
import { AssetService } from '../src/electron/assets.ts';
import { AgentService, AGENT_TOOLS } from '../src/electron/agent.ts';
import type { State } from '../src/shared/studio.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(join(tmpdir(), 'agent-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'story');
  await saveProject(dir, createProject('Agent 工程', 1280, 720));
  const session = new ProjectSession();
  await session.open(dir);
  const decoded: string[] = [];
  const assets = new AssetService({
    session,
    decoder: {
      decodeImage: async () => {
        decoded.push('image');
        return { width: 4, height: 3 };
      },
      decodeAudio: async () => {
        decoded.push('audio');
        return { duration: 2 };
      },
    },
  });
  const published: State[] = [];
  const publish = async () => {
    const state = await session.state();
    published.push(state);
    return state;
  };
  const agent = new AgentService({ session, assets, publish });
  return { base, dir, session, assets, agent, published, decoded };
}

const envelope = (session: ProjectSession, requestId: string, expectedRevision?: number) => ({
  projectId: session.active().project.id,
  requestId,
  expectedRevision: expectedRevision ?? session.active().project.revision,
});

test('project_get returns the snapshot plus the stable tool list', async (t) => {
  const f = await fixture(t);
  const result = (await f.agent.call('project_get', {})) as Record<string, any>;
  assert.equal(result.project.name, 'Agent 工程');
  assert.deepEqual(result.tools, [...AGENT_TOOLS]);
});

test('agent commands are idempotent per requestId and reject reuse or stale revisions', async (t) => {
  const f = await fixture(t);
  const first = (await f.agent.call('pages_add', {
    ...envelope(f.session, 'same-request', 0),
    name: 'Agent 页面',
  })) as { id: string; revision: number };
  assert.equal(first.revision, 1);
  const again = await f.agent.call('pages_add', {
    ...envelope(f.session, 'same-request', 0),
    name: 'Agent 页面',
  });
  assert.deepEqual(again, first);
  assert.equal(f.session.active().project.pages.length, 1);

  await assert.rejects(
    f.agent.call('pages_add', { ...envelope(f.session, 'same-request', 1), name: '不同参数' }),
    /REQUEST_REUSED/,
  );
  await assert.rejects(
    f.agent.call('pages_add', { ...envelope(f.session, 'stale', 0), name: '过期' }),
    /REVISION_CONFLICT/,
  );
});

test('agent edits use the same command history as the UI', async (t) => {
  const f = await fixture(t);
  await f.agent.call('pages_add', { ...envelope(f.session, 'page-one', 0), name: '页面' });
  assert.equal(f.session.active().canUndo, true);
  f.session.active().undo();
  assert.equal(f.session.active().project.pages.length, 0);
  assert.equal(f.session.active().canRedo, true);
});

test('assets_import requires an authorized root and copies approved files into the project', async (t) => {
  const f = await fixture(t);
  const allowed = join(f.base, 'allowed');
  const blocked = join(f.base, 'blocked');
  await mkdir(allowed, { recursive: true });
  await mkdir(blocked, { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await writeFile(join(allowed, 'cover.png'), png);
  await writeFile(join(blocked, 'secret.png'), png);

  await assert.rejects(
    f.agent.call('assets_import', {
      ...envelope(f.session, 'blocked', 0),
      paths: [join(blocked, 'secret.png')],
    }),
    /SOURCE_NOT_APPROVED/,
  );

  f.session.approveRoot(allowed);
  const result = (await f.agent.call('assets_import', {
    ...envelope(f.session, 'allowed', 0),
    paths: [join(allowed, 'cover.png')],
  })) as { results: { path: string; assetId?: string; ok: boolean }[]; revision: number };
  assert.equal(result.revision, 1);
  assert.equal(result.results[0].ok, true);
  const asset = f.session.active().project.assets[0];
  assert.equal(asset.kind, 'image');
  assert.equal(asset.width, 4);
  assert.deepEqual(f.decoded, ['image']);
  assert.ok((await stat(join(f.dir, asset.path))).isFile());
});

test('project_save writes the current revision and publishes the clean state', async (t) => {
  const f = await fixture(t);
  await f.agent.call('pages_add', { ...envelope(f.session, 'add', 0), name: '页面' });
  const result = (await f.agent.call('project_save', envelope(f.session, 'save'))) as {
    revision: number;
    saved: boolean;
  };
  assert.equal(result.saved, true);
  assert.equal(result.revision, 1);
  assert.equal(f.session.dirty(), false);
  const saved = JSON.parse(await readFile(join(f.dir, 'project.json'), 'utf8'));
  assert.equal(saved.pages.length, 1);
  assert.equal(f.published.at(-1)?.dirty, false);
});

test('unknown agent tools fail without touching the project', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.agent.call('made_up', envelope(f.session, 'nope')), /UNKNOWN_TOOL/);
  assert.equal(f.session.active().project.revision, 0);
});
