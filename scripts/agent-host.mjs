import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const run = resolve('.agent/runs/mvp/host-' + Date.now()),
  projectDir = join(run, 'project'),
  profile = join(run, 'profile'),
  input = join(run, 'input');
await mkdir(profile, { recursive: true });
await mkdir(input);
await cp('examples/林间来信', projectDir, { recursive: true });
const original = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8')),
  asset = original.assets.find((a) => a.kind === 'image'),
  source = join(input, 'agent-source.png');
await cp(join(projectDir, asset.path), source);
const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ...(process.env.STUDIO_TEST_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--disable-gpu', '--disable-breakpad', '--disable-crash-reporter']
      : []),
    '.',
    `--project=${projectDir}`,
  ],
  env,
});
try {
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, input);
  await page.getByRole('button', { name: '授权素材文件夹', exact: true }).click();
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  const config = `mcp_servers={picture_book_studio={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(resolve('dist-electron/bridge.mjs'))}],cwd=${JSON.stringify(resolve('.'))},env={STUDIO_ENDPOINT=${JSON.stringify(join(profile, 'agent-endpoint.json'))}},tool_timeout_sec=120,default_tools_approval_mode="approve"}}`;
  const prompt = `This is an authorized acceptance test against a disposable local picture-book project. Use only picture_book_studio MCP tools. Do not inspect files, run shell commands, use skills for coding, or change configuration. First project_get. Then assets_import of ${JSON.stringify(source)}. Then pages_add named "Agent 真实宿主验证" with imported image asset ID. Then pages_connect from the original start page to the new page labeled "Agent 新分支". Read project_get to obtain the new image layer ID. Set that layer visible=false using layers_set_visibility, then project_save. Every mutation requires current projectId, a unique requestId and latest expectedRevision. Finally retry the exact pages_add call with its original requestId and arguments; confirm it returns the same ID. Then send a new pages_add requestId with the old expectedRevision; confirm REVISION_CONFLICT. Do not create any extra pages. Return a concise report of all six tools and the two conflict tests. The user has authorized these edits only to this disposable test project.`;
  const codexJS = join(process.env.APPDATA, 'npm/node_modules/@openai/codex/bin/codex.js');
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [
        codexJS,
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--json',
        '-C',
        resolve('.'),
        '-c',
        config,
        '-',
      ],
      { env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
    child.stdin.end(prompt);
  });
  await writeFile(join(run, 'host-events.jsonl'), result.stdout);
  await writeFile(join(run, 'host-stderr.log'), result.stderr);
  console.log('Real host exit:', result.code, 'evidence:', run);
  assert.equal(result.code, 0);
  const state = await page.evaluate(async () => {
    const r = await window.studio.invoke('state');
    return r.value;
  });
  assert.equal(state.project.pages.length, 6);
  const added = state.project.pages.find((p) => p.name === 'Agent 真实宿主验证');
  assert.ok(added);
  assert.equal(added.layers[0].visible, false);
  assert.equal(state.dirty, false);
  assert.ok(
    state.project.pages[0].exits.some((e) => e.label === 'Agent 新分支' && e.target === added.id),
  );
  await page.getByText('工程已更新，重新预览后生效', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Agent 新分支', exact: true }).count(), 0);
  await page.screenshot({ path: join(run, 'snapshot.png') });
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await page.evaluate(
    async () => (await window.studio.invoke('state')).value.project,
  );
  assert.equal(undone.pages.find((p) => p.id === added.id).layers[0].visible, true);
  console.log(
    'PASS: real Codex host six tools; resulting state, save, snapshot banner, UI undo verified. Inspect JSONL for retry/conflict results.',
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
