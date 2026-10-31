import { _electron as electron } from 'playwright';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const run = resolve('.agent/runs/mvp/recent-' + Date.now());
const projectDir = join(run, 'project');
const profile = join(run, 'profile');
const historyFile = join(profile, 'recent-projects.json');
await mkdir(profile, { recursive: true });
await mkdir(projectDir, { recursive: true });

function launchOptions() {
  const env = { ...process.env, STUDIO_USER_DATA: profile, TEMP: run, TMP: run };
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
    ],
    env,
  };
}

async function launch() {
  const application = await electron.launch(launchOptions());
  let page;
  for (let i = 0; i < 100; i++) {
    page = application.windows().find((window) => window.url().includes('index.html'));
    if (page) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(page, 'main window loaded');
  page.setDefaultTimeout(10000);
  return { application, page };
}

async function quit(application) {
  try {
    await application.close();
  } catch {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}

async function readHistory() {
  return JSON.parse(await readFile(historyFile, 'utf8'));
}

async function expectItems(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.recent-project-item').length === expected,
    count,
  );
}

async function historyState(page) {
  return page.evaluate(async () => (await window.studio.invoke('state')).value);
}

let application;
let page;
let finished = false;
try {
  // First launch: empty history, create a project, ensure the record is written.
  ({ application, page } = await launch());
  const section = page.locator('.recent-projects');
  await section.waitFor();
  assert.equal(await section.getAttribute('aria-label'), '最近工程');
  await page.locator('.recent-project-empty').waitFor();
  assert.match(await page.locator('.recent-project-empty').innerText(), /还没有最近工程/);
  await page.screenshot({ path: join(run, '1-welcome-empty.png') });

  await application.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, projectDir);
  await page.getByRole('button', { name: '＋ 创建第一个工程', exact: true }).click();
  await page.getByLabel('工程名称', { exact: true }).fill('最近工程验收');
  await page.getByRole('button', { name: '选择位置并创建', exact: true }).click();
  await page.getByText('流程工作区', { exact: true }).waitFor();

  let history = await readHistory();
  assert.equal(history.length, 1, 'new project is remembered');
  assert.equal(history[0].name, '最近工程验收');
  assert.equal(resolve(history[0].path), resolve(projectDir));
  assert.ok(!Number.isNaN(Date.parse(history[0].lastOpenedAt)));
  const firstOpenedAt = history[0].lastOpenedAt;
  const projectJson = await readFile(join(projectDir, 'project.json'), 'utf8');
  await quit(application);

  // Second launch: history survives restart; clicking it reopens the project.
  ({ application, page } = await launch());
  await expectItems(page, 1);
  const openButton = page.locator('.recent-project-open').first();
  assert.equal(await openButton.locator('strong').innerText(), '最近工程验收');
  assert.equal((await openButton.locator('span').innerText()).trim(), resolve(projectDir));
  assert.ok(await openButton.locator('time').getAttribute('datetime'));
  await page.screenshot({ path: join(run, '2-welcome-recent.png') });
  await openButton.click();
  await page.getByText('流程工作区', { exact: true }).waitFor();
  const reopened = await historyState(page);
  assert.equal(reopened.project.name, '最近工程验收');
  assert.equal(resolve(reopened.root), resolve(projectDir));
  history = await readHistory();
  assert.equal(history.length, 1, 'reopening keeps a single canonical record');
  assert.ok(Date.parse(history[0].lastOpenedAt) >= Date.parse(firstOpenedAt));
  await page.screenshot({ path: join(run, '3-reopened.png') });
  await quit(application);

  // Third launch: an entry whose project folder disappeared fails visibly and
  // leaves the current (empty) workspace untouched. Removing entries only edits
  // history and must leave the real project file intact.
  const invalidPath = join(run, 'missing-project');
  const now = Date.now();
  await writeFile(
    historyFile,
    JSON.stringify(
      [
        {
          name: '已被移动的工程',
          path: invalidPath,
          lastOpenedAt: new Date(now).toISOString(),
        },
        {
          name: '最近工程验收',
          path: resolve(projectDir),
          lastOpenedAt: new Date(now - 1000).toISOString(),
        },
      ],
      null,
      2,
    ),
  );
  ({ application, page } = await launch());
  await expectItems(page, 2);
  const invalidRow = page.locator('.recent-project-item').filter({ hasText: '已被移动的工程' });
  await invalidRow.locator('.recent-project-open').click();
  await page.locator('.recent-project-error').waitFor();
  assert.match(await page.locator('.recent-project-error').innerText(), /无法打开/);
  assert.equal((await historyState(page)).project, null, 'failed open leaves no project active');
  assert.equal(
    await page.locator('.recent-project-item').count(),
    2,
    'invalid entry is not duplicated',
  );
  assert.equal((await readHistory()).length, 2, 'invalid entry is not auto-removed');
  await page.screenshot({ path: join(run, '4-invalid-path.png') });

  await invalidRow.locator('.recent-project-remove').click();
  await expectItems(page, 1);
  const validRow = page.locator('.recent-project-item').filter({ hasText: '最近工程验收' });
  await validRow.locator('.recent-project-remove').click();
  await page.locator('.recent-project-empty').waitFor();
  assert.match(await page.locator('.recent-project-empty').innerText(), /还没有最近工程/);
  assert.deepEqual(await readHistory(), []);
  await access(join(projectDir, 'project.json'));
  assert.equal(await readFile(join(projectDir, 'project.json'), 'utf8'), projectJson);
  await page.screenshot({ path: join(run, '5-removed-empty.png') });
  await quit(application);
  finished = true;

  console.log(
    'PASS: recent history persisted across restart, click-to-reopen worked, stale path failed visibly without changing the workspace, and removing all records left an empty state while preserving project files.',
  );
  console.log(run);
} catch (error) {
  if (page) {
    try {
      console.log((await page.locator('body').innerText()).slice(-4000));
      await page.screenshot({ path: join(run, 'failure.png') });
    } catch {}
  }
  throw error;
} finally {
  if (application && !finished) await quit(application).catch(() => {});
}
