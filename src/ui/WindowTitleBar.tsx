import { useEffect } from 'react';

export const WINDOW_TITLE = '未视之视 · 交互叙事工作台';

/**
 * The custom title bar exists only on Windows, where the main process hides the
 * system title bar and paints the native caption buttons as an overlay.
 * Every other platform keeps the native window frame, so nothing is rendered.
 */
export function showsWindowTitleBar(platform: string | null | undefined): boolean {
  return platform === 'win32';
}

/** Compact title text shared by the drag strip and document.title. */
export function windowTitle(projectName?: string | null, dirty = false): string {
  const name = projectName?.trim();
  if (!name) return WINDOW_TITLE;
  return `未视之视 · ${name}${dirty ? ' · 未保存' : ''}`;
}

/** Keep document.title (and therefore the native window title) in sync. */
export function applyDocumentTitle(
  title: string,
  target: { title: string } | null = typeof document === 'undefined' ? null : document,
): string {
  if (target) target.title = title;
  return title;
}

export function WindowTitleBar({
  platform,
  projectName,
  dirty = false,
}: {
  platform?: string;
  projectName?: string | null;
  dirty?: boolean;
}) {
  const host = platform ?? (typeof window !== 'undefined' ? window.studio?.platform : undefined);
  const name = projectName?.trim();
  const base = name ? `未视之视 · ${name}` : WINDOW_TITLE;
  const title = windowTitle(name, dirty);

  useEffect(() => {
    applyDocumentTitle(title);
  }, [title]);

  if (!showsWindowTitleBar(host)) return null;
  return (
    <div className="window-titlebar">
      <span className="window-title" title={title}>
        {base}
      </span>
      {name && dirty && <span className="save-status">● 未保存</span>}
    </div>
  );
}
