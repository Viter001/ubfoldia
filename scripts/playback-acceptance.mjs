import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile, writeFile, chmod, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const run = resolve('.agent/runs/mvp/playback-' + Date.now()),
  dir = join(run, 'project'),
  profile = join(run, 'profile');
await mkdir(profile, { recursive: true });
await cp('examples/林间来信', dir, { recursive: true });
const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
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
    `--project=${dir}`,
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
  page.setDefaultTimeout(10000);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__audios = [];
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const a = Reflect.construct(target, args);
        window.__audios.push(a);
        return a;
      },
    });
  });
  const invoke = (action, payload) =>
    page.evaluate(async ({ action, payload }) => window.studio.invoke(action, payload), {
      action,
      payload,
    });
  const command = (payload) => invoke('command', payload);
  const original = (await invoke('state')).value.project;
  const [p1, p2, p3] = original.pages;
  await command({ type: 'page.patch', pageId: p2.id, patch: { music: p1.music, voice: p1.voice } });
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  await page.waitForFunction(
    () => window.__audios.filter((a) => !a.paused && a.currentTime > 0).length === 2,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.__audios.slice(-2).map((a) => ({ loop: a.loop, volume: a.volume })),
    ),
    [
      { loop: true, volume: 0.25 },
      { loop: false, volume: 0.25 },
    ],
  );
  await page.getByRole('button', { name: '展开信笺', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: '展开信笺', exact: true }).isDisabled());
  assert.ok(await page.evaluate(() => window.__audios.every((a) => a.paused)));
  await page.getByRole('button', { name: '追随萤火', exact: true }).waitFor();
  await page.waitForFunction(
    () => window.__audios.length >= 4 && window.__audios.slice(-2).every((a) => !a.paused),
  );
  await page.getByRole('button', { name: '追随萤火', exact: true }).click();
  await page.getByRole('button', { name: '回到岔路口', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.__audios.every((a) => a.paused)));
  await page.getByRole('button', { name: '回到岔路口', exact: true }).click();
  await page.getByRole('button', { name: '追随萤火', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      window.__audios.length >= 6 &&
      window.__audios.slice(-2).every((a) => a.currentTime > 0 && a.currentTime < 1),
  );
  assert.ok(
    await page
      .locator('.player-stage .layer')
      .evaluateAll((layers) =>
        layers.some((l) => getComputedStyle(l).animationDuration === '0.6s'),
      ),
  );
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  assert.ok(await page.evaluate(() => window.__audios.every((a) => a.paused)));
  assert.equal(await page.locator('.player-scene').count(), 0);
  await command({ type: 'start.set', pageId: null });
  assert.ok(await page.getByRole('button', { name: '从头预览', exact: true }).isDisabled());
  await command({ type: 'exit.add', pageId: p1.id, label: '未完成选择', target: null });
  await page.locator(`.react-flow__node[data-id="${p1.id}"]`).click();
  await page.getByRole('button', { name: '预览选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '从当前页预览', exact: true }).click();
  assert.ok(
    await page.getByRole('button', { name: '未完成选择 · 未连接', exact: true }).isDisabled(),
  );
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  const file = join(dir, 'project.json'),
    before = await readFile(file, 'utf8');
  await chmod(file, 0o444);
  try {
    const failed = await invoke('save');
    assert.equal(failed.ok, false);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await invoke('state')).value.dirty, true);
  } finally {
    await chmod(file, 0o666);
  }
  await invoke('save');
  const image = original.assets.find((a) => a.kind === 'image');
  await unlink(join(dir, image.path));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, file);
  await invoke('open');
  assert.ok((await invoke('state')).value.missing.includes(image.id));
  await page
    .locator(`.react-flow__node[data-id="${p1.id}"]`)
    .getByRole('button', { name: '编辑页面 ↗', exact: true })
    .click();
  await page.locator('.editor-canvas .scene-missing').waitFor();
  await page.screenshot({ path: join(run, 'missing.png') });
  console.log(
    'PASS: actual audio playback volume/loop, leave/exit cleanup, loop reentry, transition lock, fade config, no-start/dangling diagnostics, failed save preservation, missing-image placeholder.',
    run,
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
