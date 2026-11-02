import { useRef, useState } from 'react';
import type { Command, Layer, Page, Project } from '../core/project';
import { COMMAND_GROUPS, type CommandGroup, type WorkspaceMode } from './interaction';
import { PreviewMenu } from './PreviewMenu';
import { ThemeMenu } from './ThemeMenu';
import type { ThemeId } from './themes';
import { RibbonGroup } from './RibbonControls';
import { DurationField, LayerEffectSelect, TransitionSelect } from './EffectControls';

export type CommandRibbonProps = {
  group: CommandGroup;
  onGroup: (group: CommandGroup) => void;
  mode: WorkspaceMode;
  page: Page | null;
  layer: Layer | null;
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  onCommand: (command: Command) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  onAddText: () => void;
  onAddImage: () => void;
  onImport: () => void;
  onPreview: (id: string | null) => void;
  onShowFlow: () => void;
  onShowPage: () => void;
  onFit: () => void;
  /** Initial visual state; production keeps the local state and starts expanded. */
  defaultCollapsed?: boolean;
  theme?: ThemeId;
  onTheme?: (theme: ThemeId) => void;
};

/**
 * Command tabs and their ribbon. All editing controls dispatch core commands;
 * the same transition and animation fields are reused in the inspector.
 */
export function CommandRibbon({
  group,
  onGroup,
  mode,
  page,
  layer,
  project,
  canUndo,
  canRedo,
  onCommand,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onAddPage,
  onAddText,
  onAddImage,
  onImport,
  onPreview,
  onShowFlow,
  onShowPage,
  onFit,
  defaultCollapsed = false,
  theme,
  onTheme,
}: CommandRibbonProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Field components commit on blur. Blurring an open ribbon editor before the
  // collapse click prevents a pending edit from being dropped with the panel.
  function blurOpenEditor() {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== toggleRef.current &&
      active.closest('#command-ribbon')
    ) {
      active.blur();
    }
  }

  function chooseGroup(next: CommandGroup) {
    blurOpenEditor();
    if (collapsed) setCollapsed(false);
    onGroup(next);
  }

  function toggleCollapsed() {
    blurOpenEditor();
    setCollapsed((value) => !value);
  }

  return (
    <>
      <div className="workspace-toolbar">
        <nav className="command-tabs" role="tablist" aria-label="命令分组">
          {COMMAND_GROUPS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`command-tab-${item}`}
              aria-controls="command-ribbon"
              aria-selected={group === item}
              tabIndex={group === item ? 0 : -1}
              className={`command-tab${group === item ? ' active' : ''}`}
              onClick={() => chooseGroup(item)}
              onKeyDown={(event) => {
                const index = COMMAND_GROUPS.indexOf(item);
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const next =
                  COMMAND_GROUPS[
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + COMMAND_GROUPS.length) %
                      COMMAND_GROUPS.length
                  ];
                chooseGroup(next);
                document.getElementById(`command-tab-${next}`)?.focus();
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="workspace-context">
          {mode === 'page' && page ? (
            <>
              <button type="button" onClick={onShowFlow}>
                ← 返回流程
              </button>
              <span className="divider" />
              <strong>{page.name}</strong>
            </>
          ) : (
            <>
              <span className="eyebrow">故事结构</span>
              <strong>流程工作区</strong>
              <span className="pill">{project.pages.length} 个页面</span>
            </>
          )}
        </div>
        <div className="workspace-actions">
          <div className="workspace-switch" role="group" aria-label="工作区切换">
            <button
              type="button"
              className={mode === 'flow' ? 'active' : ''}
              aria-pressed={mode === 'flow'}
              onClick={onShowFlow}
            >
              ◇ 流程编排
            </button>
            <button
              type="button"
              className={mode === 'page' ? 'active' : ''}
              aria-pressed={mode === 'page'}
              disabled={!page}
              onClick={onShowPage}
            >
              ▣ 页面编辑
            </button>
          </div>
          <PreviewMenu
            startPageId={project.startPageId}
            currentPageId={page?.id ?? null}
            onPreview={onPreview}
          />
          {theme && onTheme && <ThemeMenu theme={theme} onTheme={onTheme} />}
          <button
            ref={toggleRef}
            type="button"
            className="ribbon-toggle"
            aria-expanded={!collapsed}
            aria-controls="command-ribbon"
            onPointerDown={blurOpenEditor}
            onClick={toggleCollapsed}
          >
            {collapsed ? '展开工具区' : '收起工具区'}
          </button>
        </div>
      </div>
      <div
        id="command-ribbon"
        className="command-ribbon"
        role="tabpanel"
        aria-labelledby={`command-tab-${group}`}
        hidden={collapsed}
      >
        <div className="command-tools" role="toolbar" aria-label={`${group}命令`}>
          {group === '文件' && (
            <>
              <RibbonGroup title="工程">
                <button type="button" onClick={onNew}>
                  新建
                </button>
                <button type="button" onClick={onOpen}>
                  打开
                </button>
                <button type="button" onClick={onSave} title="Ctrl+S">
                  保存
                </button>
              </RibbonGroup>
              <small className="muted">新建、打开或保存当前工程</small>
            </>
          )}
          {group === '开始' && (
            <>
              <RibbonGroup title="编辑历史">
                <button type="button" disabled={!canUndo} onClick={onUndo} title="Ctrl+Z">
                  撤销
                </button>
                <button type="button" disabled={!canRedo} onClick={onRedo} title="Ctrl+Shift+Z">
                  重做
                </button>
              </RibbonGroup>
              <RibbonGroup title="页面">
                {mode === 'flow' ? (
                  <button type="button" className="primary" onClick={onAddPage}>
                    ＋ 新增页面
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={!page} onClick={onAddText}>
                      ＋ 添加文字
                    </button>
                    <button type="button" disabled={!page} onClick={onAddImage}>
                      ＋ 添加图片
                    </button>
                  </>
                )}
              </RibbonGroup>
              <RibbonGroup title="素材">
                <button type="button" onClick={onImport}>
                  导入素材
                </button>
              </RibbonGroup>
              <small className="muted">
                {mode === 'flow' ? '编排故事的路径与节奏' : '编辑页面中的内容与图层'}
              </small>
            </>
          )}
          {group === '插入' && (
            <>
              <RibbonGroup title="内容">
                <button type="button" disabled={!page} onClick={onAddText}>
                  ＋ 添加文字
                </button>
                <button type="button" disabled={!page} onClick={onAddImage}>
                  ＋ 添加图片
                </button>
              </RibbonGroup>
              <RibbonGroup title="素材">
                <button type="button" onClick={onImport}>
                  导入素材
                </button>
              </RibbonGroup>
              <RibbonGroup title="页面">
                <button type="button" onClick={onAddPage}>
                  ＋ 新增页面
                </button>
              </RibbonGroup>
              <small className="muted">
                {page ? '把文字、图片与素材放进故事' : '先选择一张页面，再添加内容'}
              </small>
            </>
          )}
          {group === '转场' && (
            <>
              <RibbonGroup title="页面转场">
                {page ? (
                  <>
                    <TransitionSelect
                      className="field ribbon-field"
                      ariaLabel="页面转场效果"
                      value={page.transition.type}
                      onChange={(type) =>
                        onCommand({
                          type: 'page.patch',
                          pageId: page.id,
                          patch: { transition: { ...page.transition, type } },
                        })
                      }
                    />
                    <span className="ribbon-placeholder">更多转场效果 · 后续填充</span>
                  </>
                ) : (
                  <small className="muted">先选择一张页面</small>
                )}
              </RibbonGroup>
              <RibbonGroup title="计时">
                {page ? (
                  <DurationField
                    disabled={page.transition.type !== 'fade'}
                    value={page.transition.duration}
                    onChange={(duration) =>
                      onCommand({
                        type: 'page.patch',
                        pageId: page.id,
                        patch: { transition: { ...page.transition, duration } },
                      })
                    }
                  />
                ) : (
                  <small className="muted">先选择一张页面</small>
                )}
              </RibbonGroup>
              <RibbonGroup title="换页方式">
                <span className="ribbon-placeholder">自动换页 · 后续填充</span>
              </RibbonGroup>
            </>
          )}
          {group === '动画' && (
            <>
              <RibbonGroup title="对象动画">
                {layer && page ? (
                  <>
                    <LayerEffectSelect
                      className="field ribbon-field"
                      ariaLabel="图层动画动作"
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
                    <span className="ribbon-placeholder">更多动画效果 · 后续填充</span>
                  </>
                ) : (
                  <small className="muted">请先选择图层</small>
                )}
              </RibbonGroup>
              <RibbonGroup title="计时">
                {layer && page ? (
                  <DurationField
                    disabled={layer.effect.type !== 'fade'}
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
                ) : (
                  <small className="muted">请先选择图层</small>
                )}
              </RibbonGroup>
              <RibbonGroup title="触发与排序">
                <span className="ribbon-placeholder">触发条件与图层排序 · 后续填充</span>
              </RibbonGroup>
            </>
          )}
          {group === '视图' && (
            <>
              <RibbonGroup title="工作区">
                <button type="button" disabled={mode === 'flow'} onClick={onShowFlow}>
                  ◇ 流程编排
                </button>
                <button type="button" disabled={mode === 'page' || !page} onClick={onShowPage}>
                  ▣ 页面编辑
                </button>
              </RibbonGroup>
              <RibbonGroup title="画布">
                <button type="button" disabled={mode !== 'flow'} onClick={onFit}>
                  适应画布
                </button>
              </RibbonGroup>
              <small className="muted">切换工作区与画布视图</small>
            </>
          )}
        </div>
      </div>
    </>
  );
}
