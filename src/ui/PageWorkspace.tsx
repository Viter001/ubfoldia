import type { Command, Layer, Page, Project } from '../core/project';
import { AssetLibrary } from './AssetLibrary';
import { PageInspector } from './PageInspector';
import { Scene } from './Scene';
import type { LibraryTab } from './interaction';

/** Page editing workspace: library, canvas and property inspector. */
export function PageWorkspace({
  project,
  page,
  layer,
  selectedLayerId,
  tab,
  missing,
  onTab,
  onSelectLayer,
  onAddLayer,
  onImport,
  onPlay,
  onStop,
  onCommand,
}: {
  project: Project;
  page: Page;
  layer: Layer | undefined;
  selectedLayerId: string;
  tab: LibraryTab;
  missing: string[];
  onTab: (tab: LibraryTab) => void;
  onSelectLayer: (layerId: string) => void;
  onAddLayer: (kind: 'text' | 'image', assetId?: string) => void;
  onImport: () => void;
  onPlay: (assetId: string) => void;
  onStop: () => void;
  onCommand: (command: Command) => void;
}) {
  return (
    <div className="editor-layout">
      <AssetLibrary
        project={project}
        page={page}
        selectedLayerId={selectedLayerId}
        tab={tab}
        missing={missing}
        onTab={onTab}
        onSelectLayer={onSelectLayer}
        onAddLayer={onAddLayer}
        onImport={onImport}
        onPlay={onPlay}
        onStop={onStop}
        onCommand={onCommand}
      />
      <main className="editor-canvas">
        <div className="canvas-caption">
          <span>{page.name}</span>
          <span>
            {project.width} × {project.height}
          </span>
        </div>
        <Scene
          project={project}
          page={page}
          missing={missing}
          editing
          selected={selectedLayerId}
          onSelect={onSelectLayer}
          onMove={(layerId, patch) =>
            onCommand({ type: 'layer.patch', pageId: page.id, layerId, patch })
          }
        />
        <div className="canvas-hint">拖动图层定位 · 右下角调整尺寸 · Ctrl+Z 撤销</div>
      </main>
      <PageInspector
        project={project}
        page={page}
        layer={layer}
        missing={missing}
        onCommand={onCommand}
        onPlay={onPlay}
        onStop={onStop}
        onSelectLayer={onSelectLayer}
      />
    </div>
  );
}
