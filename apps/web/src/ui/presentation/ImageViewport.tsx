import { useEffect, useRef, useState } from 'react';
import { zoomImage, type ImageView } from './image-zoom';

const initial: ImageView = { zoom: 1, x: 0, y: 0 };
export default function ImageViewport({ src, title }: { src: string; title: string }) {
  const [view, setView] = useState(initial),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [loaded, setLoaded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      const rect = element.getBoundingClientRect(),
        point = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      setView((old) =>
        zoomImage(old, old.zoom * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.002), point),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function actualSize() {
    const picture = image.current;
    if (!picture || !picture.clientWidth) return;
    setView({ zoom: Math.max(0.25, Math.min(16, picture.naturalWidth / picture.clientWidth)), x: 0, y: 0 });
  }
  return (
    <div className="clue-image-viewer">
      <div
        ref={viewport}
        className="clue-image-viewport"
        aria-label="线索图片查看器"
        data-zoom={view.zoom}
        onPointerDown={(event) => {
          if (event.button !== 0 || failed) return;
          drag.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start)
            setView((old) => ({
              ...old,
              x: start.startX + event.clientX - start.x,
              y: start.startY + event.clientY - start.y,
            }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onDoubleClick={() => setView(initial)}
      >
        {!loaded && !failed && <div className="presentation-load">图片加载中…</div>}
        {failed && (
          <div className="presentation-load">
            图片读取失败{' '}
            <button
              className="btn"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setFailed(false);
                setLoaded(false);
                setRetry((old) => old + 1);
              }}
            >
              重试
            </button>
          </div>
        )}
        <img
          ref={image}
          src={`${src}${src.includes('?') ? '&' : '?'}retry=${retry}`}
          alt={title}
          draggable={false}
          style={{
            transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
            visibility: loaded && !failed ? 'visible' : 'hidden',
          }}
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => {
            setLoaded(false);
            setFailed(true);
          }}
        />
      </div>
      <div className="clue-image-controls">
        <button className="btn" onClick={() => setView(initial)}>
          适应窗口
        </button>
        <button className="btn" disabled={!loaded} onClick={actualSize}>
          原图 100%
        </button>
        <button
          className="btn"
          aria-label="缩小线索图片"
          onClick={() => setView((old) => zoomImage(old, old.zoom / 1.25, { x: 0, y: 0 }))}
        >
          −
        </button>
        <output aria-label="线索图片缩放比例">{Math.round(view.zoom * 100)}%</output>
        <button
          className="btn"
          aria-label="放大线索图片"
          onClick={() => setView((old) => zoomImage(old, old.zoom * 1.25, { x: 0, y: 0 }))}
        >
          ＋
        </button>
      </div>
      <p className="tiny subtle px-3 pb-2">滚轮缩放 · 拖动查看细节 · 双击恢复适应窗口</p>
    </div>
  );
}
