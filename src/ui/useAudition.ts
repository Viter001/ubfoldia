import { useCallback, useEffect, useRef } from 'react';
import type { Project } from '../core/project';
import { assetURL } from './api';

/** Owns the single audition element; starting a new preview stops the old one. */
export function useAudition(project: Project | null, onError: (message: string) => void) {
  const audition = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (audition.current) {
      audition.current.pause();
      audition.current.src = '';
      audition.current = null;
    }
  }, []);

  const play = useCallback(
    (id: string) => {
      stop();
      if (!project) return;
      const audio = new Audio(assetURL(project, id));
      audition.current = audio;
      audio.play().catch(() => onError('无法试听此素材，请检查文件。'));
    },
    [project, stop, onError],
  );

  useEffect(() => () => stop(), [stop]);

  return { play, stop };
}
