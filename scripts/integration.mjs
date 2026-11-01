import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const run = resolve('.agent/runs/mvp/integration-' + Date.now()),
  projectDir = join(run, 'project'),
  userData = join(run, 'profile');
await mkdir(userData, { recursive: true });
await cp('examples/林间来信', projectDir, { recursive: true });
const env = { ...process.env, STUDIO_USER_DATA: userData, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.STUDIO_EXECUTABLE
    ? { executablePath: resolve(process.env.STUDIO_EXECUTABLE) }
    : {}),
  args: [
    ...(process.env.STUDIO_TEST_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--disable-gpu', '--disable-breakpad', '--disable-crash-reporter']
      : []),
    ...(process.env.STUDIO_EXECUTABLE ? [] : ['.']),
    `--project=${projectDir}`,
  ],
  env,
});
let client;
try {
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.setDefaultTimeout(10000);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  const invoke = (action, payload) =>
    page.evaluate(
      async ({ action, payload }) => {
        const r = await window.studio.invoke(action, payload);
        if (!r.ok) throw Error(r.error);
        return r.value;
      },
      { action, payload },
    );
  let state = await invoke('state');
  const original = state.project;
  const image = original.assets.find((a) => a.kind === 'image');
  const inputDir = join(run, 'input');
  await mkdir(inputDir);
  const formats = await page.evaluate(
    async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 144;
      canvas.getContext('2d').drawImage(image, 0, 0, 256, 144);
      return { jpg: canvas.toDataURL('image/jpeg'), webp: canvas.toDataURL('image/webp') };
    },
    'data:image/png;base64,' + (await readFile(join(projectDir, image.path))).toString('base64'),
  );
  for (const [ext, data] of Object.entries(formats))
    await writeFile(join(inputDir, 'sample.' + ext), Buffer.from(data.split(',')[1], 'base64'));
  await cp(join(projectDir, image.path), join(inputDir, 'sample.png'));
  const wav = original.assets.find((a) => a.kind === 'audio');
  await cp(join(projectDir, wav.path), join(inputDir, 'sample.wav'));
  for (const ext of ['mp3', 'm4a']) {
    const r = spawnSync(
      ffmpeg,
      ['-y', '-i', join(inputDir, 'sample.wav'), join(inputDir, 'sample.' + ext)],
      { windowsHide: true, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
  }
  await writeFile(join(inputDir, 'broken.png'), 'not an image');
  await writeFile(join(inputDir, 'unsupported.svg'), '<svg/>');
  const paths = [
    'sample.png',
    'sample.jpg',
    'sample.webp',
    'sample.wav',
    'sample.mp3',
    'sample.m4a',
    'broken.png',
    'unsupported.svg',
  ].map((x) => join(inputDir, x));
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
  const imported = await invoke('import');
  console.log(
    'Media formats:',
    imported.results.map((x) => ({
      path: x.path.split(/[\\\\/]/).pop(),
      ok: x.ok,
      error: x.error,
    })),
  );
  assert.equal(imported.results.filter((x) => x.ok).length, 6);
  assert.equal(imported.results.filter((x) => !x.ok).length, 2);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, inputDir);
  await invoke('approve');
  client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist-electron/bridge.mjs')],
      env: { ...process.env, STUDIO_ENDPOINT: join(userData, 'agent-endpoint.json') },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  async function tool(name, args = {}) {
    const r = await client.callTool({ name, arguments: args });
    return { error: r.isError, data: JSON.parse(r.isError ? 'null' : r.content[0].text), raw: r };
  }
  state = (await tool('project_get')).data;
  let rev = state.project.revision;
  const envFor = () => ({
    projectId: original.id,
    requestId: crypto.randomUUID(),
    expectedRevision: rev,
  });
  const importedByTool = await tool('assets_import', { ...envFor(), paths: [paths[0]] });
  assert.ok(!importedByTool.error);
  rev = importedByTool.data.revision;
  const args = { ...envFor(), name: 'Agent 页面', assetId: importedByTool.data.results[0].assetId };
  const added = await tool('pages_add', args);
  assert.ok(!added.error);
  rev = added.data.revision;
  assert.deepEqual((await tool('pages_add', args)).data, added.data);
  assert.ok((await tool('pages_add', { ...args, requestId: crypto.randomUUID() })).error);
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  const beforeScene = await page.locator('.player-stage').innerText();
  const linked = await tool('pages_connect', {
    ...envFor(),
    pageId: original.pages[0].id,
    target: added.data.id,
    label: 'Agent 分支',
  });
  assert.ok(!linked.error);
  rev = linked.data.revision;
  const fresh = (await tool('project_get')).data.project;
  const addedPage = fresh.pages.find((p) => p.id === added.data.id);
  const hidden = await tool('layers_set_visibility', {
    ...envFor(),
    pageId: addedPage.id,
    layerId: addedPage.layers[0].id,
    visible: false,
  });
  assert.ok(!hidden.error);
  rev = hidden.data.revision;
  await page.getByText('工程已更新，重新预览后生效', { exact: true }).waitFor();
  assert.equal(await page.locator('.player-stage').innerText(), beforeScene);
  assert.equal(await page.getByRole('button', { name: 'Agent 分支', exact: true }).count(), 0);
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  state = await invoke('state');
  assert.equal(state.project.pages.find((p) => p.id === addedPage.id).layers[0].visible, true);
  rev = state.project.revision;
  const saved = await tool('project_save', envFor());
  assert.ok(!saved.error);
  assert.equal(
    JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8')).pages.length,
    6,
  );
  console.log(
    'PASS: actual Electron import PNG/JPEG/WebP/WAV/MP3/M4A, corrupt/unsupported rejection, real MCP transport six tools, retry/stale/undo, snapshot isolation. This is SDK integration, NOT a real agent-host acceptance.',
  );
  await writeFile(
    join(run, 'results.json'),
    JSON.stringify(
      {
        formats: imported.results,
        revision: rev,
        scope: 'Electron + MCP SDK integration; real agent host still separate',
      },
      null,
      2,
    ),
  );
} finally {
  await client?.close();
  await app.evaluate(({ app }) => app.exit(0));
}
