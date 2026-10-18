import { useEffect, useRef, useState } from 'react';

export function useDropFeedback() {
  const [hover, setHover] = useState<string | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [landed, setLanded] = useState<string | null>(null);
  const lock = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function run(target: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setHover(null);
    setPending(target);
    setLanded(null);
    clearTimeout(timer.current);
    try {
      await action();
      setLanded(target);
      timer.current = setTimeout(() => setLanded(null), 450);
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  return { hover, setHover, pending, landed, run };
}
