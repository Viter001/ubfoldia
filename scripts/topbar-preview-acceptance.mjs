import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Topbar removal + fixed preview entry acceptance.
//   node scripts/topbar-preview-acceptance.mjs
// Use STUDIO_EXECUTABLE=<Ubfoldia.exe> to verify a packaged build.
const run = resolve('.agent/runs/topbar-preview/' + Date.now());
const projectDir = join(run, 'project');
const profile = join(run, 'profile');
const welcomeProfile = join(run, 'welcome-profile');
const evidence = join(run, 'evidence');
await mkdir(profile, { recursive: true });
await mkdir(welcomeProfile, { recursive: true });
await mkdir(evidence, { recursive: true });
await cp('examples/林间来信', projectDir, { recursive: true });

const sample = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8'));
const projectName = sample.name;
const startPage = sample.pages.find((page) => page.id === sample.startPageId);
const otherPage = sample.pages.find((page) => page.id !== sample.startPageId);
assert.ok(startPage && otherPage, 'sample project has a start page and another page');
const WELCOME_TITLE = '未视之视 · 交互叙事工作台';
const baseTitle = `未视之视 · ${projectName}`;
const dirtyTitle = `${baseTitle} · 未保存`;
const shots = [];

function launchOptions(userData, project) {
  const env = { ...process.env, STUDIO_USER_DATA: userData, TEMP: run, TMP: run };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    ...(process.env.STUDIO_EXECUTABLE
      ? { executablePath: resolve(process.env.STUDIO_EXECUTABLE) }
      : {}),
    args: [
      ...(process.env.STUDIO_TEST_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-gpu', '--disable-breakpad', '--disable-crash-reporter']
        : []),
      ...(process.env.STUDIO_EXECUTABLE ? [] : ['.']),
      ...(project ? [`--project=${project}`] : []),
    ],
    env,
  };
}

async function launch(userData, project) {
  const application = await electron.launch(launchOptions(userData, project));
  let page;
  for (let i = 0; i < 150; i++) {
    page = application.windows().find((window) => window.url().includes('index.html'));
    if (page) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(page, 'main window loaded');
  page.setDefaultTimeout(15000);
  return { application, page };
}

async function quit(application) {
  try {
    await application.evaluate(({ app }) => app.exit(0));
  } catch {
    await application.close().catch(() => {});
  }
}

async function state(page) {
  return page.evaluate(async () => (await window.studio.invoke('state')).value);
}

async function invoke(page, action, payload) {
  return page.evaluate(
    async ({ action, payload }) => {
      const reply = await window.studio.invoke(action, payload);
      if (!reply.ok) throw Error(reply.error);
      return reply.value;
    },
    { action, payload },
  );
}

async function expectDocumentTitle(page, title) {
  await page.waitForFunction((expected) => document.title === expected, title);
}

async function assertWindowChrome(page, { title, dirty }) {
  await expectDocumentTitle(page, title);
  if (process.platform !== 'win32') return;
  const titlebar = page.locator('.window-titlebar');
  assert.equal(await titlebar.count(), 1, 'single title strip');
  assert.equal(await page.locator('.app > .window-titlebar').count(), 1);
  assert.equal(await titlebar.locator('.window-title').innerText(), dirty ? baseTitle : title);
  assert.equal(await titlebar.locator('.save-status').count(), dirty ? 1 : 0);
  if (dirty) assert.equal(await titlebar.locator('.save-status').innerText(), '● 未保存');
}

async function toolbarLayout(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.workspace-toolbar');
    const nav = toolbar?.querySelector(':scope > nav.command-tabs');
    const context = toolbar?.querySelector(':scope > .workspace-context');
    const actions = toolbar?.querySelector(':scope > .workspace-actions');
    const workspaceSwitch = actions?.querySelector(':scope > .workspace-switch');
    const preview = actions?.querySelector(':scope > .preview-control');
    const primary = preview?.querySelector('.preview-primary');
    const toggle = preview?.querySelector('.preview-toggle');
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    return {
      topbars: document.querySelectorAll('.topbar').length,
      toolbars: document.querySelectorAll('.workspace-toolbar').length,
      titlebars: document.querySelectorAll('.window-titlebar').length,
      navTabs: nav ? nav.querySelectorAll('[role="tab"]').length : 0,
      navButtons: nav ? nav.querySelectorAll('button').length : 0,
      navStrayChildren: nav
        ? [...nav.children].filter((node) => node.tagName !== 'BUTTON').length
        : -1,
      context: !!context,
      actions: !!actions,
      switches: actions?.querySelectorAll(':scope > .workspace-switch').length ?? -1,
      previews: actions?.querySelectorAll(':scope > .preview-control').length ?? -1,
      primaryVisible: !!primary && primary.getBoundingClientRect().width > 0,
      toggleVisible: !!toggle && toggle.getBoundingClientRect().width > 0,
      toolbarRect: rect(toolbar),
      switchRect: rect(workspaceSwitch),
      previewRect: rect(preview),
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function assertFixedPreview(page) {
  const layout = await toolbarLayout(page);
  assert.equal(layout.topbars, 0, 'no duplicate topbar');
  assert.equal(layout.toolbars, 1, 'one workspace toolbar');
  assert.equal(layout.navTabs, 6, 'six tab buttons');
  assert.equal(layout.navButtons, 6, 'tablist contains only tab buttons');
  assert.equal(layout.navStrayChildren, 0, 'no context or actions inside the tablist');
  assert.equal(layout.context, true, 'workspace-context remains in the outer toolbar');
  assert.equal(layout.actions, true, 'workspace-actions remains in the outer toolbar');
  assert.equal(layout.switches, 1, 'one workspace switch');
  assert.equal(layout.previews, 1, 'one preview control');
  assert.ok(layout.primaryVisible, 'primary preview button stays visible');
  assert.ok(layout.toggleVisible, 'preview menu toggle stays visible');
  assert.ok(layout.switchRect && layout.previewRect);
  assert.ok(
    layout.previewRect.left >= layout.switchRect.right - 1,
    'preview control sits to the right of the workspace switch',
  );
  assert.ok(
    layout.previewRect.right <= layout.viewport.width + 1,
    `preview control fits the viewport (${layout.previewRect.right} <= ${layout.viewport.width})`,
  );
  assert.ok(
    layout.previewRect.top >= 0 && layout.previewRect.bottom <= layout.viewport.height + 1,
    'preview control fits vertically',
  );
  assert.ok(
    layout.scrollWidth <= layout.viewport.width + 1,
    `workspace toolbar does not create horizontal page overflow (${layout.scrollWidth} <= ${layout.viewport.width})`,
  );
  return layout;
}

async function saveShot(page, name) {
  const path = join(evidence, name);
  // Playwright screenshots crop wrongly after Chromium zoom changes; use the
  // window's own capture so the evidence shows the actual visible UI.
  const png = await application.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((window) => window.isVisible())
        .webContents.capturePage()
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path, Buffer.from(png, 'base64'));
  shots.push(path);
  console.log('Screenshot', path);
}

let application;
let page;

try {
  // 1. Welcome keeps create/open/recent and the full workspace title.
  ({ application, page } = await launch(welcomeProfile, null));
  await page.locator('.welcome').waitFor();
  await expectDocumentTitle(page, WELCOME_TITLE);
  assert.equal(await page.locator('.topbar').count(), 0, 'welcome has no duplicate topbar');
  await page.getByRole('button', { name: '＋ 创建第一个工程', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开已有工程', exact: true }).waitFor();
  await page.locator('.recent-projects').waitFor();
  assert.match(await page.locator('.recent-projects').getAttribute('aria-label'), /最近工程/);
  if (process.platform === 'win32') {
    assert.equal(
      await page.locator('.app > .window-titlebar .window-title').innerText(),
      WELCOME_TITLE,
    );
    assert.equal(await page.locator('.app > .window-titlebar .save-status').count(), 0);
  }
  await saveShot(page, 'welcome-1440.png');
  await quit(application);
  application = null;

  // 2. Project title and the single fixed preview entry on every command tab.
  ({ application, page } = await launch(profile, projectDir));
  await page.getByText('流程工作区', { exact: true }).waitFor();
  let current = await state(page);
  assert.equal(current.project.name, projectName);
  assert.equal(current.dirty, false);
  await assertWindowChrome(page, { title: baseTitle, dirty: false });
  await assertFixedPreview(page);

  for (const tab of ['文件', '开始', '插入', '转场', '动画', '视图']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.locator('#command-ribbon').waitFor();
    await assertFixedPreview(page);
    assert.equal(
      await page.locator('#command-ribbon .ribbon-group[aria-label="预览"]').count(),
      0,
      tab + ' has no duplicate preview group',
    );
    if (tab === '文件') {
      for (const name of ['新建', '打开', '保存'])
        assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1, name);
    } else {
      for (const name of ['新建', '打开', '保存'])
        assert.equal(
          await page.getByRole('button', { name, exact: true }).count(),
          0,
          name + ' only lives in the 文件 ribbon',
        );
    }
  }
  await page.getByRole('tab', { name: '开始', exact: true }).click();

  // 3. Disabled states are independent: start page vs. selected page.
  const toggle = page.getByRole('button', { name: '预览选项', exact: true });
  const primary = page.getByRole('button', { name: '从头预览', exact: true });
  const startItem = page.getByRole('menuitem', { name: '从头预览', exact: true });
  const currentItem = page.getByRole('menuitem', { name: '从当前页预览', exact: true });
  await toggle.click();
  await page.locator('.preview-menu').waitFor();
  assert.equal(await startItem.isDisabled(), false, 'start available before the test');
  assert.equal(await currentItem.isDisabled(), true, 'no page is selected initially');
  await page.keyboard.press('Escape');
  await page.locator('.preview-menu').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '预览选项',
  );

  await page.locator('.react-flow__node[data-id="' + otherPage.id + '"]').click();
  await invoke(page, 'command', { type: 'start.set', pageId: null });
  await page.waitForFunction(
    async () => (await window.studio.invoke('state')).value.project.startPageId === null,
  );
  assert.equal(await primary.isDisabled(), true, 'primary disabled without a start page');
  assert.equal(await toggle.isDisabled(), false, 'menu toggle remains available');
  await toggle.click();
  await page.locator('.preview-menu').waitFor();
  assert.equal(await startItem.isDisabled(), true, 'start item disabled without a start page');
  assert.equal(await currentItem.isDisabled(), false, 'current item enabled with a selected page');
  await page.locator('.workspace-context').click();
  await page.locator('.preview-menu').waitFor({ state: 'detached' });
  console.log('Disabled-state and outside-click checks passed');

  await invoke(page, 'command', { type: 'start.set', pageId: startPage.id });
  await page.waitForFunction(
    (id) => window.studio.invoke('state').then((reply) => reply.value.project.startPageId === id),
    startPage.id,
  );
  await invoke(page, 'command', {
    type: 'page.patch',
    pageId: startPage.id,
    patch: { background: '#0e1511' },
  });
  await page.waitForFunction(() =>
    window.studio.invoke('state').then((reply) => reply.value.dirty),
  );
  await assertWindowChrome(page, { title: dirtyTitle, dirty: true });

  // 4. From-start preview ignores the selected page and keeps project status.
  await page.locator('.react-flow__node[data-id="' + otherPage.id + '"]').click();
  await primary.click();
  await page.locator('.app.player-shell').waitFor();
  const startHeader = await page.locator('.player header').innerText();
  assert.ok(startHeader.includes(projectName), 'player header keeps project name');
  assert.ok(startHeader.includes(startPage.name), 'from-start preview opens the start page');
  if (process.platform === 'win32') {
    assert.equal(
      await page.locator('.app.player-shell > .window-titlebar .window-title').innerText(),
      baseTitle,
    );
    assert.equal(
      await page.locator('.app.player-shell > .window-titlebar .save-status').innerText(),
      '● 未保存',
    );
  }
  await expectDocumentTitle(page, dirtyTitle);
  await saveShot(page, 'preview-start-dirty.png');
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.app.player-shell').waitFor({ state: 'detached' });

  // 5. Mouse menu selection: the popup must remain mounted through pointerdown
  //    and open the selected page (not fall through to the ribbon behind it).
  await page.locator('.react-flow__node[data-id="' + otherPage.id + '"]').click();
  await toggle.click();
  await page.locator('.preview-menu').waitFor();
  await currentItem.click();
  await page.locator('.app.player-shell').waitFor();
  const mouseHeader = await page.locator('.player header').innerText();
  assert.ok(mouseHeader.includes(otherPage.name), 'mouse menu opens the selected page');
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.app.player-shell').waitFor({ state: 'detached' });
  console.log('Mouse menu selection passed');

  // 6. Keyboard menu: ArrowDown focuses entries, Enter previews the selected page.
  await page.locator('.react-flow__node[data-id="' + otherPage.id + '"]').click();
  await toggle.focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('.preview-menu').waitFor();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('role') === 'menuitem' &&
      document.activeElement.textContent?.trim() === '从头预览',
  );
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('role') === 'menuitem' &&
      document.activeElement.textContent?.trim() === '从当前页预览',
  );
  await page.keyboard.press('Enter');
  await page.locator('.app.player-shell').waitFor();
  const currentHeader = await page.locator('.player header').innerText();
  assert.ok(
    currentHeader.includes(otherPage.name),
    'from-current-page preview opens the selected page',
  );
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.app.player-shell').waitFor({ state: 'detached' });

  // 7. Escape and outside click close the menu; Escape restores toggle focus.
  await toggle.focus();
  await page.keyboard.press('ArrowUp');
  await page.locator('.preview-menu').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('Escape');
  await page.locator('.preview-menu').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '预览选项',
  );
  await toggle.click();
  await page.locator('.preview-menu').waitFor();
  await page.locator('.workspace-context').click();
  await page.locator('.preview-menu').waitFor({ state: 'detached' });
  console.log('Menu close checks passed');

  // 8. Blur-flush editor edit before the primary preview, then Ctrl+S.
  await page.locator('.react-flow__node[data-id="' + startPage.id + '"]').click();
  await page
    .locator('.react-flow__node[data-id="' + startPage.id + '"]')
    .getByRole('button', { name: '编辑页面 ↗', exact: true })
    .click();
  await page.locator('.editor-layout').waitFor();
  await page.locator('.library .layer-name').filter({ hasText: '故事文字' }).click();
  const pendingText = '未失焦点击预览也要保存';
  await page.getByLabel('文字内容').fill(pendingText);
  await primary.click();
  await page.locator('.app.player-shell').waitFor();
  await page.locator('.player-stage').getByText(pendingText, { exact: true }).waitFor();
  await expectDocumentTitle(page, dirtyTitle);
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.app.player-shell').waitFor({ state: 'detached' });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() =>
    window.studio.invoke('state').then((reply) => !reply.value.dirty),
  );
  await expectDocumentTitle(page, baseTitle);
  if (process.platform === 'win32')
    assert.equal(await page.locator('.window-titlebar .save-status').count(), 0);
  console.log('Blur-flush preview and Ctrl+S title cleanup passed');

  // 9. Four responsive captures at the required widths and zoom levels.
  async function setWindow(width, height) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((window) => window.isVisible());
        win.setSize(size.width, size.height);
        win.center();
      },
      { width, height },
    );
    await page.waitForTimeout(350);
  }
  async function setZoom(zoom) {
    await application.evaluate(({ BrowserWindow }, factor) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.isVisible())
        .webContents.setZoomFactor(factor);
    }, zoom);
    await page.waitForTimeout(350);
  }
  async function captureResponsive(width, zoom, name) {
    await setWindow(width, 900);
    await setZoom(zoom);
    await assertFixedPreview(page);
    await saveShot(page, name);
  }

  await page.getByRole('button', { name: '← 返回流程', exact: true }).click();
  await page.locator('.flow-canvas').waitFor();
  await captureResponsive(1440, 1.25, 'toolbar-1440-zoom125.png');
  await captureResponsive(1440, 1.5, 'toolbar-1440-zoom150.png');
  await captureResponsive(1000, 1.25, 'toolbar-1000-zoom125.png');
  await captureResponsive(1000, 1.5, 'toolbar-1000-zoom150.png');
  await toggle.click();
  await page.locator('.preview-menu').waitFor();
  const menuRect = await page.locator('.preview-menu').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  assert.ok(
    menuRect.right <= (await page.evaluate(() => innerWidth)) + 1,
    'menu fits horizontally',
  );
  assert.ok(
    menuRect.bottom <= (await page.evaluate(() => innerHeight)) + 1,
    'menu fits vertically',
  );
  await saveShot(page, 'toolbar-1000-zoom150-menu.png');
  await page.keyboard.press('Escape');
  await page.locator('.preview-menu').waitFor({ state: 'detached' });
  await setZoom(1);
  await setWindow(1440, 960);

  await writeFile(
    join(run, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        projectName,
        startPage: startPage.name,
        currentPage: otherPage.name,
        screenshots: shots,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: project/dirty window title, no duplicate topbar, fixed preview across all tabs, independent disabled states, mouse/keyboard from-start/current-page preview, blur-flush editing, Escape/outside close, Ctrl+S cleanup, responsive screenshots.',
  );
  console.log(run);
} catch (error) {
  if (page) {
    try {
      console.log((await page.locator('body').innerText()).slice(-4000));
      await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    } catch {}
  }
  throw error;
} finally {
  if (application) await quit(application).catch(() => {});
}
