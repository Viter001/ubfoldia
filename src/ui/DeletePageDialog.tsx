import type { Page, Project } from '../core/project';

/** Confirmation for deleting a page and its incoming/outgoing exits. */
export function DeletePageDialog({
  project,
  page,
  onCancel,
  onConfirm,
}: {
  project: Project;
  page: Page;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const linked =
    page.exits.length +
    project.pages
      .filter((candidate) => candidate.id !== page.id)
      .flatMap((candidate) => candidate.exits)
      .filter((exit) => exit.target === page.id).length;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>删除“{page.name}”？</h2>
        <p>
          将同时删除 {linked} 条关联出口。可通过撤销恢复。
          {project.startPageId === page.id ? '删除后需要重新设置起点。' : ''}
        </p>
        <div className="row end">
          <button onClick={onCancel}>取消</button>
          <button className="danger" onClick={onConfirm}>
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
