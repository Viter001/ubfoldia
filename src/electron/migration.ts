import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Data directory used before the 2026-11-01 rename to Ubfoldia. */
export const LEGACY_USER_DATA_DIR = 'picture-book-studio';

/** First-run state worth carrying over; project files never live here. */
export const MIGRATED_FILES = ['recent-projects.json'] as const;

function samePath(a: string, b: string) {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Copies first-run state from the pre-rename data directory into the current
 * one. Never overwrites and never throws: a failed migration must not block
 * startup, it only means the welcome screen starts without recent projects.
 */
export function migrateLegacyUserData(appDataDir: string, userDataDir: string): string[] {
  if (!appDataDir || !userDataDir) return [];
  const from = join(appDataDir, LEGACY_USER_DATA_DIR);
  if (samePath(from, userDataDir) || !existsSync(from)) return [];
  const copied: string[] = [];
  for (const file of MIGRATED_FILES) {
    const target = join(userDataDir, file);
    if (existsSync(target)) continue;
    const source = join(from, file);
    if (!existsSync(source)) continue;
    try {
      mkdirSync(userDataDir, { recursive: true });
      copyFileSync(source, target);
      copied.push(file);
    } catch {
      // Keep starting; the user can reopen a project manually.
    }
  }
  return copied;
}
