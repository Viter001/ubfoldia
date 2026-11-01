import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Window chrome + ribbon grouping acceptance.
//   node scripts/ribbon-window-acceptance.mjs
// Use STUDIO_EXECUTABLE=<PictureBookStudio.exe> to verify a packaged build
// (the current trial entry is E:/Test/PictureBookStudio/PictureBookStudio.exe).
// CSS geometry checks are advisory until the stylesheet lands; set
// STUDIO_STRICT_VISUAL=1 after CSS integration to make them hard failures.

const evidence = resolve('.agent/runs/ribbon-window/evidence');
await mkdir(evidence, { recursive: true });
const strictVisual = process.env.STUDIO_STRICT_VISUAL === '1';
const WELCOME_TITLE = '绘境 · 交互叙事工作台';
const projectTitle = (name) => `绘境 · ${name}`;
const dirtyTitle = (name) => `${projectTitle(name)} · 未保存`;

function visual(ok, message) {
  if (ok) console.log('VISUAL PASS:', message);
  else if (strictVisual) assert.fail(message);
  else console.warn('VISUAL PENDING (CSS 主代理负责):', message);
}

async function launch(userData, project) {
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
      ...(project ? ['--project=' + project] : []),
    ],
    env,
  });
  let page;
  for (let i = 0; i < 150; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page, 'main window loaded');
  return { app, page };
}

const projectDir = resolve('examples/林间来信');
const { app, page } = await launch(
  resolve('.agent/runs/ribbon-window/electron-profile'),
  projectDir,
);

try {
  await page.getByText('流程工作区', { exact: true }).waitFor();
  const initialState = await page.evaluate(async () => (await window.studio.invoke('state')).value);
  const name = initialState.project.name;

  // 1. Renderer platform contract: exposed, equal to the host, read-only,
  //    and no extra bridge methods were added.
  const platformInfo = await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window.studio, 'platform');
    const before = window.studio.platform;
    try {
      window.studio.platform = 'linux';
    } catch {
      // Frozen contextBridge objects throw in strict mode.
    }
    return {
      before,
      after: window.studio.platform,
      writable: descriptor?.writable,
      keys: Object.keys(window.studio).sort(),
    };
  });
  assert.equal(platformInfo.before, process.platform, 'renderer exposes process.platform');
  assert.equal(platformInfo.after, platformInfo.before, 'window.studio.platform is read-only');
  assert.notEqual(platformInfo.writable, true, 'platform descriptor is not writable');
  assert.deepEqual(platformInfo.keys, [
    'invoke',
    'onLeaveRequest',
    'onLeaveResult',
    'platform',
    'respondLeave',
    'subscribe',
  ]);

  // 2. Window chrome: the OS title bar is gone but native buttons still work.
  const chrome = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    return {
      bounds: win.getBounds(),
      content: win.getContentBounds(),
      resizable: win.isResizable(),
      minimizable: win.isMinimizable(),
      maximizable: win.isMaximizable(),
      title: win.getTitle(),
    };
  });
  console.log('Window chrome', JSON.stringify(chrome));
  if (process.platform === 'win32') {
    assert.ok(
      chrome.content.width >= chrome.bounds.width - 8 &&
        chrome.content.height >= chrome.bounds.height - 8,
      'content fills the window: the system title bar is hidden',
    );
  }
  assert.ok(
    chrome.resizable && chrome.minimizable && chrome.maximizable,
    'native window buttons remain',
  );

  // 3. The renderer supplies one 32px title strip and no hand-made buttons.
  const titlebar = page.locator('.app > .window-titlebar');
  await titlebar.waitFor();
  assert.equal(await titlebar.locator('.window-title').innerText(), projectTitle(name));
  assert.equal(await titlebar.locator('.save-status').count(), 0);
  assert.equal(await page.evaluate(() => document.title), projectTitle(name));
  assert.equal(await titlebar.locator('button').count(), 0, 'no custom minimize/maximize/close');
  assert.equal(await page.locator('.topbar').count(), 0, 'no duplicate topbar');
  const geometry = await titlebar.evaluate((el) => el.getBoundingClientRect().height);
  console.log('window-titlebar height (CSS 主代理):', geometry);
  visual(Math.abs(geometry - 32) < 0.5, `window-titlebar 高度应为 32px，实际 ${geometry}px`);
  const toolsWrap = await page
    .locator('.command-tools')
    .evaluate((el) => getComputedStyle(el).flexWrap);
  visual(toolsWrap === 'nowrap', `command-tools 应横向不换行，实际 flex-wrap: ${toolsWrap}`);

  // 4. Six command tabs with real grouped DOM. Tabs stay pure; context and
  //    workspace/preview actions share the outer toolbar.
  const tabs = await page.locator('.command-tabs [role="tab"]').allInnerTexts();
  assert.deepEqual(tabs, ['文件', '开始', '插入', '转场', '动画', '视图']);
  assert.equal(await page.locator('.workspace-toolbar > nav.command-tabs').count(), 1);
  assert.equal(await page.locator('.command-tabs .workspace-context').count(), 0);
  assert.equal(await page.locator('.workspace-toolbar > .workspace-context').count(), 1);
  assert.equal(
    await page.locator('.workspace-toolbar > .workspace-actions > .workspace-switch').count(),
    1,
  );
  assert.equal(
    await page.locator('.workspace-toolbar > .workspace-actions > .preview-control').count(),
    1,
  );
  assert.equal(await page.getByRole('button', { name: '从头预览', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '预览选项', exact: true }).count(), 1);

  async function groups() {
    return page.locator('#command-ribbon').evaluate((ribbon) => {
      const toolbar = ribbon.querySelector('.command-tools[role="toolbar"]');
      return {
        toolbarLabel: toolbar?.getAttribute('aria-label') ?? '',
        nested: !!ribbon.querySelector('.command-tools .ribbon-group'),
        groups: [...ribbon.querySelectorAll('.ribbon-group')].map((group) => ({
          label: group.getAttribute('aria-label'),
          role: group.getAttribute('role'),
          title: group.querySelector('.ribbon-group-title')?.textContent ?? '',
          controls: group.querySelectorAll('.ribbon-group-controls').length,
          buttons: group.querySelectorAll('button').length,
          placeholders: [...group.querySelectorAll('.ribbon-placeholder')].map(
            (node) => node.textContent ?? '',
          ),
        })),
      };
    });
  }

  const expected = {
    文件: ['工程'],
    开始: ['编辑历史', '页面', '素材'],
    插入: ['内容', '素材', '页面'],
    转场: ['页面转场', '计时', '换页方式'],
    动画: ['对象动画', '计时', '触发与排序'],
    视图: ['工作区', '画布'],
  };
  for (const [tab, labels] of Object.entries(expected)) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const info = await groups();
    assert.equal(info.toolbarLabel, tab + '命令');
    assert.ok(info.nested, tab + ' groups live inside the scrollable command-tools toolbar');
    assert.deepEqual(
      info.groups.map((group) => group.label),
      labels,
    );
    for (const group of info.groups) {
      assert.equal(group.role, 'group');
      assert.equal(group.title, group.label, 'ribbon-group-title mirrors aria-label');
      assert.equal(group.controls, 1, 'each group has one ribbon-group-controls');
    }
    assert.equal(
      await page.locator('#command-ribbon .ribbon-group[aria-label="预览"]').count(),
      0,
      tab + ' has no duplicate preview group',
    );
    console.log('Ribbon', tab, labels.join(' / '));
  }

  // 5. Existing buttons keep their names in the grouped 文件/开始/插入/视图 tabs.
  async function buttonNames(tab) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    return (await page.locator('#command-ribbon button').allInnerTexts()).map((text) =>
      text.replace(/\s+/g, ' ').trim(),
    );
  }
  assert.deepEqual(await buttonNames('文件'), ['新建', '打开', '保存']);
  for (const name of ['撤销', '重做', '＋ 新增页面', '导入素材'])
    assert.ok((await buttonNames('开始')).includes(name), '开始 keeps ' + name);
  assert.equal(
    (await buttonNames('开始')).includes('预览当前页'),
    false,
    '开始 preview group removed',
  );
  for (const name of ['＋ 添加文字', '＋ 添加图片', '导入素材', '＋ 新增页面'])
    assert.ok((await buttonNames('插入')).includes(name), '插入 keeps ' + name);
  for (const name of ['◇ 流程编排', '▣ 页面编辑', '适应画布'])
    assert.ok((await buttonNames('视图')).includes(name), '视图 keeps ' + name);

  // 6. Enter page edit mode so transition/animation controls target a page.
  await page.getByRole('button', { name: '编辑页面 ↗', exact: true }).first().click();
  await page.locator('.editor-layout').waitFor();
  const pageName = (await page.locator('.workspace-context strong').innerText()).trim();
  async function project() {
    const reply = await page.evaluate(() => window.studio.invoke('state'));
    assert.ok(reply.ok, 'state available');
    return reply.value.project;
  }
  async function waitForPage(predicate, label) {
    for (let i = 0; i < 50; i++) {
      const p = await project();
      const current = p.pages.find((item) => item.name === pageName);
      if (current && predicate(current)) return current;
      await page.waitForTimeout(100);
    }
    throw new Error('timed out waiting for ' + label);
  }

  // 7. 转场: reuse patchPage with the real transition model.
  await buttonNames('开始'); // page mode keeps 添加文字/添加图片
  assert.deepEqual(
    (await groups()).groups.map((group) => group.label),
    expected['开始'],
  );
  for (const name of ['撤销', '重做', '＋ 添加文字', '＋ 添加图片', '导入素材'])
    assert.ok((await buttonNames('开始')).includes(name), '页面开始 keeps ' + name);
  assert.equal(
    (await buttonNames('开始')).includes('预览当前页'),
    false,
    '页面开始 has no duplicate preview',
  );

  await page.getByRole('tab', { name: '转场', exact: true }).click();
  const transitionSelect = page.locator('.ribbon-group[aria-label="页面转场"] select');
  assert.equal(await transitionSelect.inputValue(), 'fade', 'sample page starts with fade');
  await transitionSelect.selectOption('none');
  await waitForPage((current) => current.transition.type === 'none', 'transition none');
  await transitionSelect.selectOption('fade');
  await waitForPage((current) => current.transition.type === 'fade', 'transition fade');
  const transitionDuration = page.locator('.ribbon-group[aria-label="计时"] input[type="number"]');
  await transitionDuration.fill('1.7');
  await transitionDuration.press('Enter');
  const tuned = await waitForPage(
    (current) => Math.abs(current.transition.duration - 1.7) < 0.01,
    'transition duration 1.7',
  );
  console.log('Transition patched', JSON.stringify(tuned.transition));
  assert.match(
    await page.locator('.ribbon-group[aria-label="页面转场"] .ribbon-placeholder').innerText(),
    /后续填充/,
  );
  assert.equal(await page.locator('.ribbon-group[aria-label="换页方式"] button').count(), 0);
  assert.match(
    await page.locator('.ribbon-group[aria-label="换页方式"] .ribbon-placeholder').innerText(),
    /后续填充/,
  );

  // 8. 动画: layer selection hint, then patchLayer on the real effect model.
  await page.getByRole('tab', { name: '动画', exact: true }).click();
  assert.ok(
    (await page.getByText('请先选择图层', { exact: true }).count()) >= 1,
    'animation asks for a layer before enabling controls',
  );
  const layerRow = page
    .locator('.library .layer-row .layer-name')
    .filter({ hasText: '森林插画 1' });
  await layerRow.click();
  await page.locator('.ribbon-group[aria-label="对象动画"] select').waitFor();
  assert.equal(await page.getByText('请先选择图层', { exact: true }).count(), 0);
  const layerSelect = page.locator('.ribbon-group[aria-label="对象动画"] select');
  assert.equal(await layerSelect.inputValue(), 'none');
  await layerSelect.selectOption('fade');
  const layerName = '森林插画 1';
  const effect = await waitForPage(
    (current) =>
      current.layers.some(
        (layerItem) => layerItem.name === layerName && layerItem.effect.type === 'fade',
      ),
    'layer effect fade',
  );
  const layerDuration = page.locator('.ribbon-group[aria-label="计时"] input[type="number"]');
  await layerDuration.fill('1.3');
  await layerDuration.press('Enter');
  const animated = await waitForPage(
    (current) =>
      current.layers.some(
        (layerItem) =>
          layerItem.name === layerName &&
          layerItem.effect.type === 'fade' &&
          Math.abs(layerItem.effect.duration - 1.3) < 0.01,
      ),
    'layer effect duration 1.3',
  );
  console.log(
    'Layer animation patched',
    JSON.stringify(animated.layers.find((l) => l.name === layerName).effect),
  );
  assert.match(
    await page.locator('.ribbon-group[aria-label="对象动画"] .ribbon-placeholder').innerText(),
    /后续填充/,
  );
  assert.equal(await page.locator('.ribbon-group[aria-label="触发与排序"] button').count(), 0);
  assert.match(
    await page.locator('.ribbon-group[aria-label="触发与排序"] .ribbon-placeholder').innerText(),
    /后续填充/,
  );
  await page.screenshot({ path: resolve(evidence, 'editor-ribbon.png') });

  // 9. Player keeps the same project/dirty title strip inside the .app wrapper.
  assert.equal(
    (await page.evaluate(async () => (await window.studio.invoke('state')).value)).dirty,
    true,
  );
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  const shell = page.locator('.app.player-shell');
  await shell.waitFor();
  assert.equal(
    await page.locator('.app.player-shell > .window-titlebar .window-title').innerText(),
    projectTitle(name),
  );
  assert.equal(
    await page.locator('.app.player-shell > .window-titlebar .save-status').innerText(),
    '● 未保存',
  );
  assert.equal(await page.evaluate(() => document.title), dirtyTitle(name));
  const playerLayout = await page.evaluate(() => {
    const bar = document.querySelector('.app.player-shell .window-titlebar');
    const player = document.querySelector('.app.player-shell .player');
    return {
      innerHeight,
      bar: bar?.getBoundingClientRect().height ?? 0,
      bottom: player?.getBoundingClientRect().bottom ?? 0,
      scroll: document.documentElement.scrollHeight,
    };
  });
  console.log('Player layout', JSON.stringify(playerLayout));
  visual(
    playerLayout.bottom <= playerLayout.innerHeight + 1,
    `预览包裹后内容不应溢出视口（bottom=${playerLayout.bottom}, viewport=${playerLayout.innerHeight}）`,
  );
  await page.screenshot({ path: resolve(evidence, 'player-titlebar.png') });
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.editor-layout').waitFor();

  console.log(
    'PASS: window chrome, platform bridge, six ribbon tabs, transition and animation edits',
  );
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
}

// 10. Welcome view also renders the title strip (separate profile, no project).
const welcome = await launch(resolve('.agent/runs/ribbon-window/welcome-profile'), null);
try {
  await welcome.page.locator('.welcome').waitFor();
  assert.equal(
    await welcome.page.locator('.app > .window-titlebar .window-title').innerText(),
    WELCOME_TITLE,
  );
  assert.equal(await welcome.page.locator('.app > .window-titlebar .save-status').count(), 0);
  assert.equal(await welcome.page.evaluate(() => document.title), WELCOME_TITLE);
  assert.equal(await welcome.page.locator('.topbar').count(), 0);
  assert.ok(
    (await welcome.page.getByText('把想象，连成故事。', { exact: true }).count()) === 1,
    'welcome screen still renders',
  );
  console.log('PASS: welcome view renders the title strip');
  await welcome.page.screenshot({ path: resolve(evidence, 'welcome-titlebar.png') });
} finally {
  await welcome.app.evaluate(({ app: electronApp }) => electronApp.exit(0));
}
