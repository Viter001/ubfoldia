import type { Project } from '../core/project';
import { columnIndexForX } from './flow-layout';

export type EdgeDirection = 'forward' | 'back' | 'loop' | 'loop-back';

export const EDGE_DIRECTION_COLORS: Record<EdgeDirection, string> = {
  forward: '#4ec97a',
  back: '#7896ff',
  loop: '#dfff00',
  'loop-back': '#d99aff',
};

/**
 * Four visual classes. "循环" is a forward step inside a directed cycle, so a
 * reader never mistakes a loop for a jump back to an earlier level.
 */
export const EDGE_DIRECTION_LEGEND: ReadonlyArray<{
  direction: EdgeDirection;
  label: string;
}> = [
  { direction: 'forward', label: '前进' },
  { direction: 'loop', label: '循环' },
  { direction: 'back', label: '后退' },
  { direction: 'loop-back', label: '循环后退' },
];

export const EDGE_CYCLE_NOTE = '循环 = 环内前进';

export type EdgeClassifier = (sourceId: string, targetId: string) => EdgeDirection;

function buildAdjacency(project: Project): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const page of project.pages) {
    adjacency.set(
      page.id,
      page.exits.flatMap((exit) => (exit.target ? [exit.target] : [])),
    );
  }
  return adjacency;
}

function canReach(adjacency: Map<string, string[]>, startId: string, targetId: string): boolean {
  if (startId === targetId) return true;
  const seen = new Set<string>([startId]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const next of adjacency.get(id) ?? []) {
      if (next === targetId) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Build the page lookup, exit graph and reachability cache once, then classify
 * every edge from it. This avoids rebuilding a graph for each of the four edge
 * classes on a canvas with many exits.
 */
export function createEdgeClassifier(project: Project): EdgeClassifier {
  const pages = new Map(project.pages.map((page) => [page.id, page]));
  const adjacency = buildAdjacency(project);
  const reachable = new Map<string, boolean>();
  const directions = new Map<string, EdgeDirection>();

  const canReachCached = (from: string, to: string) => {
    const key = from + '\0' + to;
    const hit = reachable.get(key);
    if (hit !== undefined) return hit;
    const result = canReach(adjacency, from, to);
    reachable.set(key, result);
    return result;
  };

  return (sourceId, targetId) => {
    const key = sourceId + '\0' + targetId;
    const hit = directions.get(key);
    if (hit !== undefined) return hit;

    const source = pages.get(sourceId);
    const target = pages.get(targetId);
    let direction: EdgeDirection;
    if (!source || !target) {
      direction = 'forward';
    } else {
      const sourceColumn = columnIndexForX(source.position.x);
      const targetColumn = columnIndexForX(target.position.x);
      const inCycle = canReachCached(targetId, sourceId);
      if (inCycle) direction = targetColumn < sourceColumn ? 'loop-back' : 'loop';
      else direction = targetColumn < sourceColumn ? 'back' : 'forward';
    }

    directions.set(key, direction);
    return direction;
  };
}

/** Convenience wrapper for one-off checks and tests. */
export function classifyEdge(project: Project, sourceId: string, targetId: string): EdgeDirection {
  return createEdgeClassifier(project)(sourceId, targetId);
}
