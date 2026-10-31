import { app, BrowserWindow, ipcMain, dialog, protocol, net as electronNet } from 'electron';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, copyFile, realpath, stat } from 'node:fs/promises';
import { join, basename, extname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  CommandService,
  createProject,
  uid,
  type Command,
  type Envelope,
  type Asset,
} from '../core/project';
import { saveProject, loadProject, checkedAssetPath } from './storage';
import {
  addRecentProject,
  canonicalRecentPath,
  readRecentProjects,
  removeRecentProject,
  writeRecentProjects,
} from './recent-projects';
import {
  confirmLeave,
  isTrustedSender,
  type LeaveChoice,
  type LeavePrompt,
  type LeaveReason,
  type LeaveResult,
} from './leave';
if (process.env.STUDIO_USER_DATA) {
  if (!isAbsolute(process.env.STUDIO_USER_DATA)) throw Error('STUDIO_USER_DATA 必须是绝对路径');
  mkdirSync(process.env.STUDIO_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.STUDIO_USER_DATA);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'book-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let win: BrowserWindow, decoder: BrowserWindow;
let service: CommandService | null = null,
  root = '',
  saved = '',
  approvedRoots: string[] = [];
const media = new Map<string, string>();
let queue = Promise.resolve<unknown>(null);
const flushes = new Map<string, (error?: string) => void>();
const leaveWaiters = new Map<
  string,
  { resolve: (choice: LeaveChoice) => void; timer: ReturnType<typeof setTimeout> }
>();
let leaveOpen = false;
let rendererGone = false;
let recentWarning = '';
const LEAVE_TIMEOUT = 5 * 60 * 1000;
function flushRenderer(): Promise<void> {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed())
    return Promise.reject(Error('窗口不可用，未执行保存或关闭'));
  return new Promise((resolve, reject) => {
    const id = uid();
    const timer = setTimeout(() => {
      flushes.delete(id);
      reject(Error('编辑器未响应，未执行保存或关闭'));
    }, 10000);
    flushes.set(id, (error) => {
      clearTimeout(timer);
      flushes.delete(id);
      error ? reject(Error(error)) : resolve();
    });
    win.webContents.send('flush-editor', id);
  });
}
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}
function active() {
  if (!service) throw Error('NO_PROJECT：请先打开工程');
  return service;
}
function dirty() {
  return !!service && JSON.stringify({ ...service.project, revision: 0 }) !== saved;
}
async function state() {
  const missing: string[] = [];
  if (service)
    for (const a of service.project.assets) {
      try {
        const path = await checkedAssetPath(root, a.path);
        media.set(`${service.project.id}/${a.id}`, path);
      } catch {
        missing.push(a.id);
      }
    }
  return {
    project: service?.snapshot() ?? null,
    root,
    dirty: dirty(),
    canUndo: service?.canUndo ?? false,
    canRedo: service?.canRedo ?? false,
    missing,
    approvedRoots,
  };
}
async function publish() {
  const s = await state();
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('state', s);
  return s;
}
async function save() {
  await saveProject(root, active().project);
  saved = JSON.stringify({ ...active().project, revision: 0 });
}
function takeRecentWarning() {
  const warning = recentWarning;
  recentWarning = '';
  return warning;
}
async function rememberRecentProject(name: string, dir: string) {
  const userData = app.getPath('userData');
  const history = await readRecentProjects(userData);
  const entries = addRecentProject(history.entries, {
    name,
    path: dir,
    lastOpenedAt: new Date().toISOString(),
  });
  await writeRecentProjects(userData, entries);
}
function sendLeaveResult(result: LeaveResult) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    win.webContents.send('leave-result', result);
  } catch {
    // The window can disappear between the guard and the send.
  }
}
function requestLeave(prompt: LeavePrompt) {
  if (rendererGone || !win || win.isDestroyed() || win.webContents.isDestroyed())
    throw Error('窗口不可用，无法确认未保存修改');
  win.webContents.send('leave-request', prompt);
}
function nextLeaveChoice(id: string): Promise<LeaveChoice> {
  if (rendererGone) return Promise.resolve('cancel');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!leaveWaiters.delete(id)) return;
      sendLeaveResult({
        id,
        ok: false,
        closed: true,
        error: '等待确认超时，操作已取消。',
      });
      resolve('cancel');
    }, LEAVE_TIMEOUT);
    leaveWaiters.set(id, {
      timer,
      resolve: (choice) => {
        if (!leaveWaiters.delete(id)) return;
        clearTimeout(timer);
        resolve(choice);
      },
    });
  });
}
async function mayLeave(reason: LeaveReason) {
  if (!dirty()) return true;
  if (leaveOpen) return false;
  leaveOpen = true;
  try {
    return await confirmLeave(
      {
        isDirty: dirty,
        id: uid,
        projectName: () => active().project.name,
        request: requestLeave,
        nextChoice: nextLeaveChoice,
        save,
        notify: sendLeaveResult,
      },
      reason,
    );
  } finally {
    leaveOpen = false;
    for (const waiter of leaveWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve('cancel');
    }
    leaveWaiters.clear();
  }
}
async function openDirectory(dir: string) {
  const project = await loadProject(dir);
  root = dir;
  service = new CommandService(project);
  saved = JSON.stringify({ ...project, revision: 0 });
  approvedRoots = [];
  agentReceipts.clear();
  media.clear();
  recentWarning = '';
  try {
    await rememberRecentProject(project.name, dir);
  } catch (error) {
    recentWarning =
      '工程已打开，但最近工程记录未能保存：' +
      (error instanceof Error ? error.message : String(error));
  }
}
async function importFile(source: string): Promise<Asset> {
  const sourceReal = await realpath(source),
    info = await stat(sourceReal);
  if (!info.isFile() || info.size > 50 * 1024 * 1024)
    throw Error('文件过大或不是普通文件（上限 50 MB）');
  const ext = extname(sourceReal).toLowerCase();
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
  };
  const mime = types[ext];
  if (!mime) throw Error('不支持此格式，请导入 PNG/JPEG/WebP 或 MP3/WAV/M4A');
  const bytes = await readFile(sourceReal);
  let meta: { width?: number; height?: number; duration?: number } = {};
  if (mime.startsWith('image')) {
    const signature =
      ext === '.png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : ext === '.webp'
          ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          : bytes[0] === 255 && bytes[1] === 216;
    if (
      !signature ||
      bytes.includes(Buffer.from('acTL')) ||
      (ext === '.webp' && bytes.includes(Buffer.from('ANIM')))
    )
      throw Error('图片格式不匹配或是动画图片');
    meta = await decoder.webContents.executeJavaScript(
      `(async()=>{const image=new Image();image.src="data:${mime};base64,${bytes.toString('base64')}";await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()`,
    );
  } else {
    const signature =
      ext === '.wav'
        ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
        : ext === '.m4a'
          ? bytes.toString('ascii', 4, 8) === 'ftyp'
          : bytes.toString('ascii', 0, 3) === 'ID3' ||
            (bytes[0] === 255 && (bytes[1] & 224) === 224);
    if (!signature) throw Error('音频格式与扩展名不匹配');
    const data = bytes.toString('base64');
    meta = await decoder.webContents.executeJavaScript(
      `(async()=>{const c=new AudioContext();try{const b=Uint8Array.from(atob('${data}'),x=>x.charCodeAt(0));const a=await c.decodeAudioData(b.buffer);return {duration:a.duration};}finally{await c.close();}})()`,
    );
  }
  const asset: Asset = {
    id: uid(),
    name: basename(sourceReal),
    kind: mime.startsWith('image') ? 'image' : 'audio',
    path: '',
    mime,
    ...meta,
  };
  asset.path = `assets/${asset.id}${ext}`;
  await mkdir(join(root, 'assets'), { recursive: true });
  const assetsReal = await realpath(join(root, 'assets')),
    rootReal = await realpath(root),
    assetRel = relative(rootReal, assetsReal);
  if (assetRel.startsWith('..') || isAbsolute(assetRel)) throw Error('ASSET_OUTSIDE_PROJECT');
  await copyFile(sourceReal, join(root, asset.path));
  return asset;
}
async function importMany(paths: string[]) {
  const results = [];
  for (const path of paths) {
    try {
      const asset = await importFile(path);
      active().execute({ type: 'asset.add', asset });
      results.push({ path, assetId: asset.id, ok: true });
    } catch (e) {
      results.push({ path, ok: false, error: String(e) });
    }
  }
  return results;
}
const agentReceipts = new Map<string, { signature: string; result: unknown }>();
async function agentCall(name: string, args: any) {
  const s = active();
  if (name === 'project_get')
    return {
      ...(await state()),
      tools: [
        'project_get',
        'assets_import',
        'pages_add',
        'pages_connect',
        'layers_set_visibility',
        'project_save',
      ],
    };
  const envelope: Envelope = {
    projectId: args.projectId,
    requestId: args.requestId,
    expectedRevision: args.expectedRevision,
  };
  if (envelope.projectId !== s.project.id) throw Error('PROJECT_MISMATCH');
  if (
    typeof envelope.requestId !== 'string' ||
    !envelope.requestId ||
    envelope.requestId.length > 128
  )
    throw Error('INVALID_REQUEST_ID');
  const key = s.project.id + ':' + envelope.requestId,
    signature = JSON.stringify({ name, args }),
    receipt = agentReceipts.get(key);
  if (receipt) {
    if (receipt.signature !== signature) throw Error('REQUEST_REUSED');
    return receipt.result;
  }
  if (envelope.expectedRevision !== s.project.revision) throw Error('REVISION_CONFLICT');
  let result: unknown;
  if (name === 'assets_import') {
    if (!Array.isArray(args.paths) || args.paths.length > 50) throw Error('INVALID_PATHS');
    for (const path of args.paths) {
      const actual = await realpath(path);
      if (
        !approvedRoots.some((base) => {
          const rel = relative(base, actual);
          return !rel.startsWith('..') && !isAbsolute(rel);
        })
      )
        throw Error('SOURCE_NOT_APPROVED：请在工具中授权素材文件夹');
    }
    result = { results: await importMany(args.paths), revision: s.project.revision };
  } else if (name === 'project_save') {
    await save();
    result = { revision: s.project.revision, saved: true };
  } else {
    let command: Command;
    if (name === 'pages_add')
      command = { type: 'page.add', name: args.name, assetId: args.assetId };
    else if (name === 'pages_connect')
      command = {
        type: 'exit.add',
        pageId: args.pageId,
        label: args.label ?? '继续',
        target: args.target,
      };
    else if (name === 'layers_set_visibility')
      command = {
        type: 'layer.patch',
        pageId: args.pageId,
        layerId: args.layerId,
        patch: { visible: args.visible },
      };
    else throw Error('UNKNOWN_TOOL');
    result = s.execute(command, envelope);
  }
  agentReceipts.set(key, { signature, result });
  await publish();
  return result;
}
async function handle(action: string, payload: any) {
  switch (action) {
    case 'state': {
      const current = await state();
      const warning = takeRecentWarning();
      return warning ? { ...current, recentWarning: warning } : current;
    }
    case 'new': {
      if (!(await mayLeave('new'))) return null;
      const project = createProject(payload.name, payload.width, payload.height);
      const pick = await dialog.showOpenDialog(win, {
        title: '选择空文件夹作为工程位置',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (pick.canceled) {
        await publish();
        return null;
      }
      const dir = pick.filePaths[0];
      try {
        await stat(join(dir, 'project.json'));
        throw Error('此目录已有工程，请选择其他目录');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await saveProject(dir, project);
      await openDirectory(dir);
      break;
    }
    case 'recent-open': {
      const requested = typeof payload === 'string' ? payload : payload?.path;
      if (typeof requested !== 'string' || !requested) throw Error('缺少要打开的工程路径');
      const history = await readRecentProjects(app.getPath('userData'));
      const key = canonicalRecentPath(requested);
      const entry = history.entries.find((item) => canonicalRecentPath(item.path) === key);
      if (!entry) throw Error('该工程不在最近工程列表中，请重新打开。');
      if (!(await mayLeave('open'))) return null;
      try {
        await openDirectory(entry.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw Error('无法打开最近工程：工程文件不存在或已被移动。');
        }
        throw Error(
          '无法打开最近工程：' + (error instanceof Error ? error.message : String(error)),
        );
      }
      break;
    }
    case 'recent-projects':
      return readRecentProjects(app.getPath('userData'));
    case 'recent-remove': {
      const projectPath =
        typeof payload === 'string'
          ? payload
          : typeof payload?.path === 'string'
            ? payload.path
            : '';
      if (!projectPath) throw Error('缺少要移除的工程路径');
      const userData = app.getPath('userData');
      const history = await readRecentProjects(userData);
      const entries = removeRecentProject(history.entries, projectPath);
      await writeRecentProjects(userData, entries);
      return { entries, warning: history.warning };
    }
    case 'open': {
      if (!(await mayLeave('open'))) return null;
      const pick = await dialog.showOpenDialog(win, {
        title: '打开工程',
        filters: [{ name: '绘本工程', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (pick.canceled) {
        await publish();
        return null;
      }
      const path = pick.filePaths[0];
      if (basename(path) !== 'project.json') throw Error('请选择 project.json');
      await openDirectory(join(path, '..'));
      break;
    }
    case 'command':
      active().execute(payload as Command);
      break;
    case 'undo':
      active().undo();
      break;
    case 'redo':
      active().redo();
      break;
    case 'save':
      await save();
      break;
    case 'import': {
      active();
      const pick = await dialog.showOpenDialog(win, {
        title: '导入素材',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片和音频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (pick.canceled) return null;
      const results = await importMany(pick.filePaths);
      await publish();
      return { results };
    }
    case 'approve': {
      active();
      const pick = await dialog.showOpenDialog(win, {
        title: '允许外部 Agent 从此文件夹导入素材',
        properties: ['openDirectory'],
      });
      if (!pick.canceled) approvedRoots.push(await realpath(pick.filePaths[0]));
      break;
    }
    default:
      throw Error('未知操作');
  }
  const snapshot = await publish();
  const warning = takeRecentWarning();
  return warning ? { ...snapshot, recentWarning: warning } : snapshot;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      protocol.handle('book-asset', async (request) => {
        const u = new URL(request.url),
          path = media.get(u.hostname + u.pathname);
        if (!path) return new Response('missing', { status: 404 });
        return electronNet.fetch(pathToFileURL(path).href);
      });
      decoder = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await decoder.loadURL('data:text/html,<title>Media decoder</title>');
      win = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1000,
        minHeight: 700,
        title: '绘境 · 交互叙事工作台',
        backgroundColor: '#0d0f0e',
        // Windows draws the native caption buttons as an overlay while the
        // renderer supplies the rest of the title bar. Other platforms keep
        // the system frame untouched.
        ...(process.platform === 'win32'
          ? {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: {
                color: '#0d0f0e',
                symbolColor: '#c5d0c0',
                height: 32,
              },
            }
          : {}),
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      win.on('closed', () => app.quit());
      win.removeMenu();
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e) => e.preventDefault());
      const trusted = (event: { sender: unknown; senderFrame: unknown }) =>
        !!win &&
        !win.isDestroyed() &&
        !win.webContents.isDestroyed() &&
        isTrustedSender(
          event.sender,
          event.senderFrame,
          win.webContents,
          win.webContents.mainFrame,
        );
      const cancelPendingLeave = () => {
        for (const waiter of leaveWaiters.values()) waiter.resolve('cancel');
        leaveWaiters.clear();
      };
      win.webContents.on('render-process-gone', () => {
        rendererGone = true;
        cancelPendingLeave();
      });
      win.webContents.on('destroyed', () => {
        rendererGone = true;
        cancelPendingLeave();
      });
      ipcMain.on('flush-editor-done', (event, id, error) => {
        if (!trusted(event) || typeof id !== 'string') return;
        flushes.get(id)?.(typeof error === 'string' ? error : undefined);
      });
      ipcMain.on('leave-response', (event, id, choice) => {
        if (!trusted(event) || typeof id !== 'string') return;
        if (choice !== 'save' && choice !== 'discard' && choice !== 'cancel') return;
        leaveWaiters.get(id)?.resolve(choice);
      });
      ipcMain.handle('studio', async (event, action, payload) => {
        if (!trusted(event)) throw Error('INVALID_SENDER');
        try {
          if (['save', 'open', 'new', 'recent-open'].includes(action)) await flushRenderer();
          return { ok: true, value: await serialize(() => handle(action, payload)) };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      });
      let closing = false;
      let closePending = false;
      win.on('close', (e) => {
        if (closing) return;
        e.preventDefault();
        if (closePending || leaveOpen) return;
        closePending = true;
        flushRenderer()
          .then(() =>
            serialize(async () => {
              if (await mayLeave('close')) {
                closing = true;
                win.close();
              }
            }),
          )
          .catch((e) => dialog.showErrorBox('无法关闭工程', String(e)))
          .finally(() => {
            closePending = false;
          });
      });
      const initial = process.argv.find((x) => x.startsWith('--project='));
      if (initial) await openDirectory(initial.slice(10));
      await win.loadFile(join(__dirname, '../dist/index.html'));
      await publish();
      const pipe =
          process.platform === 'win32'
            ? `\\\\.\\pipe\\picture-book-studio-${process.pid}`
            : join(app.getPath('temp'), `picture-book-studio-${process.pid}.sock`),
        token = randomBytes(32).toString('hex');
      const server = createServer((socket) => {
        socket.setEncoding('utf8');
        let buffer = '';
        socket.setTimeout(30000, () => socket.destroy());
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.length > 1024 * 1024) {
            socket.destroy();
            return;
          }
          let i;
          while ((i = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            socket.setTimeout(0);
            void (async () => {
              try {
                const req = JSON.parse(line);
                if (req.token !== token) throw Error('UNAUTHORIZED');
                if (req.name === 'project_save') await flushRenderer();
                const result = await serialize(() => agentCall(req.name, req.args ?? {}));
                if (!socket.destroyed) socket.write(JSON.stringify({ id: req.id, result }) + '\n');
                socket.setTimeout(30000);
              } catch (e) {
                if (!socket.destroyed) socket.write(JSON.stringify({ error: String(e) }) + '\n');
                socket.setTimeout(30000);
              }
            })();
          }
        });
        socket.on('error', () => {});
      });
      server.listen(pipe, () => {
        void (async () => {
          await mkdir(app.getPath('userData'), { recursive: true });
          await writeFile(
            join(app.getPath('userData'), 'agent-endpoint.json'),
            JSON.stringify({ pipe, token }),
            { mode: 0o600 },
          );
        })().catch((e) => dialog.showErrorBox('Agent 通道不可用', String(e)));
      });
      server.on('error', (e) => console.error('Agent bridge:', e));
      app.on('before-quit', () => server.close());
    })
    .catch((e) => {
      dialog.showErrorBox('启动失败', String(e));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}
