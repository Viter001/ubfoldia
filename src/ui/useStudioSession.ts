import { useCallback, useEffect, useState } from 'react';
import type { State, StudioAction, StudioPayload, StudioValue } from './api';

const emptyState: State = {
  project: null,
  root: '',
  dirty: false,
  canUndo: false,
  canRedo: false,
  missing: [],
  approvedRoots: [],
};

/** Runtime boundary check: only a snapshot with `project` replaces renderer state. */
function isState(value: unknown): value is State {
  return !!value && typeof value === 'object' && 'project' in value;
}

/** One-shot recent-project warning carried by a state-like response. */
function recentWarning(value: unknown): string {
  if (!value || typeof value !== 'object' || !('recentWarning' in value)) return '';
  const warning = (value as { recentWarning?: unknown }).recentWarning;
  return typeof warning === 'string' ? warning : '';
}

/**
 * Owns the renderer's project snapshot, the typed bridge requests and the
 * banner message. It does not own selection or workspace state.
 */
export function useStudioSession() {
  const [state, setState] = useState<State>(emptyState);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const invoke = useCallback(
    async <A extends StudioAction>(
      action: A,
      ...args: StudioPayload<A> extends void ? [] : [payload: StudioPayload<A>]
    ): Promise<StudioValue<A> | null> => {
      setError('');
      try {
        const response = await window.studio.invoke(action, ...args);
        if (!response.ok) throw Error(response.error);
        const value = response.value;
        if (isState(value)) setState(value);
        const warning = recentWarning(value);
        if (warning) setMessage(warning);
        return value ?? null;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    void invoke('state');
    const off = window.studio.subscribe(setState);
    return off;
  }, [invoke]);

  const clearBanner = useCallback(() => {
    setError('');
    setMessage('');
  }, []);

  return { state, setState, error, message, setError, setMessage, clearBanner, invoke };
}
