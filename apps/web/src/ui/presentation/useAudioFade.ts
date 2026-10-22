import { useEffect, useRef, type RefObject } from 'react';

/** One native player and one short animation; no duplicate streams or audio contexts. */
export function useAudioFade(element: RefObject<HTMLAudioElement | null>, volume: number, muted: boolean) {
  const gain = useRef(1),
    target = useRef({ volume, muted }),
    frame = useRef<number | undefined>(undefined),
    deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  target.current = { volume, muted };
  function apply() {
    if (!element.current) return;
    element.current.volume = Math.max(0, Math.min(1, target.current.volume * gain.current));
    element.current.muted = target.current.muted;
  }
  function cancel() {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (deadline.current !== undefined) clearTimeout(deadline.current);
    deadline.current = undefined;
  }
  function set(value: number) {
    cancel();
    gain.current = value;
    apply();
  }
  function fade(value: number, duration: number, done?: () => void) {
    cancel();
    if (duration <= 0) {
      set(value);
      done?.();
      return;
    }
    const from = gain.current,
      start = performance.now();
    const finish = () => {
      cancel();
      gain.current = value;
      apply();
      done?.();
    };
    const step = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      gain.current = from + (value - from) * (progress * progress * (3 - 2 * progress));
      apply();
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else {
        finish();
      }
    };
    frame.current = requestAnimationFrame(step);
    deadline.current = setTimeout(finish, duration + 30);
  }
  useEffect(apply, [volume, muted]);
  useEffect(() => cancel, []);
  return { set, fade, cancel, gain };
}
