import type { Project } from '../core/project';
import type { StudioBridge } from '../shared/studio';

export type {
  NewProjectInput,
  RecentProject,
  RecentProjectsResult,
  State,
  StudioAction,
  StudioPayload,
  StudioResult,
  StudioValue,
} from '../shared/studio';

declare global {
  interface Window {
    studio: StudioBridge;
  }
}

export const assetURL = (p: Project, id: string) => `book-asset://${p.id}/${id}`;
