import { CommandService, type Project } from '../core/project';
import { checkedAssetPath, loadProject, saveProject } from './storage';
import type { State } from '../shared/studio';

/** Disk boundary used by ProjectSession; injectable for focused tests. */
export type ProjectStorage = {
  loadProject: (root: string) => Promise<Project>;
  saveProject: (root: string, project: Project) => Promise<void>;
  checkedAssetPath: (root: string, path: string) => Promise<string>;
};

const defaultStorage: ProjectStorage = { loadProject, saveProject, checkedAssetPath };

/** Revision is presentation metadata; switching projects or reloading must not look dirty. */
function baseline(project: Project) {
  return JSON.stringify({ ...project, revision: 0 });
}

/**
 * Owns the open project, its root, save baseline and project-scoped
 * authorizations. A failed open never replaces the current project.
 */
export class ProjectSession {
  private service: CommandService | null = null;
  private root = '';
  private saved = '';
  private roots: string[] = [];
  readonly media = new Map<string, string>();

  constructor(private readonly storage: ProjectStorage = defaultStorage) {}

  get project(): Project | null {
    return this.service?.project ?? null;
  }

  get projectRoot() {
    return this.root;
  }

  get approvedRoots(): readonly string[] {
    return this.roots;
  }

  active(): CommandService {
    if (!this.service) throw Error('NO_PROJECT：请先打开工程');
    return this.service;
  }

  dirty() {
    return !!this.service && baseline(this.service.project) !== this.saved;
  }

  /** Load first, commit after validation succeeds, so a bad project leaves the old one intact. */
  async open(root: string): Promise<Project> {
    const project = await this.storage.loadProject(root);
    const service = new CommandService(project);
    this.service = service;
    this.root = root;
    this.saved = baseline(service.project);
    this.roots = [];
    this.media.clear();
    return service.project;
  }

  /** Persist a new project then adopt it through the same validated open path. */
  async create(root: string, project: Project): Promise<Project> {
    await this.storage.saveProject(root, project);
    return this.open(root);
  }

  async save(): Promise<void> {
    const service = this.active();
    await this.storage.saveProject(this.root, service.project);
    this.saved = baseline(service.project);
  }

  approveRoot(root: string) {
    if (!this.roots.includes(root)) this.roots.push(root);
  }

  clearApprovedRoots() {
    this.roots = [];
  }

  /** Refresh the media path cache and report assets whose files cannot be read. */
  async state(): Promise<State> {
    const missing: string[] = [];
    if (this.service) {
      const project = this.service.project;
      for (const asset of project.assets) {
        try {
          const path = await this.storage.checkedAssetPath(this.root, asset.path);
          this.media.set(`${project.id}/${asset.id}`, path);
        } catch {
          missing.push(asset.id);
        }
      }
      return {
        project: this.service.snapshot(),
        root: this.root,
        dirty: this.dirty(),
        canUndo: this.service.canUndo,
        canRedo: this.service.canRedo,
        missing,
        approvedRoots: [...this.roots],
      };
    }
    return {
      project: null,
      root: this.root,
      dirty: false,
      canUndo: false,
      canRedo: false,
      missing,
      approvedRoots: [...this.roots],
    };
  }
}
