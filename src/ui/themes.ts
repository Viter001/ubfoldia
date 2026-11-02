export type ThemeId = 'tui-amber' | 'claude-paper' | 'claude-night' | 'tui-ice' | 'nord';

export type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  swatches: [string, string, string, string];
  native: { background: string; overlay: string; symbol: string };
};

export const THEMES: readonly ThemeOption[] = [
  {
    id: 'tui-amber',
    name: 'TUI 琥珀',
    description: '炭黑底、琥珀主色，保留终端感但去掉墨绿',
    mode: 'dark',
    swatches: ['#0b0d0e', '#efe7d1', '#ffb000', '#55d6be'],
    native: { background: '#0b0d0e', overlay: '#0b0d0e', symbol: '#efe7d1' },
  },
  {
    id: 'claude-paper',
    name: 'Claude 暖纸',
    description: '象牙纸底、赤陶色，低刺激的浅色工作台',
    mode: 'light',
    swatches: ['#f3efe6', '#2f2b26', '#b65f43', '#3f7d68'],
    native: { background: '#f3efe6', overlay: '#f3efe6', symbol: '#2f2b26' },
  },
  {
    id: 'claude-night',
    name: 'Claude 夜墨',
    description: '暖黑底、珊瑚与鼠尾草，深色但不发绿',
    mode: 'dark',
    swatches: ['#1b1916', '#f1e9db', '#d98b6a', '#8fc9a9'],
    native: { background: '#1b1916', overlay: '#1b1916', symbol: '#f1e9db' },
  },
  {
    id: 'tui-ice',
    name: 'TUI 冰蓝',
    description: '蓝黑底、冰青主色，冷静清晰的终端配色',
    mode: 'dark',
    swatches: ['#071014', '#d7edf2', '#63e6ff', '#78e0c4'],
    native: { background: '#071014', overlay: '#071014', symbol: '#d7edf2' },
  },
  {
    id: 'nord',
    name: 'Nord 冷夜',
    description: '蓝灰极夜、低饱和极光色，适合长时间编辑',
    mode: 'dark',
    swatches: ['#2e3440', '#eceff4', '#88c0d0', '#a3be8c'],
    native: { background: '#2e3440', overlay: '#2e3440', symbol: '#eceff4' },
  },
];

export const DEFAULT_THEME: ThemeId = 'tui-amber';
export const THEME_STORAGE_KEY = 'ubfoldia.theme';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ThemeStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function themeById(id: ThemeId): ThemeOption {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function loadTheme(storage: ThemeStorage | null = defaultStorage()): ThemeId {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(
  theme: ThemeId,
  root: { dataset: Record<string, string | undefined> } | null = typeof document === 'undefined'
    ? null
    : document.documentElement,
  storage: ThemeStorage | null = defaultStorage(),
): ThemeId {
  if (root) root.dataset.theme = theme;
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked localStorage must not break theme switching in this session.
  }
  return theme;
}
