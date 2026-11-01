import type { Command, Page, Project } from '../core/project';
import { assetURL } from './api';
import { imageMissing } from './media';
import type { LibraryTab } from './interaction';

/** Left library: layers and imported assets for the current page. */
export function AssetLibrary({
  project,
  page,
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
    <aside className="library">
      <div className="tabs">
        <button className={tab === 'layers' ? 'active' : ''} onClick={() => onTab('layers')}>
          图层
        </button>
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => onTab('assets')}>
          素材
        </button>
      </div>
      {tab === 'layers' ? (
        <>
          <p className="help padded">上方图层显示在前。隐藏后仍可从列表恢复。</p>
          {[...page.layers].reverse().map((layer) => (
            <div
              className={`layer-row ${layer.id === selectedLayerId ? 'active' : ''}`}
              key={layer.id}
            >
              <button className="layer-name" onClick={() => onSelectLayer(layer.id)}>
                <span>{layer.type === 'image' ? '▧' : 'T'}</span>
                {layer.name}
                {imageMissing(project, layer, missing) && (
                  <span className="layer-warn" title="图片文件缺失，需要替换">
                    ⚠
                  </span>
                )}
              </button>
              {imageMissing(project, layer, missing) && (
                <button
                  className="layer-replace"
                  title="在右侧替换这张图片"
                  onClick={() => onSelectLayer(layer.id)}
                >
                  替换
                </button>
              )}
              <button
                aria-label={`${layer.visible ? '隐藏' : '显示'} ${layer.name}`}
                title={layer.visible ? '隐藏图层' : '显示图层'}
                onClick={() =>
                  onCommand({
                    type: 'layer.patch',
                    pageId: page.id,
                    layerId: layer.id,
                    patch: { visible: !layer.visible },
                  })
                }
              >
                {layer.visible ? '◉' : '○'}
              </button>
            </div>
          ))}
          {!page.layers.length && (
            <p className="empty-note">添加文字或从素材库选择图片，开始制作这一页。</p>
          )}
          <button className="full padded" onClick={() => onSelectLayer('')}>
            页面属性
          </button>
        </>
      ) : (
        <>
          <button className="full" onClick={onImport}>
            ＋ 导入图片与音频
          </button>
          <div className="asset-list">
            {project.assets.map((asset) => (
              <div className="asset-item" key={asset.id}>
                {asset.kind === 'image' ? (
                  <img src={assetURL(project, asset.id)} alt={asset.name} />
                ) : (
                  <div className="audio-icon">♫</div>
                )}
                <strong title={asset.name}>{asset.name}</strong>
                <small>
                  {missing.includes(asset.id)
                    ? '⚠ 素材缺失'
                    : asset.kind === 'image'
                      ? `${asset.width} × ${asset.height}`
                      : `音频 · ${asset.duration?.toFixed(1)} 秒`}
                </small>
                {asset.kind === 'image' ? (
                  <button onClick={() => onAddLayer('image', asset.id)}>添加到页面</button>
                ) : (
                  <button onClick={() => onPlay(asset.id)}>试听</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={onStop}>停止试听</button>
        </>
      )}
    </aside>
  );
}
