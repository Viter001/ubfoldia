import { app, BrowserWindow, ipcMain, dialog, protocol, net as electronNet } from 'electron';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { LeaveResult } from '../shared/leave';
import { ProjectSession } from './session';
import { SerialQueue } from './queue';
import { AssetService, type MediaDecoder } from './assets';
import { FlushCoordinator } from './flush';
import { LeaveCoordinator, isTrustedSender } from './leave';
import { RecentProjectsService } from './recent-store';
import { AgentService } from './agent';
import { StudioRouter } from './router';
import { registerStudioIpc } from './ipc';
import { agentPipePath, startAgentTransport, writeAgentEndpoint } from './agent-server';
import { migrateLegacyUserData } from './migration';
import type { State } from '../shared/studio';

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
      // The rename to Ubfoldia changed the userData folder; carry the recent list over once.
      const appData = process.env.STUDIO_APP_DATA || app.getPath('appData');
      const migrated = migrateLegacyUserData(appData, app.getPath('userData'));
      if (migrated.length) console.log('迁移旧用户数据：' + migrated.join('、'));
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
        title: '未视之视 · 交互叙事工作台',
        icon: join(
          __dirname,
          '../dist/brand',
          process.platform === 'win32' ? 'ubfoldia.ico' : 'ubfoldia.png',
        ),
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

      const session = new ProjectSession();
      const queue = new SerialQueue();
      const recent = new RecentProjectsService(() => app.getPath('userData'));
      const mediaDecoder: MediaDecoder = {
        decodeImage: (bytes, mime) =>
          decoder.webContents.executeJavaScript(
            `(async()=>{const image=new Image();image.src="data:${mime};base64,${bytes.toString('base64')}";await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()`,
          ),
        decodeAudio: (bytes) =>
          decoder.webContents.executeJavaScript(
            `(async()=>{const c=new AudioContext();try{const b=Uint8Array.from(atob('${bytes.toString('base64')}'),x=>x.charCodeAt(0));const a=await c.decodeAudioData(b.buffer);return {duration:a.duration};}finally{await c.close();}})()`,
          ),
      };
      const assets = new AssetService({ session, decoder: mediaDecoder });
      const flusher = new FlushCoordinator({
        isAvailable: () => !!win && !win.isDestroyed() && !win.webContents.isDestroyed(),
        send: (id) => win.webContents.send('flush-editor', id),
      });

      const sendLeaveResult = (result: LeaveResult) => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
        try {
          win.webContents.send('leave-result', result);
        } catch {
          // The window can disappear between the guard and the send.
        }
      };
      const leave = new LeaveCoordinator({
        session,
        sendRequest: (prompt) => {
          if (!win || win.isDestroyed() || win.webContents.isDestroyed())
            throw Error('窗口不可用，无法确认未保存修改');
          win.webContents.send('leave-request', prompt);
        },
        sendResult: sendLeaveResult,
      });

      async function publish(): Promise<State> {
        const snapshot = await session.state();
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
          win.webContents.send('state', snapshot);
        return snapshot;
      }

      const agent = new AgentService({ session, assets, publish });
      const pick = async (options: Electron.OpenDialogOptions) => {
        const result = await dialog.showOpenDialog(win, options);
        return result.canceled ? null : result.filePaths;
      };
      const router = new StudioRouter({
        session,
        recent,
        assets,
        agent,
        leave,
        publish,
        dialogs: {
          pickNewProjectDirectory: async () =>
            (
              await pick({
                title: '选择空文件夹作为工程位置',
                properties: ['openDirectory', 'createDirectory'],
              })
            )?.[0] ?? null,
          pickProjectFile: async () =>
            (
              await pick({
                title: '打开工程',
                filters: [{ name: '绘本工程', extensions: ['json'] }],
                properties: ['openFile'],
              })
            )?.[0] ?? null,
          pickImportFiles: async () =>
            pick({
              title: '导入素材',
              properties: ['openFile', 'multiSelections'],
              filters: [
                {
                  name: '图片和音频',
                  extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a'],
                },
                { name: '所有文件', extensions: ['*'] },
              ],
            }),
          pickApprovedDirectory: async () =>
            (
              await pick({
                title: '允许外部 Agent 从此文件夹导入素材',
                properties: ['openDirectory'],
              })
            )?.[0] ?? null,
        },
      });

      protocol.handle('book-asset', async (request) => {
        const u = new URL(request.url),
          path = session.media.get(u.hostname + u.pathname);
        if (!path) return new Response('missing', { status: 404 });
        return electronNet.fetch(pathToFileURL(path).href);
      });

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
      const rendererGone = () => {
        leave.markRendererGone();
        flusher.cancelAll('窗口不可用，未执行保存或关闭');
      };
      win.webContents.on('render-process-gone', rendererGone);
      win.webContents.on('destroyed', rendererGone);

      registerStudioIpc({ ipcMain, trusted, queue, flusher, leave, router });

      let closing = false;
      let closePending = false;
      win.on('close', (e) => {
        if (closing) return;
        e.preventDefault();
        if (closePending || leave.open) return;
        closePending = true;
        flusher
          .flush()
          .then(() =>
            queue.run(async () => {
              if (await leave.mayLeave('close')) {
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
      if (initial) await router.openProjectAt(initial.slice(10));
      await win.loadFile(join(__dirname, '../dist/index.html'));
      await publish();

      const pipe = agentPipePath(process.platform, process.pid, app.getPath('temp')),
        token = randomBytes(32).toString('hex');
      const server = startAgentTransport({
        pipe,
        token,
        flush: () => flusher.flush(),
        queue,
        call: (name, args) => agent.call(name, args),
      });
      server.listen(pipe, () => {
        void writeAgentEndpoint(app.getPath('userData'), { pipe, token }).catch((e) =>
          dialog.showErrorBox('Agent 通道不可用', String(e)),
        );
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
