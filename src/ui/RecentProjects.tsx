import { useEffect, useState } from 'react';
import type { RecentProject, RecentProjectsResult } from './api';

type RecentProjectsProps = {
  onOpen: (path: string) => Promise<boolean>;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatOpenedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function RecentProjects({ onOpen }: RecentProjectsProps) {
  const [entries, setEntries] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState('');
  const [removing, setRemoving] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const busy = !!opening || !!removing;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    window.studio
      .invoke('recent-projects')
      .then((result) => {
        if (!result.ok) throw Error(result.error || '读取最近工程失败');
        if (cancelled) return;
        const payload = result.value as RecentProjectsResult | undefined;
        setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
        setWarning(payload?.warning ?? '');
        setLoading(false);
      })
      .catch((failure) => {
        if (cancelled) return;
        setLoading(false);
        setError('读取最近工程失败：' + errorText(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function openEntry(entry: RecentProject) {
    if (busy || loading) return;
    setOpening(entry.path);
    setError('');
    setNotice('');
    try {
      const opened = await onOpen(entry.path);
      if (!opened) setNotice('已取消打开工程，当前工程没有变化。');
    } catch (failure) {
      setError('打开“' + entry.name + '”失败：' + errorText(failure));
    } finally {
      setOpening('');
    }
  }

  async function removeEntry(entry: RecentProject) {
    if (busy || loading) return;
    setRemoving(entry.path);
    setError('');
    setNotice('');
    try {
      const result = await window.studio.invoke('recent-remove', { path: entry.path });
      if (!result.ok) throw Error(result.error || '移除最近工程记录失败');
      const payload = result.value as RecentProjectsResult | undefined;
      setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
      setWarning(payload?.warning ?? '');
      setNotice('已从最近工程中移除“' + entry.name + '”，工程文件没有被删除。');
    } catch (failure) {
      setError('移除“' + entry.name + '”失败：' + errorText(failure));
    } finally {
      setRemoving('');
    }
  }

  return (
    <section className="recent-projects" aria-label="最近工程" aria-busy={loading || !!busy}>
      <div className="recent-projects-heading">
        <div>
          <span className="eyebrow">继续上次的创作</span>
          <h2>最近工程</h2>
        </div>
        <button
          type="button"
          className="recent-project-refresh"
          disabled={loading || !!busy}
          onClick={() => setReloadToken((token) => token + 1)}
        >
          刷新
        </button>
      </div>
      <p className="recent-projects-help">
        仅记录最近成功新建或打开的工程；不会自动打开，移除记录也不会删除工程文件。
      </p>
      {loading && (
        <p className="recent-project-loading" role="status">
          正在读取最近工程…
        </p>
      )}
      {error && (
        <div className="recent-project-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            disabled={loading}
            onClick={() => setReloadToken((token) => token + 1)}
          >
            重试
          </button>
        </div>
      )}
      {warning && !error && (
        <p className="recent-project-warning" role="status">
          {warning}
        </p>
      )}
      {notice && !error && (
        <p className="recent-project-notice" role="status">
          {notice}
        </p>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="recent-project-empty">还没有最近工程。成功新建或打开工程后，会显示在这里。</p>
      )}
      {entries.length > 0 && (
        <ul className="recent-project-list">
          {entries.map((entry) => {
            const rowOpening = opening === entry.path;
            const rowRemoving = removing === entry.path;
            return (
              <li className="recent-project-item" key={entry.path}>
                <button
                  type="button"
                  className="recent-project-open"
                  disabled={loading || busy}
                  aria-busy={rowOpening}
                  title={`打开 ${entry.name}`}
                  onClick={() => void openEntry(entry)}
                >
                  <strong>{entry.name}</strong>
                  <span className="recent-project-path">{entry.path}</span>
                  <time dateTime={entry.lastOpenedAt}>
                    {rowOpening ? '正在打开…' : formatOpenedAt(entry.lastOpenedAt)}
                  </time>
                </button>
                <button
                  type="button"
                  className="recent-project-remove"
                  disabled={loading || busy}
                  aria-busy={rowRemoving}
                  title="仅移除最近记录，不删除工程文件"
                  aria-label={`移除最近工程 ${entry.name}`}
                  onClick={() => void removeEntry(entry)}
                >
                  {rowRemoving ? '移除中…' : '移除'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
