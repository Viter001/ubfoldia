import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  THEME_STORAGE_VERSION,
  THEME_STORAGE_VERSION_KEY,
  applyTheme,
  isThemeId,
  loadTheme,
  themeById,
} from '../src/ui/themes.ts';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test('theme catalog has unique ids, five palettes and a valid default', () => {
  assert.equal(THEMES.length, 8);
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  assert.ok(THEMES.some((theme) => theme.id === DEFAULT_THEME));
  assert.equal(themeById(DEFAULT_THEME).name, 'TUI 酸黄');
  assert.equal(isThemeId('claude-paper'), true);
  assert.equal(isThemeId('unknown'), false);
});

test('loadTheme falls back safely and applyTheme persists the selection', () => {
  assert.equal(loadTheme(storage()), DEFAULT_THEME);
  assert.equal(loadTheme(storage({ [THEME_STORAGE_KEY]: 'nord' })), 'nord');
  assert.equal(loadTheme(storage({ [THEME_STORAGE_KEY]: 'tui-lime' })), 'tui-lime');
  assert.equal(
    loadTheme(storage({ [THEME_STORAGE_KEY]: 'tui-amber' })),
    DEFAULT_THEME,
    'old auto-written amber default migrates to acid yellow',
  );
  assert.equal(
    loadTheme(
      storage({
        [THEME_STORAGE_KEY]: 'tui-amber',
        [THEME_STORAGE_VERSION_KEY]: THEME_STORAGE_VERSION,
      }),
    ),
    'tui-amber',
    'a theme chosen after the version marker is preserved',
  );
  assert.equal(loadTheme(storage({ [THEME_STORAGE_KEY]: 'nope' })), DEFAULT_THEME);
  const memory = storage();
  const root = { dataset: {} as Record<string, string | undefined> };
  assert.equal(applyTheme('claude-paper', root, memory), 'claude-paper');
  assert.equal(root.dataset.theme, 'claude-paper');
  assert.equal(memory.getItem(THEME_STORAGE_KEY), 'claude-paper');
  assert.equal(memory.getItem(THEME_STORAGE_VERSION_KEY), THEME_STORAGE_VERSION);
});
