import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, readFile, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const run = resolve('.agent/runs/mvp/ui-' + Date.now()),
  projectDir = join(run, 'project'),
  profile = join(run, 'profile');
await mkdir(profile, { recursive: true });
await mkdir(projectDir);
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
  ],
  env,
});
let page;
try {
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.setDefaultTimeout(10000);
  const state = () => page.evaluate(async () => (await window.studio.invoke('state')).value);
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, projectDir);
  await page.getByRole('button', { name: '＋ 创建第一个工程', exact: true }).click();
  await page.getByLabel('工程名称', { exact: true }).fill('界面验收作品');
  await page.getByRole('button', { name: '选择位置并创建', exact: true }).click();
  await page.getByText('流程工作区', { exact: true }).waitFor();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '＋ 新增页面', exact: true }).first().click();
    await page.getByLabel('页面名称', { exact: true }).fill('手动页' + (i + 1));
    await page.getByLabel('页面名称', { exact: true }).press('Tab');
  }
  let s = await state();
  assert.equal(s.project.pages.length, 5);
  const ids = s.project.pages.map((p) => p.id);
  const source = JSON.parse(await readFile('examples/林间来信/project.json', 'utf8')).assets.find(
    (a) => a.kind === 'image',
  );
  const sourcePath = resolve('examples/林间来信', source.path);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, sourcePath);
  await page.getByRole('button', { name: '导入素材', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '导入成功' }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const card = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
  for (let i = 0; i < 5; i++) {
    await card(ids[i]).getByRole('button', { name: '编辑页面 ↗', exact: true }).click();
    await page.getByRole('button', { name: '＋ 添加文字', exact: true }).click();
    await page.getByLabel('文字内容').fill('这是第' + (i + 1) + '页');
    await page.getByLabel('文字内容').press('Tab');
    await page.getByRole('button', { name: '素材', exact: true }).click();
    await page.getByRole('button', { name: '添加到页面', exact: true }).click();
    await page.getByRole('button', { name: '下移一层', exact: true }).click();
    await page.getByRole('button', { name: '← 返回流程', exact: true }).click();
  }
  for (const [from, to] of [
    [0, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [3, 4],
  ]) {
    await card(ids[from]).click();
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click();
    await page.getByLabel('前往页面').last().selectOption(ids[to]);
  }
  s = await state();
  assert.deepEqual(
    s.project.pages.map((p) => p.layers.length),
    [2, 2, 2, 2, 2],
  );
  assert.deepEqual(
    s.project.pages.map((p) => p.exits.length),
    [1, 2, 1, 1, 0],
  );
  const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
  await card(ids[0]).getByRole('button', { name: '编辑页面 ↗', exact: true }).click();
  await page.getByRole('button', { name: '图层', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: '文字' }).first().click();
  const selected = page.locator('.editor-canvas .layer.selected');
  const box = await selected.boundingBox();
  assert.ok(box);
  const before = (await state()).project;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 45, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (rev) => window.studio.invoke('state').then((r) => r.value.project.revision > rev),
    before.revision,
  );
  const after = (await state()).project;
  assert.equal(after.revision, before.revision + 1);
  assert.notEqual(
    after.pages[0].layers.find((l) => l.type === 'text').x,
    before.pages[0].layers.find((l) => l.type === 'text').x,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(
    (await state()).project.pages[0].layers.find((l) => l.type === 'text').x,
    before.pages[0].layers.find((l) => l.type === 'text').x,
  );
  await page.getByRole('button', { name: '← 返回流程', exact: true }).click();
  assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), viewport);
  await card(ids[1]).click();
  await page.getByRole('button', { name: '删除页面', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  assert.equal((await state()).project.pages.length, 4);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual(
    (await state()).project.pages.map((p) => p.exits.length),
    [1, 2, 1, 1, 0],
  );
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.studio.invoke('state').then((r) => !r.value.dirty));
  const disk = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8'));
  assert.equal(disk.pages.length, 5);
  const moved = join(run, 'moved');
  await cp(projectDir, moved, { recursive: true });
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    },
    join(moved, 'project.json'),
  );
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开', exact: true }).click();
  assert.equal((await state()).missing.length, 0);
  assert.equal((await state()).canUndo, false);
  await page.screenshot({ path: join(run, 'created.png') });
  console.log(
    'PASS: UI-created 5 pages with text/images, branches/cycle, layer drag single undo, graph viewport restoration, page delete+undo, saved/moved/reopened project.',
    run,
  );
} catch (e) {
  if (page) {
    console.log((await page.locator('body').innerText()).slice(-4000));
    await page.screenshot({ path: join(run, 'failure.png') });
  }
  throw e;
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
