import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Theme menu acceptance. Run from the project root with an optional packed app:
//   node scripts/theme-acceptance.mjs
//   STUDIO_EXECUTABLE=E:/Test/Ubfoldia/Ubfoldia.exe node scripts/theme-acceptance.mjs
const run = resolve('.agent/runs/theme-acceptance/' + Date.now());
const projectDir = join(run, 'project');
const profile = join(run, 'profile');
const evidence = join(run, 'evidence');
await mkdir(profile, { recursive: true });
await mkdir(evidence, { recursive: true });
await cp('examples/林间来信', projectDir, { recursive: true });
const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.STUDIO_EXECUTABLE
    ? { executablePath: resolve(process.env.STUDIO_EXECUTABLE) }
    : {}),
  args: [...(process.env.STUDIO_EXECUTABLE ? [] : ['.']), '--project=' + projectDir],
  env,
});
const themes = [
  { id: 'tui-lime', name: 'TUI 酸黄', file: 'theme-tui-lime.png' },
  { id: 'claude-paper', name: 'Claude 暖纸', file: 'theme-claude-paper.png' },
  { id: 'claude-night', name: 'Claude 夜墨', file: 'theme-claude-night.png' },
  { id: 'tui-ice', name: 'TUI 冰蓝', file: 'theme-tui-ice.png' },
  { id: 'nord', name: 'Nord 冷夜', file: 'theme-nord.png' },
  { id: 'tokyo-night', name: 'Tokyo Night 蓝紫', file: 'theme-tokyo-night.png' },
  { id: 'rose-pine', name: 'Rosé Pine 暮紫', file: 'theme-rose-pine.png' },
  { id: 'tui-amber', name: 'TUI 琥珀', file: 'theme-tui-amber.png' },
];
async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.isVisible())
        .webContents.capturePage()
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(join(evidence, name), Buffer.from(png, 'base64'));
}
try {
  let page;
  for (let i = 0; i < 150; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(page, 'main window loaded');
  page.setDefaultTimeout(15000);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'tui-lime');
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await settings.click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await dialog.waitFor();
  assert.equal(await page.locator('.theme-option').count(), 8);
  assert.equal(await dialog.getByRole('tab').count(), 5);
  await dialog.getByRole('tab', { name: /编辑/ }).click();
  await dialog.getByRole('heading', { name: '编辑设置' }).waitFor();
  await dialog.getByRole('tab', { name: /外观/ }).click();
  await page.waitForTimeout(350);
  await shot('theme-menu.png');
  await page.getByRole('button', { name: '关闭设置' }).click();

  for (const theme of themes) {
    await settings.click();
    await page.locator('.theme-option').filter({ hasText: theme.name }).click();
    await page.waitForFunction((id) => document.documentElement.dataset.theme === id, theme.id);
    const state = await page.evaluate(
      ({ id }) => ({
        theme: document.documentElement.dataset.theme,
        stored: localStorage.getItem('ubfoldia.theme'),
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
      }),
      { id: theme.id },
    );
    assert.equal(state.theme, theme.id);
    assert.equal(state.stored, theme.id);
    console.log(theme.id, state.background, state.color);
    await page.waitForTimeout(350);
    await shot(theme.file);
  }

  // Persistence: the last non-default choice must survive a renderer reload.
  await settings.click();
  await page.locator('.theme-option').filter({ hasText: 'Claude 暖纸' }).click();
  await page.reload();
  await page.getByText('流程工作区', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'claude-paper');
  console.log('PASS settings shell, eight palettes, live switching, persistence');
  console.log(run);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
