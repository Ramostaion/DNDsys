import { useEffect, useRef, useState } from 'react';
import type { PresentationCurrent } from './usePresentation';
import { zoomImage } from './image-zoom';
import ResizeHandles from '../ResizeHandles';

type View = {
  hidden: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
  mode: 'floating' | 'cinematic';
  cinematicOptOut: boolean;
  reducedMotion: boolean;
};
const initial = (): View => ({
  hidden: false,
  x: Math.max(85, Math.round((innerWidth - 760) / 2)),
  y: Math.max(70, Math.round((innerHeight - 560) / 2)),
  w: Math.min(760, innerWidth - 110),
  h: Math.min(560, innerHeight - 110),
  zoom: 1,
  mode: 'floating',
  cinematicOptOut: false,
  reducedMotion: false,
});
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export default function PresentationViewer({
  roomId,
  userId,
  isGM,
  current,
  error,
  onRetry,
}: {
  roomId: string;
  userId: string;
  isGM: boolean;
  current: PresentationCurrent | null;
  error: string;
  onRetry: () => void;
}) {
  const key = `dnd-presentation-view:${roomId}:${userId}`;
  const [view, setView] = useState<View>(() => {
    let saved: View & { minimized?: boolean };
    try {
      saved = { ...initial(), ...JSON.parse(localStorage.getItem(key) || '{}') };
    } catch {
      saved = initial();
    }
    const hidden = saved.hidden || saved.minimized === true;
    delete saved.minimized;
    return {
      ...saved,
      hidden,
      x: clamp(saved.x, 0, Math.max(0, innerWidth - saved.w - 88)),
      y: clamp(saved.y, 0, Math.max(0, innerHeight - saved.h - 8)),
    };
  });
  const [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [actual, setActual] = useState(false),
    [natural, setNatural] = useState({ w: 0, h: 0 }),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ kind: 'window' | 'image'; x: number; y: number; startX: number; startY: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null),
    wheelState = useRef({ zoom: view.zoom, x: pan.x, y: pan.y, enabled: false });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(view));
    } catch {}
  }, [key, view]);
  useEffect(() => {
    const keepInView = () =>
      setView((old) => ({
        ...old,
        x: clamp(old.x, 0, Math.max(0, innerWidth - old.w - 88)),
        y: clamp(old.y, 0, Math.max(0, innerHeight - old.h - 8)),
      }));
    window.addEventListener('resize', keepInView);
    return () => window.removeEventListener('resize', keepInView);
  }, []);
  useEffect(() => {
    if (current?.asset) {
      setLoading(true);
      setFailed(false);
      setPan({ x: 0, y: 0 });
      setRetry(0);
    }
  }, [current?.asset?.id]);
  useEffect(() => {
    if (
      !isGM &&
      current?.status === 'showing' &&
      current.requestedMode === 'cinematic' &&
      !view.cinematicOptOut &&
      view.mode !== 'cinematic'
    )
      setView((old) => ({ ...old, mode: 'cinematic' }));
  }, [current?.revision, isGM, view.cinematicOptOut, view.mode]);
  const active = current?.status !== 'idle' && current?.status !== undefined;
  const asset = current?.asset;
  wheelState.current = {
    zoom: view.zoom,
    x: pan.x,
    y: pan.y,
    enabled: current?.status === 'showing' && Boolean(asset),
  };
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const old = wheelState.current;
      if (!old.enabled || event.deltaY === 0) return;
      const rect = element.getBoundingClientRect(),
        next = zoomImage(old, old.zoom * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.002), {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        });
      wheelState.current = { ...next, enabled: old.enabled };
      setPan({ x: next.x, y: next.y });
      setView((previous) => ({ ...previous, zoom: next.zoom }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [active, view.hidden]);
  const imageKey = `${asset?.id || 'none'}:${current?.revision || 0}:${retry}`;
  const update = (patch: Partial<View>) => setView((old) => ({ ...old, ...patch }));
  const maximize = () => update({ x: 10, y: 10, w: innerWidth - 100, h: innerHeight - 25 });
  const fit = () => {
    setActual(false);
    setPan({ x: 0, y: 0 });
    update({ zoom: 1 });
  };
  return (
    <>
      {(active || error) && (
        <button
          className="presentation-entry"
          onClick={() => {
            update({ hidden: false });
            onRetry();
          }}
        >
          {active ? `✦ 剧情展示中${asset ? ` · ${asset.title}` : ''}` : '剧情连接中 · 点击重试'}
        </button>
      )}
      {active && !view.hidden && (
        <div
          className={`presentation-viewer surface ${view.mode === 'cinematic' ? 'cinematic' : ''} ${view.reducedMotion ? 'reduced-motion' : ''} transition-${current?.transition || 'none'}`}
          style={{
            left: view.mode === 'cinematic' ? 8 : view.x,
            top: view.mode === 'cinematic' ? 8 : view.y,
            width: view.mode === 'cinematic' ? 'calc(100% - 16px)' : view.w,
            height: view.mode === 'cinematic' ? 'calc(100% - 16px)' : view.h,
          }}
        >
          <div
            className="presentation-titlebar"
            onPointerDown={(e) => {
              if (view.mode === 'cinematic' || (e.target as HTMLElement).closest('button')) return;
              drag.current = { kind: 'window', x: e.clientX, y: e.clientY, startX: view.x, startY: view.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d?.kind === 'window')
                update({
                  x: clamp(d.startX + e.clientX - d.x, 0, Math.max(0, innerWidth - view.w - 88)),
                  y: clamp(d.startY + e.clientY - d.y, 0, Math.max(0, innerHeight - view.h - 8)),
                });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            <span className="truncate flex-1">
              ✦ {asset?.title || '剧情展示'} {current?.status === 'blackout' && '· 黑幕'}
            </span>
            <button
              title="缩小"
              onClick={() =>
                view.mode === 'cinematic'
                  ? update({ mode: 'floating', cinematicOptOut: true })
                  : update({ w: Math.max(420, view.w - 100), h: Math.max(320, view.h - 80) })
              }
            >
              ▣
            </button>
            <button title="应用内最大化" onClick={maximize}>
              □
            </button>
            <button title="仅关闭我的窗口" aria-label="仅关闭我的窗口" onClick={() => update({ hidden: true })}>
              ×
            </button>
          </div>
          <div ref={canvas} className="presentation-canvas" title="滚轮缩放，放大后可拖动图片">
            {current?.status === 'blackout' ? (
              <div className="presentation-blackout">
                <span>黑幕</span>
                <small>GM 正在准备下一幕</small>
              </div>
            ) : asset ? (
              <>
                {loading && !failed && <div className="presentation-load">正在加载剧情图片…</div>}
                {failed && (
                  <div className="presentation-load">
                    图片不可用{' '}
                    <button
                      className="btn"
                      onClick={() => {
                        setFailed(false);
                        setLoading(true);
                        setRetry((value) => value + 1);
                      }}
                    >
                      重试图片
                    </button>
                  </div>
                )}
                <div
                  key={imageKey}
                  className="presentation-image-layer"
                  onPointerDown={(e) => {
                    if (view.zoom <= 1 && !actual) return;
                    drag.current = { kind: 'image', x: e.clientX, y: e.clientY, startX: pan.x, startY: pan.y };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (d?.kind === 'image') setPan({ x: d.startX + e.clientX - d.x, y: d.startY + e.clientY - d.y });
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                >
                  <img
                    key={imageKey}
                    className="presentation-art"
                    src={`${asset.screenUrl}?r=${retry}`}
                    alt={asset.title}
                    draggable={false}
                    style={{
                      display: failed ? 'none' : undefined,
                      width: actual ? natural.w : undefined,
                      height: actual ? natural.h : undefined,
                      maxWidth: actual ? 'none' : '100%',
                      maxHeight: actual ? 'none' : '100%',
                      transform: `translate(${pan.x}px,${pan.y}px) scale(${view.zoom})`,
                      opacity: loading ? 0 : 1,
                    }}
                    onLoad={(e) => {
                      setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                      setLoading(false);
                      setFailed(false);
                    }}
                    onError={() => {
                      setLoading(false);
                      setFailed(true);
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="presentation-load">
                当前画面暂不可用{' '}
                <button className="btn" onClick={onRetry}>
                  重试
                </button>
              </div>
            )}
          </div>
          <div className="presentation-controls">
            <button onClick={fit}>适应</button>
            <button
              onClick={() => {
                setActual(true);
                update({ zoom: 1 });
                setPan({ x: 0, y: 0 });
              }}
            >
              100%
            </button>
            <button onClick={() => update({ zoom: clamp(view.zoom - 0.25, 0.25, 16) })}>−</button>
            <span>{Math.round(view.zoom * 100)}%</span>
            <button onClick={() => update({ zoom: clamp(view.zoom + 0.25, 0.25, 16) })}>＋</button>
            <button
              onClick={() =>
                update({
                  mode: view.mode === 'cinematic' ? 'floating' : 'cinematic',
                  cinematicOptOut: view.mode === 'cinematic' ? true : view.cinematicOptOut,
                })
              }
            >
              {view.mode === 'cinematic' ? '返回浮窗' : '沉浸大屏'}
            </button>
            <button onClick={() => update({ reducedMotion: !view.reducedMotion })}>
              {view.reducedMotion ? '开启动效' : '关闭动效'}
            </button>
          </div>
          {asset?.caption && <div className="presentation-caption">{asset.caption}</div>}
          {view.mode === 'floating' && (
            <ResizeHandles rect={view} minW={420} minH={320} onResize={(rect) => update(rect)} />
          )}
        </div>
      )}
    </>
  );
}
