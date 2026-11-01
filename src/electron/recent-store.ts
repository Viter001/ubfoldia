import type { RecentProject, RecentProjectsResult } from '../shared/studio';
import {
  addRecentProject,
  readRecentProjects,
  removeRecentProject,
  writeRecentProjects,
} from './recent-projects';

/**
 * Recent-project history plus the one-shot warning attached to the next state
 * response. Reads and writes stay in the pure recent-projects module.
 */
export class RecentProjectsService {
  private warning = '';

  constructor(private readonly userDataDir: () => string) {}

  read(): Promise<RecentProjectsResult> {
    return readRecentProjects(this.userDataDir());
  }

  async remember(name: string, dir: string): Promise<void> {
    const history = await this.read();
    const entries = addRecentProject(history.entries, {
      name,
      path: dir,
      lastOpenedAt: new Date().toISOString(),
    });
    await writeRecentProjects(this.userDataDir(), entries);
  }

  async remove(projectPath: string): Promise<RecentProjectsResult> {
    const history = await this.read();
    const entries = removeRecentProject(history.entries, projectPath);
    await writeRecentProjects(this.userDataDir(), entries);
    return { entries, warning: history.warning };
  }

  setWarning(warning: string) {
    this.warning = warning;
  }

  clearWarning() {
    this.warning = '';
  }

  takeWarning() {
    const warning = this.warning;
    this.warning = '';
    return warning;
  }
}
