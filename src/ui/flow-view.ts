import { useCallback, useEffect, useRef, useState } from 'react';
import type { Viewport } from '@xyflow/react';
import type { Project } from '../core/project';

/** Initial framing used when no viewport has been recorded yet. */
export const DEFAULT_FLOW_VIEWPORT: Viewport = { x: 40, y: 40, zoom: 0.8 };

/**
 * Tiny persistent state owned above the conditionally rendered flow canvas.
 * The page workspace and the preview player unmount the canvas, so keeping pan,
 * zoom and the one-shot auto-fit marker here is what preserves the view across
 * those round trips. A successful session replacement is the only reset.
 */
export type FlowViewStore = {
  viewport: Viewport;
  /** `<sessionEpoch>:<projectId>` that has already been framed. */
  fitted: string;
};

export function createFlowViewStore(): FlowViewStore {
  return { viewport: { ...DEFAULT_FLOW_VIEWPORT }, fitted: '' };
}

export function resetFlowView(store: FlowViewStore): void {
  store.viewport = { ...DEFAULT_FLOW_VIEWPORT };
  store.fitted = '';
}

export function rememberViewport(store: FlowViewStore, viewport: Viewport): void {
  store.viewport = viewport;
}

export function flowFitKey(project: Pick<Project, 'id'>, sessionEpoch: number): string {
  return sessionEpoch + ':' + project.id;
}

/**
 * Resets only when the interaction epoch really changed. The reducer bumps that
 * epoch for successful new/open/recent-open replacements (including re-opening
 * the same project) and never for cancel/failure, which is exactly the reset
 * contract of this state.
 */
export function syncFlowSession(
  store: FlowViewStore,
  previousEpoch: number,
  sessionEpoch: number,
): boolean {
  if (previousEpoch === sessionEpoch) return false;
  resetFlowView(store);
  return true;
}

/** One automatic fit per project/session, and only while the canvas is visible. */
export function needsAutoFit(
  store: FlowViewStore,
  project: Project | null,
  sessionEpoch: number,
  active: boolean,
): boolean {
  if (!active || !project || !project.pages.length) return false;
  return store.fitted !== flowFitKey(project, sessionEpoch);
}

/**
 * Owns the flow view for the whole desktop session. Call it once in the top
 * level that also survives the page/preview switches (App), never inside the
 * conditionally rendered FlowWorkspace.
 */
export function useFlowView(project: Project | null, sessionEpoch: number, active: boolean) {
  const store = useRef<FlowViewStore>(createFlowViewStore());
  const previousEpoch = useRef(sessionEpoch);
  const [fitEpoch, setFitEpoch] = useState(0);
  const [resetEpoch, setResetEpoch] = useState(0);

  useEffect(() => {
    if (!syncFlowSession(store.current, previousEpoch.current, sessionEpoch)) return;
    previousEpoch.current = sessionEpoch;
    setResetEpoch((epoch) => epoch + 1);
  }, [sessionEpoch]);

  useEffect(() => {
    if (!project) {
      store.current.fitted = '';
      return;
    }
    const key = flowFitKey(project, sessionEpoch);
    if (!project.pages.length) {
      store.current.fitted = key;
      return;
    }
    if (!active || store.current.fitted === key) return;
    const timer = setTimeout(() => {
      store.current.fitted = key;
      setFitEpoch((epoch) => epoch + 1);
    }, 60);
    return () => clearTimeout(timer);
  }, [project?.id, project?.pages.length, sessionEpoch, active]);

  const move = useCallback((viewport: Viewport) => {
    rememberViewport(store.current, viewport);
  }, []);
  const requestFit = useCallback(() => setFitEpoch((epoch) => epoch + 1), []);

  return { view: store.current, fitEpoch, resetEpoch, move, requestFit };
}
