import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_USER_DATA_DIR, migrateLegacyUserData } from '../src/electron/migration.ts';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'ubfoldia-migrate-'));
  return { root, legacy: join(root, LEGACY_USER_DATA_DIR), current: join(root, 'ubfoldia') };
}

test('copies recent projects from the pre-rename data directory', () => {
  const { root, legacy, current } = sandbox();
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'recent-projects.json'), '[{"name":"林间来信"}]');
  assert.deepEqual(migrateLegacyUserData(root, current), ['recent-projects.json']);
  assert.equal(
    readFileSync(join(current, 'recent-projects.json'), 'utf8'),
    '[{"name":"林间来信"}]',
  );
  rmSync(root, { recursive: true, force: true });
});

test('an existing file in the new directory wins over the legacy copy', () => {
  const { root, legacy, current } = sandbox();
  mkdirSync(legacy, { recursive: true });
  mkdirSync(current, { recursive: true });
  writeFileSync(join(legacy, 'recent-projects.json'), 'legacy');
  writeFileSync(join(current, 'recent-projects.json'), 'current');
  assert.deepEqual(migrateLegacyUserData(root, current), []);
  assert.equal(readFileSync(join(current, 'recent-projects.json'), 'utf8'), 'current');
  rmSync(root, { recursive: true, force: true });
});

test('does nothing when there is no legacy directory', () => {
  const { root, current } = sandbox();
  assert.deepEqual(migrateLegacyUserData(root, current), []);
  assert.equal(existsSync(current), false);
  rmSync(root, { recursive: true, force: true });
});

test('skips when the legacy and current directories are the same', () => {
  const { root, legacy } = sandbox();
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'recent-projects.json'), '[]');
  assert.deepEqual(migrateLegacyUserData(root, legacy), []);
  rmSync(root, { recursive: true, force: true });
});
