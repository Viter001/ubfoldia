import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const run = resolve('.agent/runs/mvp/flush-' + Date.now()),
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
let closed = false;
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
  await page.getByRole('button', { name: '编辑页面 ↗', exact: true }).first().click();
  await page.locator('.layer-name').filter({ hasText: '故事文字' }).click();
  await page.getByLabel('文字内容').fill('尚未失焦的预览文字');
  await page.getByRole('button', { name: '预览选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '从当前页预览', exact: true }).click();
  await page.locator('.player-stage').getByText('尚未失焦的预览文字', { exact: true }).waitFor();
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.getByLabel('文字内容').fill('输入状态按快捷键保存');
  await page.getByLabel('文字内容').press('Control+s');
  await page.waitForFunction(() => window.studio.invoke('state').then((r) => !r.value.dirty));
  let disk = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
  assert.equal(disk.pages[0].layers.find((l) => l.type === 'text').text, '输入状态按快捷键保存');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, dir);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: '选择位置并创建', exact: true }).click();
  await page.locator('.modal .form-error').filter({ hasText: '已有工程' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('文字内容').fill('关闭前未失焦也必须保存');
  const exit = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    setTimeout(
      () =>
        BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .close(),
      0,
    );
  });
  await page.getByRole('dialog', { name: '退出前保存更改？' }).waitFor();
  await page.getByRole('button', { name: '保存并退出', exact: true }).click();
  await exit;
  closed = true;
  disk = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
  assert.equal(disk.pages[0].layers.find((l) => l.type === 'text').text, '关闭前未失焦也必须保存');
  console.log(
    'PASS: pending text flush before preview, keyboard save and themed close confirmation; failed new project reports inside modal.',
    run,
  );
} finally {
  if (!closed) await app.evaluate(({ app }) => app.exit(0));
}
