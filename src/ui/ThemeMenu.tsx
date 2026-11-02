import { useCallback, useEffect, useRef, useState } from 'react';
import { THEMES, type ThemeId } from './themes';

const SETTINGS_SECTIONS = [
  { id: 'appearance', label: '外观', note: '主题与显示', future: false },
  { id: 'editing', label: '编辑', note: '吸附与工具', future: true },
  { id: 'playback', label: '播放', note: '预览与音频', future: true },
  { id: 'agent', label: 'Agent', note: '连接与目录', future: true },
  { id: 'about', label: '关于', note: '版本与数据', future: true },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Standalone settings shell. Theme is the first implemented section. */
export function ThemeMenu({
  theme,
  onTheme,
}: {
  theme: ThemeId;
  onTheme: (theme: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>('appearance');
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setSection('appearance');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === backdropRef.current) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    dialogRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  function choose(next: ThemeId) {
    onTheme(next);
    close();
  }

  const current = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <div ref={rootRef} className="settings-control">
      <button
        ref={toggleRef}
        type="button"
        className="settings-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        设置
      </button>
      {open && (
        <div ref={backdropRef} className="settings-backdrop">
          <div
            ref={dialogRef}
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="settings-dialog-head">
              <div className="settings-heading">
                <span className="eyebrow">设置</span>
                <strong id="settings-title">工作台设置</strong>
              </div>
              <button
                type="button"
                className="settings-close"
                aria-label="关闭设置"
                onClick={() => close(true)}
              >
                ×
              </button>
            </div>

            <div className="settings-body">
              <nav className="settings-nav" role="tablist" aria-label="设置分类">
                {SETTINGS_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`settings-tab-${item.id}`}
                    aria-selected={section === item.id}
                    aria-controls={`settings-panel-${item.id}`}
                    className={section === item.id ? 'active' : ''}
                    onClick={() => setSection(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>{item.note}</small>
                    {item.future && <em>预留</em>}
                  </button>
                ))}
              </nav>

              <section
                className="settings-content"
                role="tabpanel"
                id={`settings-panel-${section}`}
                aria-labelledby={`settings-tab-${section}`}
              >
                {section === 'appearance' ? (
                  <>
                    <p className="help">
                      选择一套编辑器主题。切换立即生效并记住；只影响编辑器外壳与导航，不改作品画面颜色。
                    </p>
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
                    <p className="settings-footnote">主题会继续扩充；其他设置分类也已预留入口。</p>
                  </>
                ) : (
                  <div className="settings-placeholder">
                    <span className="eyebrow">预留</span>
                    <h3>{current.label}设置</h3>
                    <p>
                      设置窗口框架已接入，这里暂时不放置未实现的开关。后续会把这一类设置集中到同一分类，而不是继续散落在功能区。
                    </p>
                    <small>当前可用：外观 → 编辑器主题。</small>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
