import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type HoverAnchor = Pick<HTMLElement, 'isConnected' | 'getBoundingClientRect'>;

export function useHoverPreview<T extends HoverAnchor = HTMLElement>() {
  const [preview, setPreview] = useState<{ id: string; anchor: T } | null>(null);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useCallback(() => {
    clearTimeout(opening.current);
    clearTimeout(closing.current);
    setPreview(null);
  }, []);
  const keep = useCallback(() => clearTimeout(closing.current), []);
  const show = useCallback((id: string, anchor: T) => {
    clearTimeout(opening.current);
    clearTimeout(closing.current);
    setPreview((old) => (old?.id === id ? old : null));
    opening.current = setTimeout(() => setPreview({ id, anchor }), 180);
  }, []);
  const leave = useCallback(() => {
    clearTimeout(opening.current);
    closing.current = setTimeout(() => setPreview(null), 120);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(opening.current);
      clearTimeout(closing.current);
    },
    [],
  );
  return { preview, show, leave, close, keep };
}

export default function HoverCard({
  anchor,
  keep,
  leave,
  close,
  label,
  className,
  children,
}: {
  anchor: HoverAnchor;
  keep: () => void;
  leave: () => void;
  close: () => void;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected || !ref.current) return close();
      const a = anchor.getBoundingClientRect(),
        b = ref.current.getBoundingClientRect();
      const left = Math.max(
        12,
        Math.min(
          a.right + 10 + b.width <= window.innerWidth - 12 ? a.right + 10 : a.left - b.width - 10,
          window.innerWidth - b.width - 12,
        ),
      );
      const top = Math.max(12, Math.min(a.top, window.innerHeight - b.height - 12));
      setPosition((old) => (old?.left === left && old.top === top ? old : { left, top }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(ref.current!);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('resize', close);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', escape);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', escape);
    };
  }, [anchor, close]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      aria-label={label}
      className={className}
      style={{ position: 'fixed', ...(position || { left: 12, top: 12, visibility: 'hidden' }) }}
      onPointerEnter={keep}
      onPointerLeave={leave}
      onFocusCapture={keep}
      onBlurCapture={leave}
    >
      {children}
    </div>,
    document.body,
  );
}
