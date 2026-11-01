import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = resolve('.agent/runs/2026-11-02-icon');
await mkdir(root, { recursive: true });
const bytes = await readFile('public/brand/ubfoldia.ico');
assert.equal(bytes.readUInt16LE(2), 1);
assert.equal(bytes.readUInt16LE(4), 7);
for (let i = 0; i < 7; i++) {
  const p = 6 + i * 16;
  const offset = bytes.readUInt32LE(p + 12);
  const len = bytes.readUInt32LE(p + 8);
  assert.ok(offset + len <= bytes.length);
  assert.equal(bytes.subarray(offset + 1, offset + 4).toString(), 'PNG');
}
const env = { ...process.env, STUDIO_USER_DATA: resolve(root, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.STUDIO_EXECUTABLE,
  args: process.env.STUDIO_EXECUTABLE ? [] : ['.'],
  env,
});
try {
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  await page.locator('.welcome').waitFor();
  await page.waitForFunction(() => {
    const i = document.querySelector('.window-brand-icon');
    return i?.complete && i.naturalWidth > 0;
  });
  assert.equal(await page.locator('.window-brand-icon').count(), 1);
  const metrics = await page.evaluate(() => {
    const i = document.querySelector('.window-brand-icon').getBoundingClientRect();
    const t = document.querySelector('.window-title').getBoundingClientRect();
    return {
      iconWidth: i.width,
      iconRight: i.right,
      titleLeft: t.left,
      favicon: document.querySelector('link[rel=icon]').href,
    };
  });
  assert.equal(metrics.iconWidth, 20);
  assert.ok(metrics.titleLeft >= metrics.iconRight);
  assert.ok(metrics.favicon.endsWith('/brand/ubfoldia.ico'));
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    return (await win.webContents.capturePage()).toPNG().toString('base64');
  });
  await writeFile(resolve(root, 'window-icon.png'), Buffer.from(png, 'base64'));
  console.log('PASS ICO 7 frames, title image loaded, title spacing and favicon', metrics);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
