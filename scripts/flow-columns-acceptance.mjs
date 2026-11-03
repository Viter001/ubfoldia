import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Flow-columns review acceptance.
//   node scripts/flow-columns-acceptance.mjs
// Optional packaged entry: STUDIO_EXECUTABLE=E:/Test/Ubfoldia/Ubfoldia.exe
//
// The run uses its own temporary project copy and Electron profile, so the
// sample project and the normal desktop profile are never touched.

const run = resolve('.agent/runs/flow-columns/check-' + Date.now());
const projectDir = join(run, 'project');
const profile = join(run, 'profile');
const screenshots = join(run, 'screenshots');
await mkdir(profile, { recursive: true });
await mkdir(screenshots, { recursive: true });
await cp('examples/林间来信', projectDir, { recursive: true });

const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;

async function launch() {
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
            '--user-data-dir=' + profile,
          ]
        : []),
      ...(process.env.STUDIO_EXECUTABLE ? [] : ['.']),
      '--project=' + projectDir,
    ],
    env,
  });
  let page;
  for (let i = 0; i < 150; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(page, 'main window loaded');
  page.setDefaultTimeout(15000);
  return { app, page };
}

function columnOf(x) {
  return Math.max(0, Math.round((x - 80) / 360));
}
function snap(x) {
  return 80 + columnOf(x) * 360;
}
function tuples(project) {
  return project.pages
    .flatMap((page) =>
      page.exits.map((exit) => ({
        page: page.id,
        exit: exit.id,
        label: exit.label,
        target: exit.target,
      })),
    )
    .sort((a, b) => (a.page + a.exit).localeCompare(b.page + b.exit));
}
const sameTuples = (left, right) => JSON.stringify(tuples(left)) === JSON.stringify(tuples(right));

let session;
try {
  session = await launch();
  let { app, page } = session;
  const invoke = (action, payload) =>
    page.evaluate(
      async ({ action, payload }) => {
        const result = await window.studio.invoke(
          action,
          ...(payload === undefined ? [] : [payload]),
        );
        if (!result.ok) throw Error(result.error);
        return result.value;
      },
      { action, payload },
    );
  const state = () => invoke('state');
  const waitForState = async (predicate, label, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    let latest;
    while (Date.now() < deadline) {
      latest = await state();
      if (predicate(latest)) return latest;
      await page.waitForTimeout(100);
    }
    throw Error(
      'timed out waiting for ' +
        label +
        ': ' +
        JSON.stringify(latest?.project?.pages?.map((p) => p.position)),
    );
  };
  const screenshot = (name) => page.screenshot({ path: join(screenshots, name) });
  const colors = () =>
    page
      .locator('.react-flow__edge-path')
      .evaluateAll((paths) => [...new Set(paths.map((path) => getComputedStyle(path).stroke))]);

  await page.getByText('流程工作区', { exact: true }).waitFor();
  await page.locator('.flow-column').first().waitFor();
  await page.locator('.flow-legend').waitFor();

  // 1. Old projects are projected onto columns at render time only.
  const opened = await state();
  assert.equal(opened.dirty, false, 'opening an old project is not a dirty edit');
  const fork = opened.project.pages.find((item) => item.name === '岔路口');
  assert.ok(fork, 'sample branch page');
  assert.equal(fork.position.x, 410, 'sample keeps its legacy x on disk');
  const forkNode = page.locator(`.react-flow__node[data-id="${fork.id}"]`);
  const projected = await forkNode.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  assert.equal(projected.x, snap(410), 'legacy x is drawn on the nearest column');
  assert.equal(projected.y, 180, 'projection preserves y');
  assert.equal(
    (await forkNode.locator('.page-level').innerText()).trim(),
    '第 2 层',
    'card level label follows the projected column',
  );
  const diskBefore = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8'));
  assert.equal(
    diskBefore.pages.find((item) => item.name === '岔路口').position.x,
    410,
    'rendering projection does not rewrite the project file',
  );
  const columnCount = await page.locator('.flow-column').count();
  assert.ok(columnCount > 0 && columnCount <= 60, `bounded column count: ${columnCount}`);
  assert.equal(await page.locator('.flow-column-label').count(), columnCount);
  assert.equal(
    await page
      .locator('.flow-column')
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents),
    'none',
  );
  await screenshot('flow-columns.png');

  // 1b. Minimap, flat column treatment, multi-select and batch editing.
  await page.locator('.react-flow__minimap').waitFor();
  assert.match(await page.locator('.react-flow__minimap title').textContent(), /流程缩略图/);
  assert.ok((await page.locator('.react-flow__minimap-node').count()) >= 5);
  const viewportStroke = await page
    .locator('.react-flow__minimap-mask')
    .evaluate((element) => getComputedStyle(element).stroke);
  assert.notEqual(viewportStroke, 'none', 'minimap viewport has a visible border');
  assert.equal(
    await page
      .locator('.flow-column')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage),
    'none',
    'level columns no longer use gradient backgrounds',
  );

  // 1c. Connection dots are doubled and the enlarged practical hit area can
  //     complete a real drag from an existing exit to another page.
  const sourcePage = opened.project.pages.find((item) => item.exits.length > 0);
  const sourceExit = sourcePage?.exits[0];
  const targetPage = opened.project.pages.find(
    (item) => item.id !== sourcePage?.id && item.id !== sourceExit?.target,
  );
  assert.ok(sourcePage && sourceExit && targetPage, 'connection test pages exist');
  const sourceHandle = page.locator(`.flow-source-handle[data-exit-id="${sourceExit.id}"]`);
  const targetHandle = page.locator(`.flow-target-handle[data-page-id="${targetPage.id}"]`);
  assert.equal(
    await page.locator('.flow-target-handle').count(),
    opened.project.pages.length,
    'every card has one target dot',
  );
  assert.equal(
    await page.locator('.flow-source-handle').count(),
    opened.project.pages.reduce((count, item) => count + item.exits.length, 0),
    'every exit has one source dot',
  );
  const sourceDot = await sourceHandle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      renderedWidth: box.width,
      renderedHeight: box.height,
      label: element.getAttribute('aria-label'),
    };
  });
  assert.ok(
    sourceDot.width >= 20 && sourceDot.height >= 20,
    `source dot is 20px or larger: ${JSON.stringify(sourceDot)}`,
  );
  assert.match(sourceDot.label ?? '', /出口拖出连线/);
  await page.getByRole('tab', { name: '视图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.waitForTimeout(300);
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  assert.ok(sourceBox && targetBox, 'connection dots are visible for drag');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  const connected = await waitForState(
    (current) =>
      current.project.pages
        .find((item) => item.id === sourcePage.id)
        ?.exits.some((exit) => exit.id === sourceExit.id && exit.target === targetPage.id),
    'drag connection to target handle',
  );
  assert.equal(
    connected.project.pages
      .find((item) => item.id === sourcePage.id)
      .exits.find((exit) => exit.id === sourceExit.id).target,
    targetPage.id,
  );
  await screenshot('flow-connection-hotspots.png');
  const reconnectUndo = await invoke('undo');
  assert.equal(
    reconnectUndo.project.pages
      .find((item) => item.id === sourcePage.id)
      .exits.find((exit) => exit.id === sourceExit.id).target,
    sourceExit.target,
    'undo restores the previous connection target',
  );
  await page.getByRole('tab', { name: '开始', exact: true }).click();

  const batchA = fork;
  const batchB = opened.project.pages.find((item) => item.name === '走向山谷');
  assert.ok(batchB, 'second page for multi-selection');
  await page.locator(`.react-flow__node[data-id="${batchA.id}"]`).click();
  await page.locator(`.react-flow__node[data-id="${batchB.id}"]`).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.react-flow__node.selected').count(), 2);
  await page.getByText('批量属性 · 2 页', { exact: true }).waitFor();
  await page.locator('input[aria-label="批量背景颜色"]').evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, '#123456');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: '应用背景色到 2 页', exact: true }).click();
  const batched = await waitForState(
    (current) =>
      [batchA.id, batchB.id].every(
        (id) => current.project.pages.find((page) => page.id === id)?.background === '#123456',
      ),
    'batch background edit',
  );
  assert.equal(batched.project.pages.find((page) => page.id === batchA.id).background, '#123456');
  assert.equal(batched.project.pages.find((page) => page.id === batchB.id).background, '#123456');
  await screenshot('flow-batch-editing.png');

  const beforeBatchDrag = await state();
  const dragA = beforeBatchDrag.project.pages.find((page) => page.id === batchA.id);
  const dragB = beforeBatchDrag.project.pages.find((page) => page.id === batchB.id);
  const nodeTransform = (id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42 };
    });
  const localBeforeA = await nodeTransform(batchA.id);
  const localBeforeB = await nodeTransform(batchB.id);
  const batchDragNode = page.locator(`.react-flow__node[data-id="${batchA.id}"]`);
  const batchDragBox = await batchDragNode.locator('.card-heading').boundingBox();
  assert.ok(batchDragBox, 'selected card is visible for batch drag');
  await page.mouse.move(
    batchDragBox.x + batchDragBox.width / 2,
    batchDragBox.y + batchDragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    batchDragBox.x + batchDragBox.width / 2 + 300,
    batchDragBox.y + batchDragBox.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();
  const afterBatchDrag = await waitForState((current) => {
    const a = current.project.pages.find((page) => page.id === batchA.id);
    const b = current.project.pages.find((page) => page.id === batchB.id);
    return a.position.x !== dragA.position.x && b.position.x !== dragB.position.x;
  }, 'batch drag');
  const movedA = afterBatchDrag.project.pages.find((page) => page.id === batchA.id);
  const movedB = afterBatchDrag.project.pages.find((page) => page.id === batchB.id);
  const localAfterA = await nodeTransform(batchA.id);
  const localAfterB = await nodeTransform(batchB.id);
  assert.equal(localAfterA.x - localBeforeA.x, localAfterB.x - localBeforeB.x);
  assert.equal(localAfterA.y - localBeforeA.y, localAfterB.y - localBeforeB.y);
  assert.equal(movedA.position.x, snap(movedA.position.x));
  assert.equal(movedB.position.x, snap(movedB.position.x));
  assert.ok(sameTuples(beforeBatchDrag.project, afterBatchDrag.project));
  const undoBatch = await invoke('undo');
  assert.deepEqual(
    undoBatch.project.pages.find((page) => page.id === batchA.id).position,
    dragA.position,
  );
  assert.deepEqual(
    undoBatch.project.pages.find((page) => page.id === batchB.id).position,
    dragB.position,
  );
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await page.waitForTimeout(250);

  // 2. Build a deterministic layout with all four edge classes.
  const added = await invoke('command', { type: 'page.add', name: '回看支线' });
  const backTarget = added.project.pages.find((item) => item.name === '回看支线');
  await invoke('command', {
    type: 'page.patch',
    pageId: backTarget.id,
    patch: { position: { x: 80, y: 620 } },
  });
  await invoke('command', {
    type: 'exit.add',
    pageId: fork.id,
    label: '回看支线',
    target: backTarget.id,
  });
  await page.locator('.react-flow__edge-text').filter({ hasText: '回看支线' }).waitFor();
  await page.waitForTimeout(150);
  const actualColors = await colors();
  assert.ok(actualColors.includes('rgb(78, 201, 122)'), `forward green missing: ${actualColors}`);
  assert.ok(actualColors.includes('rgb(223, 255, 0)'), `loop yellow missing: ${actualColors}`);
  assert.ok(actualColors.includes('rgb(120, 150, 255)'), `back blue missing: ${actualColors}`);
  assert.ok(
    actualColors.includes('rgb(217, 154, 255)'),
    `loop-back purple missing: ${actualColors}`,
  );
  assert.deepEqual(
    await page
      .locator('.flow-legend > span')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent)),
    ['前进', '循环', '后退', '循环后退'],
  );
  assert.equal(await page.locator('.flow-legend-note').innerText(), '循环 = 环内前进');
  await screenshot('flow-four-directions.png');

  // 3. Drag across columns. Overlap is explicitly allowed so the drag can be
  //    tested independently of collision avoidance; vertical edge snap may
  //    still align the card to a nearby slot.
  const overlapToggle = page.getByLabel('允许卡片重叠', { exact: true });
  assert.equal(await overlapToggle.isChecked(), false);
  await overlapToggle.check();
  await page.getByRole('tab', { name: '视图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.waitForTimeout(300);

  const beforeDrag = await state();
  const dragPage = beforeDrag.project.pages.find((item) => item.name === '走向山谷');
  assert.ok(dragPage, 'drag target page');
  const beforeX = dragPage.position.x;
  const beforeColumn = columnOf(beforeX);
  const dragNode = page.locator(`.react-flow__node[data-id="${dragPage.id}"]`);
  const heading = dragNode.locator('.card-heading');
  const box = await heading.boundingBox();
  assert.ok(box, 'drag target is visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 480, box.y + box.height / 2, { steps: 14 });
  await page.mouse.up();
  const dragged = await waitForState((current) => {
    const moved = current.project.pages.find((item) => item.id === dragPage.id);
    return columnOf(moved.position.x) !== beforeColumn;
  }, 'dragged page to cross a column');
  const movedPage = dragged.project.pages.find((item) => item.id === dragPage.id);
  assert.equal(movedPage.position.x, snap(movedPage.position.x), 'dropped x snaps to a column');
  assert.ok(columnOf(movedPage.position.x) !== beforeColumn, 'drag crossed a column');
  assert.ok(
    sameTuples(beforeDrag.project, dragged.project),
    'connections are byte-for-byte unchanged',
  );
  const draggedNode = page.locator(`.react-flow__node[data-id="${dragPage.id}"]`);
  const draggedProjection = await draggedNode.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  assert.equal(draggedProjection.x, movedPage.position.x, 'card is drawn on the snapped column');
  assert.equal(
    (await draggedNode.locator('.page-level').innerText()).trim(),
    '第 ' + (columnOf(movedPage.position.x) + 1) + ' 层',
  );
  await screenshot('flow-drag-snapped.png');
  await overlapToggle.uncheck();
  assert.equal(await overlapToggle.isChecked(), false);

  // 4. Undo restores the old layout; redo restores the snapped layout.
  const undone = await invoke('undo');
  const undonePage = undone.project.pages.find((item) => item.id === dragPage.id);
  assert.deepEqual(undonePage.position, dragPage.position, 'undo restores the pre-drag position');
  assert.ok(sameTuples(beforeDrag.project, undone.project), 'undo keeps connections unchanged');
  const redone = await invoke('redo');
  const redonePage = redone.project.pages.find((item) => item.id === dragPage.id);
  assert.deepEqual(redonePage.position, movedPage.position, 'redo restores the snapped position');

  // 5. Save and reopen from disk: position persists, connections do not move.
  const saved = await invoke('save');
  assert.equal(saved.dirty, false, 'save clears dirty');
  const diskAfter = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8'));
  const diskPage = diskAfter.pages.find((item) => item.name === '走向山谷');
  assert.deepEqual(diskPage.position, redonePage.position, 'saved file keeps the snapped x and y');
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  session = null;
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));

  session = await launch();
  ({ app, page } = session);
  await page.getByText('流程工作区', { exact: true }).waitFor();
  await page.locator('.flow-column').first().waitFor();
  const reopened = await state();
  const reopenedPage = reopened.project.pages.find((item) => item.name === '走向山谷');
  assert.deepEqual(reopenedPage.position, redonePage.position, 'reopen keeps the saved position');
  assert.ok(sameTuples(redone.project, reopened.project), 'reopen keeps every connection');
  const reopenedNode = page.locator(`.react-flow__node[data-id="${reopenedPage.id}"]`);
  const reopenedProjection = await reopenedNode.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  assert.ok(Math.abs(reopenedProjection.x - reopenedPage.position.x) < 0.01);
  assert.ok(Math.abs(reopenedProjection.y - reopenedPage.position.y) < 0.01);
  await screenshot('flow-reopened.png');

  // 6. Collapse gives the canvas the ribbon's height; tabs, work area and
  //    preview stay reachable, and both click and keyboard expand again.
  const canvas = page.locator('.flow-canvas');
  const heightBefore = (await canvas.boundingBox()).height;
  await page.getByRole('button', { name: '收起工具区', exact: true }).click();
  await page.getByRole('button', { name: '展开工具区', exact: true }).waitFor();
  const toggle = page.getByRole('button', { name: '展开工具区', exact: true });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.getAttribute('aria-controls'), 'command-ribbon');
  assert.equal(await page.locator('#command-ribbon').isVisible(), false, 'tabpanel is hidden');
  const heightAfter = (await canvas.boundingBox()).height;
  assert.ok(
    heightAfter > heightBefore + 20,
    `collapse grows canvas: ${heightBefore} -> ${heightAfter}`,
  );
  assert.equal(await page.getByRole('tab', { name: '转场', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '从头预览', exact: true }).isVisible(), true);
  await screenshot('flow-ribbon-collapsed.png');

  await page.getByRole('tab', { name: '转场', exact: true }).click();
  await page.locator('#command-ribbon .ribbon-group[aria-label="页面转场"]').waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '收起工具区', exact: true })
      .getAttribute('aria-expanded'),
    'true',
  );

  await page.getByRole('button', { name: '收起工具区', exact: true }).click();
  await page.getByRole('button', { name: '展开工具区', exact: true }).waitFor();
  await page.getByRole('tab', { name: '转场', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('#command-ribbon .command-tools[aria-label="动画命令"]').waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '收起工具区', exact: true })
      .getAttribute('aria-expanded'),
    'true',
  );
  await screenshot('flow-ribbon-expanded.png');

  await page.getByRole('button', { name: '收起工具区', exact: true }).click();
  await page.getByRole('button', { name: '从头预览', exact: true }).click();
  await page.locator('.app.player-shell').waitFor();
  await screenshot('flow-preview-while-collapsed.png');
  await page.getByRole('button', { name: '退出预览 Esc' }).click();
  await page.locator('.flow-canvas').waitFor();
  await screenshot('flow-after-preview.png');

  await writeFile(
    join(run, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        columns: columnCount,
        colors: actualColors,
        legend: ['前进', '循环', '后退', '循环后退'],
        cycleNote: '循环 = 环内前进',
        minimap: {
          present: true,
          nodes: await page.locator('.react-flow__minimap-node').count(),
          viewportStroke,
        },
        flatColumns: true,
        connectionDots: {
          size: sourceDot,
          dragConnected: true,
          undoRestored: true,
          targetPage: targetPage.name,
        },
        overlapControl: { defaultAllowed: false, toggleWorks: true },
        batch: {
          selected: 2,
          background: '#123456',
          dragDeltaA: {
            x: movedA.position.x - dragA.position.x,
            y: movedA.position.y - dragA.position.y,
          },
          dragDeltaB: {
            x: movedB.position.x - dragB.position.x,
            y: movedB.position.y - dragB.position.y,
          },
          oneUndoRestored: true,
        },
        drag: {
          before: dragPage.position,
          snapped: movedPage.position,
          undone: undonePage.position,
          reopened: reopenedPage.position,
          connectionsUnchanged: true,
        },
        collapse: { heightBefore, heightAfter },
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS flow columns, 20px connection dots and drag, minimap, flat columns, batch edit/drag/undo, four edge classes, save/reopen, ribbon collapse',
    run,
  );
} finally {
  if (session?.app) {
    await session.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
