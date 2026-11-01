import type { Command, Layer, Page, Project } from '../core/project';
import { DurationField, LayerEffectSelect, TransitionSelect } from './EffectControls';
import { imageMissing } from './media';
import { Field } from './RibbonControls';

/** Right inspector for the selected layer, or page properties when none is selected. */
export function PageInspector({
  project,
  page,
  layer,
  missing,
  onCommand,
  onPlay,
  onStop,
  onSelectLayer,
}: {
  project: Project;
  page: Page;
  layer: Layer | undefined;
  missing: string[];
  onCommand: (command: Command) => void;
  onPlay: (assetId: string) => void;
  onStop: () => void;
  onSelectLayer: (layerId: string) => void;
}) {
  return (
    <aside className="inspector">
      <div className="panel-title">
        {layer ? '图层属性' : '页面属性'}
        {layer && <button onClick={() => onSelectLayer('')}>页面</button>}
      </div>
      {layer ? (
        <>
          <Field
            label="图层名称"
            value={layer.name}
            onChange={(name) =>
              onCommand({
                type: 'layer.patch',
                pageId: page.id,
                layerId: layer.id,
                patch: { name },
              })
            }
          />
          <div className="field-grid">
            {(['x', 'y', 'width', 'height'] as const).map((key, index) => (
              <Field
                key={key}
                label={['X', 'Y', '宽度', '高度'][index]}
                type="number"
                value={Math.round(layer[key])}
                onChange={(value) =>
                  onCommand({
                    type: 'layer.patch',
                    pageId: page.id,
                    layerId: layer.id,
                    patch: { [key]: value },
                  })
                }
              />
            ))}
          </div>
          {layer.type === 'text' ? (
            <>
              <label className="field">
                <span>文字内容</span>
                <textarea
                  key={layer.text}
                  defaultValue={layer.text}
                  onBlur={(event) =>
                    onCommand({
                      type: 'layer.patch',
                      pageId: page.id,
                      layerId: layer.id,
                      patch: { text: event.target.value },
                    })
                  }
                />
              </label>
              <Field
                label="字号"
                type="number"
                min={1}
                max={500}
                value={layer.fontSize}
                onChange={(fontSize) =>
                  onCommand({
                    type: 'layer.patch',
                    pageId: page.id,
                    layerId: layer.id,
                    patch: { fontSize },
                  })
                }
              />
              <Field
                label="文字颜色"
                type="color"
                value={layer.color}
                onChange={(color) =>
                  onCommand({
                    type: 'layer.patch',
                    pageId: page.id,
                    layerId: layer.id,
                    patch: { color },
                  })
                }
              />
              <label className="field">
                <span>对齐</span>
                <select
                  value={layer.align}
                  onChange={(event) =>
                    onCommand({
                      type: 'layer.patch',
                      pageId: page.id,
                      layerId: layer.id,
                      patch: { align: event.target.value as Layer['align'] },
                    })
                  }
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
            </>
          ) : (
            <label className="field">
              <span>替换图片</span>
              <select
                value={layer.assetId ?? ''}
                onChange={(event) =>
                  onCommand({
                    type: 'layer.patch',
                    pageId: page.id,
                    layerId: layer.id,
                    patch: { assetId: event.target.value },
                  })
                }
              >
                {(!layer.assetId ||
                  !project.assets.some((asset) => asset.id === layer.assetId)) && (
                  <option value={layer.assetId ?? ''}>⚠ 当前图片缺失</option>
                )}
                {project.assets
                  .filter((asset) => asset.kind === 'image')
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {layer.type === 'image' && imageMissing(project, layer, missing) && (
            <p className="help">图片文件缺失或引用失效：从上方图片列表选择其他素材即可替换。</p>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(event) =>
                onCommand({
                  type: 'layer.patch',
                  pageId: page.id,
                  layerId: layer.id,
                  patch: { visible: event.target.checked },
                })
              }
            />
            显示图层
          </label>
          <div className="section-heading">
            <strong>进场动画</strong>
          </div>
          <LayerEffectSelect
            value={layer.effect.type}
            onChange={(type) =>
              onCommand({
                type: 'layer.patch',
                pageId: page.id,
                layerId: layer.id,
                patch: { effect: { ...layer.effect, type } },
              })
            }
          />
          {layer.effect.type === 'fade' && (
            <DurationField
              value={layer.effect.duration}
              onChange={(duration) =>
                onCommand({
                  type: 'layer.patch',
                  pageId: page.id,
                  layerId: layer.id,
                  patch: { effect: { ...layer.effect, duration } },
                })
              }
            />
          )}
          <div className="row">
            <button
              onClick={() =>
                onCommand({
                  type: 'layer.move',
                  pageId: page.id,
                  layerId: layer.id,
                  delta: 1,
                })
              }
            >
              上移一层
            </button>
            <button
              onClick={() =>
                onCommand({
                  type: 'layer.move',
                  pageId: page.id,
                  layerId: layer.id,
                  delta: -1,
                })
              }
            >
              下移一层
            </button>
          </div>
          <button
            className="danger full"
            onClick={() => onCommand({ type: 'layer.delete', pageId: page.id, layerId: layer.id })}
          >
            删除图层
          </button>
        </>
      ) : (
        <>
          <Field
            label="页面名称"
            value={page.name}
            onChange={(name) => onCommand({ type: 'page.patch', pageId: page.id, patch: { name } })}
          />
          <Field
            label="背景颜色"
            type="color"
            value={page.background}
            onChange={(background) =>
              onCommand({ type: 'page.patch', pageId: page.id, patch: { background } })
            }
          />
          <div className="section-heading">
            <strong>页面转场</strong>
          </div>
          <TransitionSelect
            value={page.transition.type}
            onChange={(type) =>
              onCommand({
                type: 'page.patch',
                pageId: page.id,
                patch: { transition: { ...page.transition, type } },
              })
            }
          />
          {page.transition.type === 'fade' && (
            <DurationField
              value={page.transition.duration}
              onChange={(duration) =>
                onCommand({
                  type: 'page.patch',
                  pageId: page.id,
                  patch: { transition: { ...page.transition, duration } },
                })
              }
            />
          )}
          <div className="section-heading">
            <strong>页面音频</strong>
          </div>
          {(['music', 'voice'] as const).map((kind) => (
            <div className="audio-track" key={kind}>
              <strong>{kind === 'music' ? '♫ 背景音频' : '♩ 人物配音'}</strong>
              <small>{kind === 'music' ? '进入页面循环播放' : '进入页面播放一次'}</small>
              <select
                aria-label={kind === 'music' ? '背景音频' : '人物配音'}
                value={page[kind]?.assetId ?? ''}
                onChange={(event) =>
                  onCommand({
                    type: 'page.patch',
                    pageId: page.id,
                    patch: {
                      [kind]: event.target.value
                        ? { assetId: event.target.value, volume: page[kind]?.volume ?? 0.8 }
                        : null,
                    },
                  })
                }
              >
                <option value="">未绑定音频</option>
                {project.assets
                  .filter((asset) => asset.kind === 'audio')
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
              {page[kind] && (
                <>
                  <Field
                    label="音量 0—1"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={page[kind]!.volume}
                    onChange={(volume) =>
                      onCommand({
                        type: 'page.patch',
                        pageId: page.id,
                        patch: { [kind]: { ...page[kind]!, volume } },
                      })
                    }
                  />
                  <div className="row">
                    <button onClick={() => onPlay(page[kind]!.assetId)}>试听</button>
                    <button onClick={onStop}>停止</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
