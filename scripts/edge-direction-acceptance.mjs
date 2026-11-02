import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const run = resolve('.agent/runs/ui-edge-directions/check-' + Date.now());
const project = join(run, 'project');
const profile = join(run, 'profile');
await mkdir(profile, { recursive: true });
await cp('examples/林间来信', project, { recursive: true });
const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.STUDIO_EXECUTABLE
    ? { executablePath: resolve(process.env.STUDIO_EXECUTABLE) }
    : {}),
  args: [...(process.env.STUDIO_EXECUTABLE ? [] : ['.']), `--project=${project}`],
  env,
});
let closed = false;
try {
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page, 'main window');
  page.setDefaultTimeout(12000);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  await page.getByLabel('连线方向图例').waitFor();
  await page.locator('.flow-column').first().waitFor();
  assert.equal(await page.locator('.flow-column-label').first().innerText(), '第 1 层');
  assert.equal(await page.locator('.page-card .page-level').first().innerText(), '第 1 层');
  const invoke = (action, payload) =>
    page.evaluate(
      async ({ action, payload }) => {
        const result = await window.studio.invoke(action, payload);
        if (!result.ok) throw Error(result.error);
        return result.value;
      },
      { action, payload },
    );
  const colors = () =>
    page
      .locator('.react-flow__edge-path')
      .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).stroke));
  let actual = await colors();
  assert.ok(actual.includes('rgb(78, 201, 122)'), `forward green missing: ${actual}`);
  assert.ok(actual.includes('rgb(223, 255, 0)'), `loop yellow missing: ${actual}`);
  assert.ok(actual.includes('rgb(217, 154, 255)'), `loop-back purple missing: ${actual}`);
  assert.deepEqual(
    await page
      .locator('.flow-legend > span')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent)),
    ['前进', '循环', '后退', '循环后退'],
  );
  assert.equal(await page.locator('.flow-legend-note').innerText(), '循环 = 环内前进');

  const state = await invoke('state');
  const source = state.project.pages[1];
  const added = await invoke('command', { type: 'page.add', name: '回看线索' });
  const backTarget = added.project.pages.at(-1);
  await invoke('command', {
    type: 'page.patch',
    pageId: backTarget.id,
    patch: { position: { x: 60, y: 520 } },
  });
  await invoke('command', {
    type: 'exit.add',
    pageId: source.id,
    label: '回头查看',
    target: backTarget.id,
  });
  await page.getByText('回头查看', { exact: true }).waitFor();
  actual = await colors();
  assert.ok(actual.includes('rgb(120, 150, 255)'), `back blue missing: ${actual}`);
  assert.ok(actual.includes('rgb(223, 255, 0)'), `loop yellow missing after add: ${actual}`);
  assert.ok(actual.includes('rgb(217, 154, 255)'), `loop-back purple missing after add: ${actual}`);
  assert.ok(actual.includes('rgb(78, 201, 122)'), `forward green missing after add: ${actual}`);
  await page.screenshot({ path: join(run, 'flow-directions.png') });
  await writeFile(
    join(run, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        colors: actual,
        legend: ['前进', '循环', '后退', '循环后退'],
        cycleNote: '循环 = 环内前进',
      },
      null,
      2,
    ),
  );
  console.log('PASS edge direction colors', run);
} finally {
  if (!closed) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
