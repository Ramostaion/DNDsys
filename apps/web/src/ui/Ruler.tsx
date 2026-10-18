import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Circle, Group, Line, Rect, Text, Wedge } from 'react-konva';
import type Konva from 'konva';
import { coneRulerBounds } from './ruler-bounds';

export default function Ruler({
  drawing,
  canMove,
  selected,
  scale,
  onChange,
  onSelect,
  color,
  snapOrigin,
  onDelete,
  onHover,
  onHoverEnd,
}: {
  drawing: any;
  canMove: boolean;
  selected: boolean;
  scale: number;
  onChange: (patch: Record<string, number>) => Promise<unknown>;
  onSelect: () => void;
  color: string;
  snapOrigin: (point: { x: number; y: number }) => { x: number; y: number };
  onDelete: () => Promise<unknown>;
  onHover: (x: number, y: number) => void;
  onHoverEnd: () => void;
}) {
  const data = drawing.data || {},
    length = Number(data.length) || 100,
    shape = data.shape || 'LINE',
    coneAngle = Number(data.angle) || 60;
  const shapeGroup = useRef<Konva.Group>(null);
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: length, height: 0 });
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false),
    hoverEnd = useRef(onHoverEnd);
  hoverEnd.current = onHoverEnd;
  const [rotation, setRotation] = useState(Number(data.rotation) || 0);
  const angle = useRef(rotation),
    serverAngle = useRef(rotation),
    pending = useRef(false),
    saving = useRef<Promise<void> | null>(null),
    mounted = useRef(true);
  const group = useRef<Konva.Group>(null),
    dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    save = useRef(onChange);
  save.current = onChange;
  serverAngle.current = Number(data.rotation) || 0;
  useLayoutEffect(() => {
    if (selected && shapeGroup.current && group.current)
      setBounds(
        shape === 'CONE'
          ? coneRulerBounds(length, coneAngle, rotation)
          : shapeGroup.current.getClientRect({ relativeTo: group.current }),
      );
  }, [selected, rotation, shape, length, coneAngle, scale]);
  useEffect(() => {
    if (!dragging.current && !pending.current && !saving.current) {
      angle.current = serverAngle.current;
      setRotation(serverAngle.current);
    }
  }, [data.rotation]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      hoverEnd.current();
    };
  }, []);
  async function flush() {
    if (saving.current) {
      await saving.current;
      return;
    }
    const task = (async () => {
      while (pending.current && mounted.current) {
        pending.current = false;
        await save.current({ rotation: angle.current });
      }
    })();
    saving.current = task;
    try {
      await task;
    } catch (error) {
      pending.current = false;
      angle.current = serverAngle.current;
      if (mounted.current) setRotation(serverAngle.current);
      throw error;
    } finally {
      saving.current = null;
    }
  }
  function queueAngle(value: number) {
    angle.current = value;
    setRotation(value);
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
  }
  const radius = Math.max(
    32 / scale,
    shape === 'CIRCLE' ? length / 2 : shape === 'SQUARE' ? length / (2 * Math.SQRT2) : length,
  );
  const handleX = radius * Math.cos((rotation * Math.PI) / 180),
    handleY = radius * Math.sin((rotation * Math.PI) / 180);
  function followHandle(node: Konva.Node) {
    const degrees = (Math.atan2(node.y(), node.x()) * 180) / Math.PI;
    angle.current = (degrees + 360) % 360;
    setRotation(angle.current);
  }
  async function remove() {
    if (!canMove || deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    onHoverEnd();
    if (timer.current) clearTimeout(timer.current);
    pending.current = false;
    try {
      await saving.current?.catch(() => {});
      await onDelete();
    } catch {
      deletePending.current = false;
      if (mounted.current) setDeleting(false);
    }
  }
  const common = { stroke: color, strokeWidth: 2, hitStrokeWidth: 16 / scale, fillEnabled: false };
  return (
    <Group
      ref={group}
      name="ruler"
      id={drawing.id}
      x={Number(data.x) || 0}
      y={Number(data.y) || 0}
      draggable={canMove && !deleting}
      onMouseEnter={(event) => onHover(event.evt.clientX, event.evt.clientY)}
      onMouseLeave={onHoverEnd}
      onDblClick={(event) => {
        event.cancelBubble = true;
        if (canMove && !deleting) onSelect();
      }}
      onDragStart={(event) => {
        if (event.target.id() === drawing.id) onHoverEnd();
      }}
      onDragMove={(event) => {
        if (event.target.id() === drawing.id) event.target.position(snapOrigin(event.target.position()));
      }}
      onDragEnd={(event) => {
        if (event.target.id() === drawing.id) {
          const point = snapOrigin(event.target.position());
          event.target.position(point);
          void onChange(point).catch(() => group.current?.position({ x: Number(data.x) || 0, y: Number(data.y) || 0 }));
        }
      }}
      onWheel={(event) => {
        if (!canMove || deleting || event.evt.deltaY === 0) return;
        event.evt.preventDefault();
        event.cancelBubble = true;
        queueAngle((angle.current + (event.evt.deltaY > 0 ? 5 : -5) + 360) % 360);
        timer.current = setTimeout(() => void flush().catch(() => {}), 120);
      }}
    >
      <Group ref={shapeGroup} name="ruler-shape" rotation={rotation}>
        {shape === 'LINE' && <Line points={[0, 0, length, 0]} {...common} />}
        {shape === 'CIRCLE' && (
          <>
            <Circle radius={length / 2} fill={`${color}33`} listening={false} />
            <Circle radius={length / 2} {...common} />
          </>
        )}
        {shape === 'SQUARE' && (
          <>
            <Rect
              x={-length / (2 * Math.SQRT2)}
              y={-length / (2 * Math.SQRT2)}
              width={length / Math.SQRT2}
              height={length / Math.SQRT2}
              fill={`${color}33`}
              listening={false}
            />
            <Rect
              x={-length / (2 * Math.SQRT2)}
              y={-length / (2 * Math.SQRT2)}
              width={length / Math.SQRT2}
              height={length / Math.SQRT2}
              {...common}
            />
          </>
        )}
        {shape === 'CONE' && (
          <>
            <Wedge radius={length} angle={coneAngle} rotation={-coneAngle / 2} fill={`${color}33`} listening={false} />
            <Wedge radius={length} angle={coneAngle} rotation={-coneAngle / 2} {...common} />
          </>
        )}
      </Group>
      <Circle radius={7} fill={color} />
      <Group name="ruler-label" x={-32} y={12}>
        <Rect width={64} height={22} cornerRadius={5} fill="#101b28e6" />
        <Text
          text={`${data.distance || ''} 尺`}
          width={64}
          height={22}
          align="center"
          verticalAlign="middle"
          fontSize={12}
          fill="white"
        />
      </Group>
      {selected && canMove && (
        <>
          <Rect
            name="ruler-selection-box"
            x={bounds.x - 8 / scale}
            y={bounds.y - 8 / scale}
            width={bounds.width + 16 / scale}
            height={bounds.height + 16 / scale}
            stroke={color}
            strokeWidth={1 / scale}
            dash={[5 / scale, 4 / scale]}
            listening={false}
          />
          <Group
            name="ruler-delete"
            x={bounds.x + bounds.width + 8 / scale}
            y={bounds.y - 28 / scale}
            opacity={deleting ? 0.5 : 1}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onTouchStart={(event) => {
              event.cancelBubble = true;
            }}
            onClick={(event) => {
              event.cancelBubble = true;
              void remove();
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              void remove();
            }}
            onDblClick={(event) => {
              event.cancelBubble = true;
            }}
            onMouseEnter={(event) => {
              const container = event.target.getStage()?.container();
              if (container) {
                container.style.cursor = 'var(--room-cursor, pointer)';
                container.title = '删除量尺';
              }
            }}
            onMouseLeave={(event) => {
              const container = event.target.getStage()?.container();
              if (container) {
                container.style.cursor = '';
                container.title = '';
              }
            }}
          >
            <Circle radius={11 / scale} fill="#852f3c" stroke="#ffd4d4" strokeWidth={1 / scale} />
            <Text
              text="×"
              x={-11 / scale}
              y={-11 / scale}
              width={22 / scale}
              height={22 / scale}
              align="center"
              verticalAlign="middle"
              fontSize={19 / scale}
              fill="white"
            />
          </Group>
          <Line
            points={[0, 0, handleX, handleY]}
            stroke="#f1c57f"
            strokeWidth={1 / scale}
            dash={[5 / scale, 5 / scale]}
            listening={false}
          />
          <Circle
            name="ruler-rotation-handle"
            x={handleX}
            y={handleY}
            radius={8 / scale}
            hitStrokeWidth={12 / scale}
            fill="#efc87f"
            stroke="#fff1cd"
            strokeWidth={2 / scale}
            shadowColor="#000"
            shadowBlur={6}
            draggable={!deleting}
            dragBoundFunc={(position) => {
              const transform = group.current!.getAbsoluteTransform();
              const pointer = group.current!.getStage()?.getPointerPosition() || position;
              const point = transform.copy().invert().point(pointer),
                distance = Math.hypot(point.x, point.y);
              if (distance < 0.001) return transform.point({ x: handleX, y: handleY });
              return transform.point({ x: (point.x * radius) / distance, y: (point.y * radius) / distance });
            }}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragStart={(event) => {
              event.cancelBubble = true;
              dragging.current = true;
              if (timer.current) clearTimeout(timer.current);
            }}
            onDragMove={(event) => {
              event.cancelBubble = true;
              followHandle(event.target);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              followHandle(event.target);
              dragging.current = false;
              pending.current = true;
              void flush().catch(() => {});
            }}
            onMouseEnter={(event) => {
              const container = event.target.getStage()?.container();
              if (container) container.style.cursor = 'crosshair';
            }}
            onMouseLeave={(event) => {
              const container = event.target.getStage()?.container();
              if (container) container.style.cursor = '';
            }}
          />
          <Text
            name="ruler-angle-label"
            text={`${Number(rotation.toFixed(1))}° · 拖动端点旋转`}
            x={-80 / scale}
            y={40 / scale}
            width={160 / scale}
            align="center"
            fontSize={11 / scale}
            fill="#efc87f"
            listening={false}
          />
        </>
      )}
    </Group>
  );
}
