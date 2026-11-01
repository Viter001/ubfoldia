import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createProject, type Command, type Project } from '../core/project';
import type {
  NewProjectInput,
  State,
  StudioAction,
  StudioPayload,
  StudioValue,
} from '../shared/studio';
import type { LeaveReason } from '../shared/leave';
import type { AgentService } from './agent';
import type { AssetService } from './assets';
import { canonicalRecentPath } from './recent-projects';
import type { RecentProjectsService } from './recent-store';
import type { ProjectSession } from './session';

export type StudioDialogs = {
  pickNewProjectDirectory(): Promise<string | null>;
  pickProjectFile(): Promise<string | null>;
  pickImportFiles(): Promise<string[] | null>;
  pickApprovedDirectory(): Promise<string | null>;
};

export type LeaveGate = {
  mayLeave(reason: LeaveReason): Promise<boolean>;
};

export type StudioRouterDeps = {
  session: ProjectSession;
  recent: RecentProjectsService;
  assets: Pick<AssetService, 'importMany'>;
  agent: Pick<AgentService, 'reset'>;
  leave: LeaveGate;
  dialogs: StudioDialogs;
  /** Sends the state event to the renderer and returns the same snapshot. */
  publish: () => Promise<State>;
};

function requestedPath(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { path?: unknown }).path === 'string'
  )
    return (payload as { path: string }).path;
  return '';
}

function newProjectInput(payload: unknown): NewProjectInput {
  if (!payload || typeof payload !== 'object') throw Error('INVALID_PROJECT');
  const { name, width, height } = payload as Record<string, unknown>;
  if (typeof name !== 'string' || typeof width !== 'number' || typeof height !== 'number')
    throw Error('INVALID_PROJECT');
  return { name, width, height };
}

/**
 * Single dispatcher for renderer actions. All project mutations stay inside
 * ProjectSession; the shared queue and flush barriers are applied by the IPC
 * and agent transports before this router is called.
 */
export class StudioRouter {
  constructor(private readonly deps: StudioRouterDeps) {}

  async handle<A extends StudioAction>(
    action: A,
    payload?: StudioPayload<A>,
  ): Promise<StudioValue<A>>;
  async handle(action: StudioAction, payload?: unknown): Promise<unknown> {
    switch (action) {
      case 'state': {
        const current = await this.deps.session.state();
        const warning = this.deps.recent.takeWarning();
        return warning ? { ...current, recentWarning: warning } : current;
      }
      case 'new': {
        const input = newProjectInput(payload);
        if (!(await this.deps.leave.mayLeave('new'))) return null;
        const project = createProject(input.name, input.width, input.height);
        const dir = await this.deps.dialogs.pickNewProjectDirectory();
        if (!dir) {
          await this.deps.publish();
          return null;
        }
        try {
          await stat(join(dir, 'project.json'));
          throw Error('此目录已有工程，请选择其他目录');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const opened = await this.deps.session.create(dir, project);
        await this.completeSwitch(opened, dir);
        return this.finish();
      }
      case 'recent-open': {
        const requested = requestedPath(payload);
        if (!requested) throw Error('缺少要打开的工程路径');
        const history = await this.deps.recent.read();
        const key = canonicalRecentPath(requested);
        const entry = history.entries.find((item) => canonicalRecentPath(item.path) === key);
        if (!entry) throw Error('该工程不在最近工程列表中，请重新打开。');
        if (!(await this.deps.leave.mayLeave('open'))) return null;
        try {
          await this.openProjectAt(entry.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw Error('无法打开最近工程：工程文件不存在或已被移动。');
          }
          throw Error(
            '无法打开最近工程：' + (error instanceof Error ? error.message : String(error)),
          );
        }
        return this.finish();
      }
      case 'recent-projects':
        return this.deps.recent.read();
      case 'recent-remove': {
        const projectPath = requestedPath(payload);
        if (!projectPath) throw Error('缺少要移除的工程路径');
        return this.deps.recent.remove(projectPath);
      }
      case 'open': {
        if (!(await this.deps.leave.mayLeave('open'))) return null;
        const path = await this.deps.dialogs.pickProjectFile();
        if (!path) {
          await this.deps.publish();
          return null;
        }
        if (basename(path) !== 'project.json') throw Error('请选择 project.json');
        await this.openProjectAt(join(path, '..'));
        return this.finish();
      }
      case 'command':
        this.deps.session.active().execute(payload as Command);
        return this.finish();
      case 'undo':
        this.deps.session.active().undo();
        return this.finish();
      case 'redo':
        this.deps.session.active().redo();
        return this.finish();
      case 'save':
        await this.deps.session.save();
        return this.finish();
      case 'import': {
        this.deps.session.active();
        const paths = await this.deps.dialogs.pickImportFiles();
        if (!paths) return null;
        const results = await this.deps.assets.importMany(paths);
        await this.deps.publish();
        return { results };
      }
      case 'approve': {
        this.deps.session.active();
        const dir = await this.deps.dialogs.pickApprovedDirectory();
        if (dir) this.deps.session.approveRoot(await realpath(dir));
        return this.finish();
      }
      default:
        throw Error('未知操作');
    }
  }

  /** Dynamic entry point for transports that only know an action string. */
  dispatch(action: unknown, payload?: unknown): Promise<unknown> {
    if (typeof action !== 'string') throw Error('未知操作');
    return this.handle(action as StudioAction, payload as never);
  }

  /** Used by startup (`--project=`) and every successful open path. */
  async openProjectAt(dir: string) {
    const project = await this.deps.session.open(dir);
    await this.completeSwitch(project, dir);
  }

  /**
   * Shared tail of every successful session switch (new/open/recent-open).
   * The project is already loaded or written; this never reloads it, and it is
   * not called for cancelled or failed switches.
   */
  private async completeSwitch(project: Project, dir: string) {
    this.deps.agent.reset();
    this.deps.recent.clearWarning();
    try {
      await this.deps.recent.remember(project.name, dir);
    } catch (error) {
      this.deps.recent.setWarning(
        '工程已打开，但最近工程记录未能保存：' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async finish(): Promise<State> {
    const snapshot = await this.deps.publish();
    const warning = this.deps.recent.takeWarning();
    return warning ? { ...snapshot, recentWarning: warning } : snapshot;
  }
}
