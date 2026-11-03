import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Acceptance for the 2026-11-03 flow-stage rework:
//   arrange, marquee selection/text isolation, minimap visibility and snapping.
// Optional packaged entry: STUDIO_EXECUTABLE=E:/Test/Ubfoldia/Ubfoldia.exe

const run = resolve('.agent/runs/flow-stage-fix/' + Date.now());
const projectDir = join(run, 'project');
const profile = join(run, 'profile');
const screenshots = join(run, 'screenshots');
await mkdir(profile, { recursive: true });
await mkdir(screenshots, { recursive: true });
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
let closed = false;
try {
  let page;
  for (let i = 0; i < 150; i++) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(page, 'main window loaded');
  page.setDefaultTimeout(15000);
  const screenshot = (name) => page.screenshot({ path: join(screenshots, name) });
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
    throw Error('timed out waiting for ' + label + ': ' + JSON.stringify(latest));
  };
  const fit = async () => {
    const viewTab = page.getByRole('tab', { name: '视图', exact: true });
    if ((await viewTab.getAttribute('aria-selected')) !== 'true') await viewTab.click();
    const fitButton = page.getByRole('button', { name: '适应画布', exact: true });
    if (!(await fitButton.isVisible())) {
      const ribbon = page.getByRole('button', { name: '展开工具区', exact: true });
      if (await ribbon.isVisible()) await ribbon.click();
    }
    await fitButton.click();
    await page.waitForTimeout(450);
  };
  const nodeBoxes = () =>
    page.locator('.react-flow__node').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          id: node.getAttribute('data-id'),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
  const assertNoOverlap = (boxes, label) => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(horizontal <= 1 || vertical <= 1, `${label}: ${a.id} overlaps ${b.id}`);
      }
    }
  };

  await page.getByText('流程工作区', { exact: true }).waitFor();
  await page.locator('.flow-column').first().waitFor();
  await fit();

  // 1. Minimap mask must leave nodes outside the viewport readable.
  const miniMask = await page
    .locator('.flow-minimap .react-flow__minimap-mask')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { fill: style.fill, fillOpacity: style.fillOpacity, stroke: style.stroke };
    });
  assert.equal(miniMask.fillOpacity, '0.38');
  assert.notEqual(miniMask.stroke, 'none');
  assert.ok((await page.locator('.react-flow__minimap-node').count()) >= 5);
  await screenshot('minimap-readable.png');

  // 2. One-click arrange: one command, columns preserved, no overlaps, undo restores.
  const beforeArrange = await state();
  await page.getByRole('button', { name: '整理排序', exact: true }).click();
  const arranged = await waitForState(
    (current) =>
      current.project.pages.some((item) => {
        const before = beforeArrange.project.pages.find((page) => page.id === item.id);
        return before.position.x !== item.position.x || before.position.y !== item.position.y;
      }),
    'one-click arrange',
  );
  await page.waitForTimeout(450);
  assertNoOverlap(await nodeBoxes(), 'arranged layout');
  const columns = (project) =>
    [...new Set(project.pages.map((item) => Math.round((item.position.x - 80) / 360)))].sort(
      (a, b) => a - b,
    );
  assert.deepEqual(columns(arranged.project), columns(beforeArrange.project));
  const arrangedBoxes = await nodeBoxes();
  assert.equal(arrangedBoxes.length, 5);
  await screenshot('arranged.png');
  const undoneArrange = await invoke('undo');
  assert.deepEqual(
    undoneArrange.project.pages.map((item) => item.position),
    beforeArrange.project.pages.map((item) => item.position),
  );
  await page.waitForTimeout(350);

  // 3. Shift-drag marquee selection must select cards, not browser text.
  await fit();
  const boxesForMarquee = await nodeBoxes();
  const left = Math.min(...boxesForMarquee.map((item) => item.left));
  const top = Math.min(...boxesForMarquee.map((item) => item.top));
  const right = Math.max(...boxesForMarquee.map((item) => item.right));
  const bottom = Math.max(...boxesForMarquee.map((item) => item.bottom));
  const canvas = await page.locator('.flow-canvas').boundingBox();
  assert.ok(canvas, 'flow canvas is visible');
  await page.keyboard.down('Shift');
  await page.mouse.move(Math.max(canvas.x + 4, left - 24), Math.max(canvas.y + 4, top - 24));
  await page.mouse.down();
  await page.mouse.move(
    Math.min(canvas.x + canvas.width - 4, right + 24),
    Math.min(canvas.y + canvas.height - 4, bottom + 24),
    { steps: 20 },
  );
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  const marqueeSelected = await page.locator('.react-flow__node.selected').count();
  assert.ok(marqueeSelected >= 2);
  assert.match(await page.locator('.inspector').innerText(), /批量属性/);
  assert.equal(
    await page.evaluate(() => String(window.getSelection() ?? '').trim()),
    '',
    'marquee must not create a browser text selection',
  );
  await screenshot('marquee-selection.png');
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await page.waitForTimeout(250);

  // 4. Dropping a card into a same-column neighbor must resolve to a gap.
  const current = await state();
  const [pageA, pageB] = current.project.pages.slice(0, 2);
  await invoke('command', {
    type: 'page.patch',
    pageId: pageA.id,
    patch: { position: { x: 80, y: 520 } },
  });
  await invoke('command', {
    type: 'page.patch',
    pageId: pageB.id,
    patch: { position: { x: 80, y: 80 } },
  });
  await page.waitForTimeout(500);
  await fit();
  const dragNode = page.locator(`.react-flow__node[data-id="${pageA.id}"]`);
  const dropNode = page.locator(`.react-flow__node[data-id="${pageB.id}"]`);
  const dragHeading = await dragNode.locator('.card-heading').boundingBox();
  const dropBox = await dropNode.boundingBox();
  assert.ok(dragHeading && dropBox, 'snap test nodes are visible');
  await page.mouse.move(
    dragHeading.x + dragHeading.width / 2,
    dragHeading.y + dragHeading.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + 26, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterSnap = await waitForState(
    (latest) => latest.project.pages.find((item) => item.id === pageA.id).position.y !== 520,
    'snapping drag committed',
  );
  const a = afterSnap.project.pages.find((item) => item.id === pageA.id);
  const b = afterSnap.project.pages.find((item) => item.id === pageB.id);
  assert.equal(a.position.x, 80);
  assert.equal(b.position.x, 80);
  const snapBoxes = await nodeBoxes();
  const boxA = snapBoxes.find((item) => item.id === pageA.id);
  const boxB = snapBoxes.find((item) => item.id === pageB.id);
  const vertical = Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top);
  assert.ok(vertical <= 1, `dropped cards overlap by ${vertical}px`);
  await screenshot('snap-no-overlap.png');

  await writeFile(
    join(run, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        minimap: miniMask,
        arrange: { pages: arranged.project.pages.length, columns: columns(arranged.project) },
        marquee: {
          selected: marqueeSelected,
          textSelection: '',
        },
        snap: { pageA: a.position, pageB: b.position, verticalOverlap: vertical },
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS stage fixes: minimap visibility, one-click arrange, marquee selection, snapping',
    run,
  );
} finally {
  if (!closed) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
