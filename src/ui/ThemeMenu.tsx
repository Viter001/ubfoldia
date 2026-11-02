import { useCallback, useEffect, useRef, useState } from 'react';
import { THEMES, type ThemeId } from './themes';

export function ThemeMenu({
  theme,
  onTheme,
}: {
  theme: ThemeId;
  onTheme: (theme: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  function choose(next: ThemeId) {
    onTheme(next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="settings-control">
      <button
        ref={toggleRef}
        type="button"
        className="settings-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        设置
      </button>
      {open && (
        <div ref={menuRef} className="settings-menu" role="dialog" aria-label="设置">
          <div className="settings-heading">
            <span className="eyebrow">外观</span>
            <strong>编辑器主题</strong>
          </div>
          <p className="help">只影响编辑器外壳与导航，不改作品画面颜色。选择会记住。</p>
          <div className="theme-options" role="menu" aria-label="编辑器主题">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === option.id}
                className={`theme-option ${theme === option.id ? 'active' : ''}`}
                onClick={() => choose(option.id)}
              >
                <span className="theme-swatches" aria-hidden="true">
                  {option.swatches.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="theme-copy">
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="theme-mode">{option.mode === 'dark' ? '暗' : '亮'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
