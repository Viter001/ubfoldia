import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.agent/runs/mvp/evidence', { recursive: true });
const userData = resolve('.agent/runs/mvp/electron-profile');
await mkdir(userData, { recursive: true });
const env = { ...process.env, STUDIO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.STUDIO_EXECUTABLE
    ? { executablePath: resolve(process.env.STUDIO_EXECUTABLE) }
    : {}),
  args: [
    ...(process.env.STUDIO_TEST_NO_SANDBOX === '1'
      ? [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-breakpad',
          '--disable-crash-reporter',
          '--user-data-dir=' + userData,
        ]
      : []),
    ...(process.env.STUDIO_EXECUTABLE ? [] : ['.']),
    `--project=${resolve('examples/林间来信')}`,
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
  assert.ok(page, 'main window loaded');
  const isolation = await app.evaluate(({ app, BrowserWindow }) => ({
    noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    windows: BrowserWindow.getAllWindows().map((window) => {
      const prefs = window.webContents.getLastWebPreferences();
      return {
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
      };
    }),
  }));
  if (process.env.STUDIO_TEST_NO_SANDBOX !== '1') {
    assert.equal(isolation.noSandbox, false, 'default launch must retain the Chromium sandbox');
  }
  for (const prefs of isolation.windows) {
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
  }
  console.log('Launch isolation', JSON.stringify(isolation));
  await page.getByText('流程工作区', { exact: true }).waitFor();
  assert.equal(await page.locator('.topbar').count(), 0, 'duplicate topbar removed');
  await page.screenshot({ path: '.agent/runs/mvp/evidence/flow.png' });
  for (const zoom of [1, 1.25, 1.5]) {
    await app.evaluate(
      ({ BrowserWindow }, z) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .webContents.setZoomFactor(z),
      zoom,
    );
    await page.waitForTimeout(250);
    console.log(
      'Scale metrics',
      zoom,
      await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        ratio: devicePixelRatio,
        bar: document.querySelector('.workspace-toolbar').getBoundingClientRect().width,
      })),
    );
    const capture = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .webContents.capturePage()
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(
      '.agent/runs/mvp/evidence/flow-scale-' + zoom + '.png',
      Buffer.from(capture, 'base64'),
    );
    const right = await page
      .locator('.workspace-actions')
      .evaluate((el) => el.getBoundingClientRect().right);
    assert.ok(
      right <= (await page.evaluate(() => innerWidth)) + 2,
      'toolbar remains inside viewport',
    );
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.setZoomFactor(1),
  );
  await page.getByRole('button', { name: '编辑页面 ↗', exact: true }).first().click();
  await page.getByText('图层属性', { exact: true }).count();
  await page.getByRole('button', { name: '＋ 添加文字', exact: true }).click();
  await page.locator('.inspector .panel-title').filter({ hasText: '图层属性' }).waitFor();
  await page.screenshot({ path: '.agent/runs/mvp/evidence/editor.png' });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  await page.getByRole('button', { name: '展开信笺', exact: true }).click();
  await page.getByRole('button', { name: '追随萤火', exact: true }).waitFor();
  await page.getByRole('button', { name: '追随萤火', exact: true }).click();
  await page.getByRole('button', { name: '回到岔路口', exact: true }).waitFor();
  await page.getByRole('button', { name: '回到岔路口', exact: true }).click();
  await page.getByRole('button', { name: '走向山谷', exact: true }).waitFor();
  await page.getByRole('button', { name: '走向山谷', exact: true }).click();
  await page.getByRole('button', { name: '继续前行', exact: true }).waitFor();
  await page.getByRole('button', { name: '继续前行', exact: true }).click();
  await page.getByText('本次阅读结束', { exact: true }).waitFor();
  await page.screenshot({ path: '.agent/runs/mvp/evidence/preview.png' });
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  console.log('PASS: Electron flow, page edit/undo, branch, cycle, ending; screenshots saved.');
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
