import type { Layer, Project } from '../core/project';

/** Image layer whose asset is missing from the project or from disk. */
export function imageMissing(project: Project, layer: Layer, missing: readonly string[]) {
  return (
    layer.type === 'image' &&
    (!layer.assetId ||
      !project.assets.some((asset) => asset.id === layer.assetId) ||
      missing.includes(layer.assetId))
  );
}
