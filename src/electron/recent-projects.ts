import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, win32 } from 'node:path';
import type { RecentProject } from '../shared/studio';
export type { RecentProject } from '../shared/studio';

export type RecentProjectsRead = {
  entries: RecentProject[];
  warning: string;
};

export const RECENT_PROJECTS_FILE = 'recent-projects.json';
export const MAX_RECENT_PROJECTS = 10;
const MAX_NAME_LENGTH = 300;

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

function resolveFor(path: string, platform: NodeJS.Platform) {
  return pathApi(platform).resolve(path);
}

function isAbsoluteFor(path: string, platform: NodeJS.Platform) {
  return pathApi(platform).isAbsolute(path);
}

/** Absolute, normalized path used only for comparing recent-project entries. */
export function canonicalRecentPath(path: string, platform: NodeJS.Platform = process.platform) {
  const resolved = resolveFor(path, platform);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validRecentProject(value: unknown, platform: NodeJS.Platform): RecentProject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const projectPath = typeof record.path === 'string' ? record.path.trim() : '';
  const lastOpenedAt = typeof record.lastOpenedAt === 'string' ? record.lastOpenedAt : '';
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (!projectPath || projectPath.includes('\0') || !isAbsoluteFor(projectPath, platform))
    return null;
  const timestamp = Date.parse(lastOpenedAt);
  if (!Number.isFinite(timestamp)) return null;
  return {
    name,
    path: resolveFor(projectPath, platform),
    lastOpenedAt: new Date(timestamp).toISOString(),
  };
}

/**
 * Sort newest first, drop malformed records, collapse canonical-path duplicates,
 * and cap the history. Loading never throws for malformed data.
 */
export function normalizeRecentProjects(
  input: unknown,
  platform: NodeJS.Platform = process.platform,
  limit = MAX_RECENT_PROJECTS,
): { entries: RecentProject[]; invalid: number } {
  const values = Array.isArray(input) ? input : [];
  const valid: RecentProject[] = [];
  let invalid = 0;
  for (const value of values) {
    const entry = validRecentProject(value, platform);
    if (entry) valid.push(entry);
    else invalid++;
  }
  valid.sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt));
  const max = Math.max(0, Math.trunc(limit));
  if (!max) return { entries: [], invalid };
  const seen = new Set<string>();
  const entries: RecentProject[] = [];
  for (const entry of valid) {
    const key = canonicalRecentPath(entry.path, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= max) break;
  }
  return { entries, invalid };
}

export function parseRecentProjects(
  raw: string,
  platform: NodeJS.Platform = process.platform,
): RecentProjectsRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { entries: [], warning: '最近工程记录已损坏，已忽略。' };
  }
  if (!Array.isArray(value)) {
    return { entries: [], warning: '最近工程记录格式不正确，已忽略。' };
  }
  const { entries, invalid } = normalizeRecentProjects(value, platform);
  return {
    entries,
    warning: invalid ? `最近工程记录中有 ${invalid} 条损坏项，已忽略。` : '',
  };
}

export function recentProjectsFile(userDataDir: string) {
  return join(userDataDir, RECENT_PROJECTS_FILE);
}

export async function readRecentProjects(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<RecentProjectsRead> {
  try {
    return parseRecentProjects(await readFile(recentProjectsFile(userDataDir), 'utf8'), platform);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], warning: '' };
    }
    return {
      entries: [],
      warning: '无法读取最近工程记录：' + (error instanceof Error ? error.message : String(error)),
    };
  }
}

export async function writeRecentProjects(
  userDataDir: string,
  input: RecentProject[],
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const entries = normalizeRecentProjects(input, platform).entries;
  await mkdir(userDataDir, { recursive: true });
  const file = recentProjectsFile(userDataDir);
  const temp = join(userDataDir, `.recent-projects-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(entries, null, 2), 'utf8');
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export function addRecentProject(
  entries: RecentProject[],
  input: { name: string; path: string; lastOpenedAt?: string },
  platform: NodeJS.Platform = process.platform,
  limit = MAX_RECENT_PROJECTS,
): RecentProject[] {
  const candidate = {
    name: input.name,
    path: input.path,
    lastOpenedAt: input.lastOpenedAt ?? new Date().toISOString(),
  };
  return normalizeRecentProjects(
    [candidate, ...(Array.isArray(entries) ? entries : [])],
    platform,
    limit,
  ).entries;
}

export function removeRecentProject(
  entries: RecentProject[],
  projectPath: string,
  platform: NodeJS.Platform = process.platform,
  limit = MAX_RECENT_PROJECTS,
): RecentProject[] {
  const key = canonicalRecentPath(projectPath, platform);
  const normalized = normalizeRecentProjects(entries, platform, limit).entries;
  return normalized.filter((entry) => canonicalRecentPath(entry.path, platform) !== key);
}
