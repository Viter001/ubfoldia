import type { Command, Page, Project } from '../core/project';
import { Field } from './RibbonControls';

/** Page/exit properties shown beside the flow canvas, plus the agent panel. */
export function FlowInspector({
  project,
  page,
  hasEdge,
  selectedEdgeId,
  approvedRoots,
  onCommand,
  onEditPage,
  onDeletePage,
  onApprove,
}: {
  project: Project;
  page: Page | null;
  hasEdge: boolean;
  selectedEdgeId: string;
  approvedRoots: string[];
  onCommand: (command: Command) => void;
  onEditPage: (pageId: string) => void;
  onDeletePage: () => void;
  onApprove: () => void;
}) {
  return (
    <aside className="inspector">
      <div className="panel-title">{hasEdge ? '连接属性' : '页面与出口'}</div>
      {page ? (
        <>
          <Field
            label="页面名称"
            value={page.name}
            onChange={(name) => onCommand({ type: 'page.patch', pageId: page.id, patch: { name } })}
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
                onClick={() => onCommand({ type: 'exit.delete', pageId: page.id, exitId: exit.id })}
              >
                删除出口
              </button>
            </div>
          ))}
          {!page.exits.length && <div className="empty-note">没有出口，这一页将作为故事终点。</div>}
          <button className="danger full" onClick={onDeletePage}>
            删除页面
          </button>
        </>
      ) : (
        <div className="empty-note">选择一张页面卡片，编辑名称、起点与出口。</div>
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
