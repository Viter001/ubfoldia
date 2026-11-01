import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type PreviewChoice = {
  key: 'start' | 'current';
  label: string;
  pageId: string | null;
  disabled: boolean;
  hint: string;
};

/** Disabled states are independent: a story may have pages but no start page. */
export function previewOptions(
  startPageId?: string | null,
  currentPageId?: string | null,
): PreviewChoice[] {
  return [
    {
      key: 'start',
      label: '从头预览',
      pageId: startPageId ?? null,
      disabled: !startPageId,
      hint: '从故事起点开始预览',
    },
    {
      key: 'current',
      label: '从当前页预览',
      pageId: currentPageId ?? null,
      disabled: !currentPageId,
      hint: '从当前选中的页面开始预览',
    },
  ];
}

export type PreviewMenuProps = {
  startPageId?: string | null;
  currentPageId?: string | null;
  onPreview: (pageId: string | null) => void;
};

/**
 * Split preview button plus the page-origin menu. The primary button reuses the
 * same App.start callback as the menu; opening the menu never steals focus
 * before a text field has had a chance to blur and commit.
 */
export function PreviewMenu({ startPageId, currentPageId, onPreview }: PreviewMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const options = previewOptions(startPageId, currentPageId);

  const focusItem = useCallback((target: 'first' | 'last') => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    if (!items?.length) return;
    items[target === 'first' ? 0 : items.length - 1]?.focus();
  }, []);

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
    focusItem(focusTarget.current);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, focusItem]);

  function choose(option: PreviewChoice) {
    setOpen(false);
    if (!option.disabled) onPreview(option.pageId);
  }

  function openAt(target: 'first' | 'last') {
    focusTarget.current = target;
    if (open) focusItem(target);
    else setOpen(true);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    );
    if (!items.length) return;
    event.preventDefault();
    const active = document.activeElement;
    const index = items.indexOf(active as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={rootRef} className="preview-control" role="group" aria-label="预览">
      <button
        type="button"
        className="preview-primary"
        aria-label="从头预览"
        disabled={!startPageId}
        onClick={() => {
          setOpen(false);
          if (startPageId) onPreview(startPageId);
        }}
      >
        ▶ 预览
      </button>
      <button
        ref={toggleRef}
        type="button"
        className="preview-toggle"
        aria-label="预览选项"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else openAt('first');
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openAt(event.key === 'ArrowUp' ? 'last' : 'first');
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="preview-menu"
          role="menu"
          aria-label="预览选项"
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={option.disabled}
              title={option.disabled ? option.hint + '（不可用）' : option.hint}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
