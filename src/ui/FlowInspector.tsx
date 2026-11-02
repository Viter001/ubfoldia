import { useState } from 'react';
import type { Command, Page, Project } from '../core/project';
import { Field } from './RibbonControls';

function BatchPageEditor({
  pages,
  onCommand,
  onSelectAll,
  onClearSelection,
}: {
  pages: Page[];
  onCommand: (command: Command) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const first = pages[0];
  const [background, setBackground] = useState(first?.background ?? '#faf8f2');
  const [transition, setTransition] = useState<'none' | 'fade'>(first?.transition.type ?? 'none');
  const [duration, setDuration] = useState(first?.transition.duration ?? 0.5);
  const pageIds = pages.map((page) => page.id);
  const count = pages.length;

  return (
    <div className="batch-editor">
      <div className="panel-title">批量属性 · {count} 页</div>
      <p className="help">
        Shift / Ctrl 点击卡片多选；直接拖动任一已选卡片会整体移动。批量编辑不改变出口或播放关系。
      </p>
      <div className="row">
        <button type="button" onClick={onSelectAll}>
          全选页面
        </button>
        <button type="button" onClick={onClearSelection}>
          清空选择
        </button>
      </div>
      <div className="section-heading">
        <strong>统一背景色</strong>
      </div>
      <label className="field">
        <span>背景颜色</span>
        <input
          aria-label="批量背景颜色"
          type="color"
          value={background}
          onChange={(event) => setBackground(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="full"
        onClick={() => onCommand({ type: 'pages.patch', pageIds, patch: { background } })}
      >
        应用背景色到 {count} 页
      </button>
      <div className="section-heading">
        <strong>统一页面转场</strong>
      </div>
      <label className="field">
        <span>转场效果</span>
        <select
          aria-label="批量转场效果"
          value={transition}
          onChange={(event) => setTransition(event.target.value as 'none' | 'fade')}
        >
          <option value="none">无</option>
          <option value="fade">交叉淡化</option>
        </select>
      </label>
      <Field
        label="时长（秒）"
        type="number"
        min={0.1}
        max={3}
        step={0.1}
        disabled={transition !== 'fade'}
        value={duration}
        onChange={setDuration}
      />
      <button
        type="button"
        className="full"
        onClick={() =>
          onCommand({
            type: 'pages.patch',
            pageIds,
            patch: { transition: { type: transition, duration } },
          })
        }
      >
        应用转场到 {count} 页
      </button>
    </div>
  );
}

/** Page/exit properties shown beside the flow canvas, plus the agent panel. */
export function FlowInspector({
  project,
  page,
  selectedPages,
  hasEdge,
  selectedEdgeId,
  approvedRoots,
  onCommand,
  onEditPage,
  onDeletePage,
  onSelectAll,
  onClearSelection,
  onApprove,
}: {
  project: Project;
  page: Page | null;
  selectedPages: Page[];
  hasEdge: boolean;
  selectedEdgeId: string;
  approvedRoots: string[];
  onCommand: (command: Command) => void;
  onEditPage: (pageId: string) => void;
  onDeletePage: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApprove: () => void;
}) {
  const batch = selectedPages.length > 1;
  return (
    <aside className="inspector">
      {batch ? (
        <BatchPageEditor
          key={selectedPages.map((item) => item.id).join(',')}
          pages={selectedPages}
          onCommand={onCommand}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
        />
      ) : (
        <>
          <div className="panel-title">{hasEdge ? '连接属性' : '页面与出口'}</div>
          {page ? (
            <>
              <div className="selection-tools">
                <button type="button" onClick={onSelectAll}>
                  全选页面
                </button>
                <span className="muted">Shift / Ctrl 点击可多选并批量拖动</span>
              </div>
              <Field
                label="页面名称"
                value={page.name}
                onChange={(name) =>
                  onCommand({ type: 'page.patch', pageId: page.id, patch: { name } })
                }
              />
              <div className="row">
                <button onClick={() => onEditPage(page.id)}>编辑页面 ↗</button>
                <button
                  disabled={project.startPageId === page.id}
                  onClick={() => onCommand({ type: 'start.set', pageId: page.id })}
                >
                  {project.startPageId === page.id ? '当前起点' : '设为起点'}
                </button>
              </div>
              <div className="section-heading">
                <strong>选择出口</strong>
                <button
                  onClick={() =>
                    onCommand({
                      type: 'exit.add',
                      pageId: page.id,
                      label: page.exits.length ? '新的选择' : '继续',
                      target: null,
                    })
                  }
                >
                  ＋ 新增
                </button>
              </div>
              <p className="help">
                每个出口对应一个阅读按钮。拖动卡片右侧圆点连接目标页，也可以在这里选择。
              </p>
              {page.exits.map((exit) => (
                <div
                  className={`exit-editor ${exit.id === selectedEdgeId ? 'selected' : ''}`}
                  key={exit.id}
                >
                  <Field
                    label="按钮文字"
                    value={exit.label}
                    onChange={(label) =>
                      onCommand({ type: 'exit.patch', pageId: page.id, exitId: exit.id, label })
                    }
                  />
                  <label className="field">
                    <span>前往页面</span>
                    <select
                      value={exit.target ?? ''}
                      onChange={(event) =>
                        onCommand({
                          type: 'exit.patch',
                          pageId: page.id,
                          exitId: exit.id,
                          target: event.target.value || null,
                        })
                      }
                    >
                      <option value="">未连接</option>
                      {project.pages
                        .filter((candidate) => candidate.id !== page.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="text-danger"
                    onClick={() =>
                      onCommand({ type: 'exit.delete', pageId: page.id, exitId: exit.id })
                    }
                  >
                    删除出口
                  </button>
                </div>
              ))}
              {!page.exits.length && (
                <div className="empty-note">没有出口，这一页将作为故事终点。</div>
              )}
              <button className="danger full" onClick={onDeletePage}>
                删除页面
              </button>
            </>
          ) : (
            <>
              <div className="selection-tools">
                <button type="button" onClick={onSelectAll}>
                  全选页面
                </button>
                <span className="muted">选择一张页面卡片后可批量编辑</span>
              </div>
              <div className="empty-note">选择一张页面卡片，编辑名称、起点与出口。</div>
            </>
          )}
        </>
      )}
      <div className="agent-panel">
        <span className="eyebrow">外部 AI 协作</span>
        <p>允许 Agent 从指定文件夹导入素材。工程修改会同步到这里。</p>
        <button onClick={onApprove}>授权素材文件夹</button>
        <small>
          {approvedRoots.length ? `已授权 ${approvedRoots.length} 个文件夹` : '尚未授权素材文件夹'}
        </small>
      </div>
    </aside>
  );
}
