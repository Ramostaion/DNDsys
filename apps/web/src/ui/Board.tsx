import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KImage, Circle, Text, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import MapToolsPanel from './MapToolsPanel';
import type { Snapshot } from '../api';
import { canEditCharacter } from '../permissions';
import Ruler from './Ruler';
import CharacterHoverCard from './CharacterHoverCard';
import { characterHealth, characterShield } from './character-summary';
import type { WindowType } from '../store';
import { worldPoint, rulerPixels, rulerAuthorColors, sortCharacterTags, type CharacterTag } from '@dnd/shared';
import { snapRulerOrigin, TOKEN_RADIUS } from './ruler-snap';
import type { TokenMovementChannel } from './token-motion';
import { useTokenMotion } from './useTokenMotion';
import { useStrokeEraser } from './useStrokeEraser';
import DrawingHistoryControls from './DrawingHistoryControls';

const imageUrl = (url?: string | null) => (url?.startsWith('/') ? url : url || '');
function useImage(src?: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const next = new Image();
    next.onload = () => setImg(next);
    next.onerror = () => setImg(null);
    next.src = imageUrl(src);
    return () => {
      next.onload = null;
    };
  }, [src]);
  return img;
}
function Token({
  token,
  character,
  tags,
  canMove,
  scale,
  onMove,
  onOpen,
  onMenu,
  onTag,
  onTags,
  health,
  shield,
  onHover,
  onHoverEnd,
  movements,
}: {
  token: any;
  character: any;
  tags: CharacterTag[];
  canMove: boolean;
  scale: number;
  onMove: (x: number, y: number, version: number, id: string) => Promise<any>;
  movements: TokenMovementChannel;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onTag: (id: string) => void;
  onTags: () => void;
  health: ReturnType<typeof characterHealth>;
  shield: ReturnType<typeof characterShield>;
  onHover: (x: number, y: number) => void;
  onHoverEnd: () => void;
}) {
  const image = useImage(character?.avatarUrl);
  const motion = useTokenMotion(token, movements, onMove, scale);
  const tokenGroup = motion.group;
  const tagRevision = JSON.stringify(
    tags.map((tag) => [tag.id, tag.version, tag.definition.name, tag.definition.icon, tag.definition.color]),
  );
  useEffect(() => {
    const container = tokenGroup.current?.getStage()?.container();
    if (!container) return;
    const clear = () => {
      container.title = '';
      container.style.cursor = '';
    };
    clear();
    return clear;
  }, [tagRevision]);
  const sorted = sortCharacterTags(tags);
  const glyphs: Record<string, string> = {
    clue: '?',
    secret: '◈',
    curse: '☠',
    relation: '∞',
    event: '⚑',
    todo: '✓',
    star: '★',
    key: '⚿',
    book: '▤',
    heart: '♥',
    shield: '⛨',
    flame: '♨',
  };
  const marks = sorted.slice(0, 3).map((t) => ({
    id: t.id,
    label: t.definition.name,
    glyph: glyphs[t.definition.icon] || t.definition.icon,
    color: t.definition.color,
  }));
  if (sorted.length > 3)
    marks.push({
      id: 'overflow',
      label: `查看全部 ${sorted.length} 个可见标签`,
      glyph: `+${sorted.length - 3}`,
      color: '#c69452',
    });
  return (
    <>
      <Group
        ref={motion.effects}
        id={`move-effects-${token.id}`}
        name="token-move-effects"
        visible={false}
        listening={false}
      >
        <Group ref={motion.guide} name="token-move-guide" opacity={0} listening={false} />
        {[0, 1, 2, 3].map((index) => (
          <Group
            key={index}
            name="token-move-ghost"
            ref={(node) => {
              motion.ghosts.current[index] = node;
            }}
            opacity={0}
          >
            <Circle radius={TOKEN_RADIUS} fill="#243c55" stroke="#c2b184" strokeWidth={1} />
            {image ? (
              <KImage image={image} x={-26} y={-26} width={52} height={52} cornerRadius={26} />
            ) : (
              <Text
                text={(character?.name || '?').slice(0, 1)}
                x={-13}
                y={-16}
                width={26}
                align="center"
                fontSize={26}
                fill="#e6f8ff"
              />
            )}
          </Group>
        ))}
        <Circle ref={motion.ring} name="token-move-ring" radius={29} stroke="#c4b789" strokeWidth={1.4} opacity={0} />
      </Group>
      <Group
        ref={tokenGroup}
        name="map-token"
        id={token.id}
        x={motion.initial.x}
        y={motion.initial.y}
        draggable={canMove}
        onDragStart={(e) => {
          onHoverEnd();
          if (!motion.dragStart()) e.target.stopDrag();
        }}
        onDragEnd={(e) => void motion.dragEnd(e.target.x(), e.target.y())}
        onDblClick={onOpen}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          onMenu(e.evt.clientX, e.evt.clientY);
        }}
      >
        <Group
          ref={motion.avatar}
          onMouseEnter={(event) => onHover(event.evt.clientX, event.evt.clientY)}
          onMouseLeave={onHoverEnd}
        >
          <Circle
            ref={motion.shadow}
            radius={TOKEN_RADIUS}
            fill="#243c55"
            stroke="#8dd7e8"
            strokeWidth={2 / scale}
            shadowColor="#b7a47c"
            shadowOpacity={0}
          />
          {image ? (
            <KImage image={image} x={-26} y={-26} width={52} height={52} cornerRadius={26} />
          ) : (
            <Text
              text={(character?.name || '?').slice(0, 1)}
              x={-13}
              y={-16}
              width={26}
              align="center"
              fontSize={26}
              fill="#e6f8ff"
            />
          )}
        </Group>
        {shield && (
          <Group x={34} y={-35} listening={false} name="token-shield">
            <Rect width={50} height={7} fill="#152c38" stroke="#568fa8" strokeWidth={1} cornerRadius={3} />
            <Rect width={(50 * shield.percent) / 100} height={7} fill="#6ac9ed" cornerRadius={3} />
            <Text
              text={`${shield.current}/${shield.maximum}`}
              y={9}
              width={50}
              fontSize={10}
              fill="#bcecff"
              align="center"
              shadowColor="black"
              shadowBlur={3}
            />
          </Group>
        )}
        {health && (
          <Group x={34} y={-10} listening={false} name="token-health">
            <Rect width={50} height={7} fill="#202b29" stroke="#506750" strokeWidth={1} cornerRadius={3} />
            <Rect
              width={(50 * health.percent) / 100}
              height={7}
              fill={health.percent > 50 ? '#67b88b' : health.percent > 25 ? '#d5ad55' : '#d76d65'}
              cornerRadius={3}
            />
            <Text
              text={`${health.current}/${health.maximum}`}
              y={11}
              width={50}
              fontSize={10}
              fill="#e2eee5"
              align="center"
              shadowColor="black"
              shadowBlur={3}
            />
          </Group>
        )}
        <Text
          text={character?.name || '角色'}
          x={-50}
          y={34}
          width={100}
          align="center"
          fontSize={13}
          fill="white"
          shadowColor="black"
          shadowBlur={4}
        />
        {marks.map((mark, i) => (
          <Group
            key={mark.id}
            x={i === 2 || i === 3 ? -25 : 25}
            y={i === 1 || i === 3 ? 16 : -23}
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              if (mark.id === 'overflow') onTags();
              else onTag(mark.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              if (mark.id === 'overflow') onTags();
              else onTag(mark.id);
            }}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.title = mark.label;
                container.style.cursor = 'pointer';
              }
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.title = '';
                container.style.cursor = '';
              }
            }}
          >
            <Circle radius={10} fill="#182331" stroke={mark.color} strokeWidth={1.5} />
            <Text
              text={mark.glyph}
              x={-9}
              y={-6}
              width={18}
              align="center"
              fontSize={mark.id === 'overflow' ? 9 : 12}
              fill={mark.color}
            />
          </Group>
        ))}
      </Group>
    </>
  );
}
export default function Board({
  snap,
  me,
  mutate,
  open,
  movements,
}: {
  snap: Snapshot;
  me: any;
  mutate: (type: string, payload: Record<string, unknown>, operationId?: string) => Promise<any>;
  movements: TokenMovementChannel;
  open: (type: WindowType, id?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const drawingLayer = useRef<Konva.Layer>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [menu, setMenu] = useState<{ x: number; y: number; token: any } | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [tool, setTool] = useState<'pan' | 'pen' | 'eraser' | 'ruler'>('pan');
  const [measure, setMeasure] = useState<{ shape: string; distance: number } | null>(null);
  const [brushSize, setBrushSize] = useState(4);
  const [brushColor, setBrushColor] = useState('#f3c268');
  const active = snap.maps.find((m) => m.id === snap.room.activeMapId);
  const bg = useImage(active?.imageUrl);
  const self = snap.members.find((m) => m.userId === me.id);
  const canDraw = self?.role === 'GM' || self?.permissions?.draw === true;
  const eraser = useStrokeEraser(active?.id, tool === 'eraser' && canDraw, drawingLayer, stage, mutate);
  const [hovered, setHovered] = useState<{ tokenId: string; x: number; y: number } | null>(null),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoveredRuler, setHoveredRuler] = useState<{ id: string; x: number; y: number } | null>(null);
  const stopHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
    setHovered(null);
    setHoveredRuler(null);
  };
  const endHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(null), 180);
  };
  const holdHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };
  useEffect(() => {
    stopHover();
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, [active?.id]);
  const toolsKey = `dnd-map-tools:${snap.room.id}:${me.id}`;
  const [toolsCollapsed, setToolsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(toolsKey) === 'collapsed';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setToolsCollapsed(localStorage.getItem(toolsKey) === 'collapsed');
    } catch {
      setToolsCollapsed(false);
    }
  }, [toolsKey]);
  function toggleTools() {
    const next = !toolsCollapsed;
    setToolsCollapsed(next);
    try {
      localStorage.setItem(toolsKey, next ? 'collapsed' : 'expanded');
    } catch {}
  }
  const [selectedRuler, setSelectedRuler] = useState<string | null>(null);
  useEffect(() => setSelectedRuler(null), [active?.id]);
  useEffect(() => {
    if (selectedRuler && !snap.drawings.some((drawing) => drawing.id === selectedRuler)) setSelectedRuler(null);
  }, [selectedRuler, snap.drawings]);
  useEffect(() => {
    if (!selectedRuler) return;
    const close = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        setSelectedRuler(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedRuler]);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) =>
      setSize({ w: entries[0].contentRect.width, h: entries[0].contentRect.height }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (active)
      setView({
        x: Math.max(0, (size.w - active.width) / 2),
        y: Math.max(0, (size.h - active.height) / 2),
        scale: Math.min(1, size.w / active.width, size.h / active.height),
      });
  }, [active?.id, size.w, size.h]);
  const characters = useMemo(() => new Map(snap.characters.map((c) => [c.id, c])), [snap.characters]);
  const rulerColors = useMemo(() => rulerAuthorColors(snap.members, snap.drawings), [snap.members, snap.drawings]);
  const mapTokens = snap.tokens.filter((token) => token.mapId === active?.id);
  const snapOrigin = (point: { x: number; y: number }) => snapRulerOrigin(point, mapTokens, view.scale);
  function pointer() {
    const p = stage.current?.getPointerPosition();
    return p ? worldPoint(p, view) : null;
  }
  function wheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    eraser.cancel();
    stopHover();
    const old = view.scale,
      next = Math.max(0.15, Math.min(5, old * (e.evt.deltaY > 0 ? 0.9 : 1.1)));
    const p = stage.current?.getPointerPosition();
    if (!p) return;
    const point = worldPoint(p, view);
    setView({ x: p.x - point.x * next, y: p.y - point.y * next, scale: next });
  }
  function down(e: Konva.KonvaEventObject<MouseEvent>) {
    stopHover();
    if (!e.target.findAncestor('.ruler', true)) setSelectedRuler(null);
    if (!active || e.evt.button !== 0) return;
    if (tool === 'eraser') {
      eraser.start();
      return;
    }
    const p = pointer();
    if (!p) return;
    if (tool === 'ruler' && measure) {
      const length = rulerPixels(measure.distance, active.scalePixels, active.scaleUnits);
      const snapped = snapOrigin(p);
      void mutate('drawing.add', {
        mapId: active.id,
        kind: 'RULER',
        data: { ...measure, length, ...snapped, rotation: 0, angle: snap.room.rules?.coneAngle || 60 },
      });
      setTool('pan');
      setMeasure(null);
      return;
    }
    if (tool === 'pen' && canDraw) setDraft([p.x, p.y]);
  }
  function move() {
    if (tool === 'eraser') {
      eraser.move();
      return;
    }
    if (!draft) return;
    const p = pointer();
    if (p) setDraft([...draft, p.x, p.y]);
  }
  async function up() {
    if (tool === 'eraser') {
      await eraser.finish();
      return;
    }
    if (!draft || !active) return;
    const points = draft;
    setDraft(null);
    if (points.length >= 4)
      await mutate('drawing.add', {
        mapId: active.id,
        kind: 'STROKE',
        data: { points, color: brushColor, width: brushSize },
      });
  }
  async function drop(e: React.DragEvent) {
    e.preventDefault();
    if (!active) return;
    const id = e.dataTransfer.getData('characterId');
    if (!id) return;
    const rect = host.current!.getBoundingClientRect();
    const p = worldPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view);
    await mutate('token.create', { mapId: active.id, characterId: id, x: p.x, y: p.y });
  }
  const tokenActions = menu
    ? [
        { label: '查看人物卡', run: () => open('character', menu.token.characterId) },
        { label: '查看角色标签', run: () => open('character-tags', menu.token.characterId) },
        ...(self?.role === 'GM'
          ? [
              { label: '不显示当前人物', run: () => mutate('token.delete', { id: menu.token.id }) },
              {
                label: '复制当前人物',
                run: () => mutate('character.copy', { id: menu.token.characterId, tokenId: menu.token.id }),
              },
            ]
          : []),
      ]
    : [];
  return (
    <div
      ref={host}
      className="absolute inset-0 board-surface"
      style={{ cursor: tool === 'eraser' ? 'crosshair' : undefined }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(event) => void drop(event).catch(() => {})}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => menu && setMenu(null)}
      onMouseLeave={() => void eraser.finish()}
    >
      <Stage
        ref={stage}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={tool === 'pan'}
        onDragStart={stopHover}
        onDragEnd={(e) => {
          if (e.target === stage.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onWheel={wheel}
        onMouseDown={down}
        onMouseMove={move}
        onMouseUp={() => void up().catch(() => {})}
      >
        <Layer>
          {active && (
            <>
              {bg ? (
                <KImage image={bg} width={active.width} height={active.height} />
              ) : (
                <Rect width={active.width} height={active.height} fill="#142032" stroke="#394a5d" />
              )}
            </>
          )}
        </Layer>
        <Layer ref={drawingLayer}>
          {snap.drawings
            .filter((d) => d.mapId === active?.id && d.kind !== 'RULER')
            .map((d) => (
              <Line
                key={d.id}
                id={d.id}
                name={d.kind === 'STROKE' ? 'map-stroke' : 'legacy-eraser'}
                visible={!eraser.preview.has(d.id)}
                listening={tool === 'eraser' && canDraw && d.kind === 'STROKE'}
                hitStrokeWidth={Math.max(Number(d.data.width) || 0, 12 / view.scale)}
                points={d.data.points || []}
                stroke={d.data.color || '#f3c268'}
                strokeWidth={d.data.width ?? 4}
                globalCompositeOperation={d.kind === 'ERASER' ? 'destination-out' : 'source-over'}
                tension={0.3}
                lineCap="round"
                lineJoin="round"
              />
            ))}
          {draft && (
            <Line points={draft} stroke={brushColor} strokeWidth={brushSize} listening={false} lineCap="round" />
          )}
        </Layer>
        <Layer listening={tool !== 'eraser'}>
          {snap.portals
            .filter((p) => p.sourceMapId === active?.id)
            .map((p) => (
              <Group
                key={p.id}
                name="map-portal"
                id={p.id}
                x={p.x}
                y={p.y}
                draggable={self?.role === 'GM'}
                onDragEnd={(event) => {
                  void mutate('portal.update', { id: p.id, x: event.target.x(), y: event.target.y() }).catch(() => {});
                }}
                onClick={(event) => {
                  event.cancelBubble = true;
                  open('portal', p.id);
                }}
                onTap={(event) => {
                  event.cancelBubble = true;
                  open('portal', p.id);
                }}
              >
                <Circle radius={20} fill="#1f7894" stroke="#aae7f3" strokeWidth={2} />
                <Text text="↗" x={-10} y={-13} fontSize={24} fill="white" />
                <Text text={p.label} y={25} x={-45} width={90} align="center" fontSize={12} fill="white" />
              </Group>
            ))}
          {snap.tokens
            .filter((t) => t.mapId === active?.id)
            .map((t) => {
              const c = characters.get(t.characterId);
              return (
                <Token
                  key={t.id}
                  token={t}
                  movements={movements}
                  character={c}
                  tags={snap.characterTags.filter((tag) => tag.characterId === t.characterId)}
                  onTag={(id) => open('tag-detail', id)}
                  onTags={() => open('character-tags', t.characterId)}
                  health={c ? characterHealth(snap, c) : null}
                  shield={c ? characterShield(snap, c) : null}
                  onHover={(x, y) => {
                    holdHover();
                    const box = host.current!.getBoundingClientRect(),
                      point = stage.current?.findOne('#' + t.id)?.getAbsolutePosition() || {
                        x: x - box.left,
                        y: y - box.top,
                      },
                      gap = TOKEN_RADIUS * view.scale + 16,
                      right = point.x + gap;
                    setHovered({
                      tokenId: t.id,
                      x: Math.max(8, right + 308 <= size.w ? right : point.x - gap - 308),
                      y: Math.max(8, Math.min(point.y - 28, size.h - 490)),
                    });
                  }}
                  onHoverEnd={endHover}
                  scale={view.scale}
                  canMove={Boolean(c && canEditCharacter(snap, me.id, c))}
                  onMove={(x, y, version, id) => mutate('token.move', { id: t.id, x, y, version }, id)}
                  onOpen={() => open('character', t.characterId)}
                  onMenu={(x, y) => {
                    stopHover();
                    setMenu({ x, y, token: t });
                  }}
                />
              );
            })}
        </Layer>
        <Layer name="rulers-layer" listening={tool !== 'eraser'}>
          {snap.drawings
            .filter((drawing) => drawing.mapId === active?.id && drawing.kind === 'RULER')
            .map((drawing) => (
              <Ruler
                key={drawing.id}
                drawing={drawing}
                color={rulerColors.get(drawing.authorId) || '#70def4'}
                canMove={drawing.authorId === me.id || self?.role === 'GM'}
                selected={selectedRuler === drawing.id}
                scale={view.scale}
                snapOrigin={snapOrigin}
                onChange={(patch) => mutate('drawing.update', { id: drawing.id, patch })}
                onSelect={() => setSelectedRuler((current) => (current === drawing.id ? null : drawing.id))}
                onDelete={() => mutate('drawing.undo', { id: drawing.id })}
                onHover={(x, y) => {
                  stopHover();
                  const box = host.current!.getBoundingClientRect();
                  setHoveredRuler({
                    id: drawing.id,
                    x: Math.max(8, Math.min(x - box.left + 14, size.w - 250)),
                    y: Math.max(8, Math.min(y - box.top + 16, size.h - 58)),
                  });
                }}
                onHoverEnd={() => setHoveredRuler(null)}
              />
            ))}
        </Layer>
      </Stage>
      {hoveredRuler &&
        (() => {
          const drawing = snap.drawings.find(
            (drawing) => drawing.id === hoveredRuler.id && drawing.mapId === active?.id,
          );
          const author =
            drawing &&
            (drawing.data.authorName ||
              snap.members.find((member) => member.userId === drawing.authorId)?.user.username ||
              '已离开的玩家');
          return drawing ? (
            <div
              role="tooltip"
              aria-label="量尺创建者"
              className="surface absolute rounded-lg px-3 py-2 text-xs pointer-events-none z-20"
              style={{ left: hoveredRuler.x, top: hoveredRuler.y, borderColor: rulerColors.get(drawing.authorId) }}
            >
              <span style={{ color: rulerColors.get(drawing.authorId) }}>● </span>创建者：{author}
            </div>
          ) : null;
        })()}
      {hovered &&
        snap.tokens.some((token) => token.id === hovered.tokenId && token.mapId === active?.id) &&
        (() => {
          const token = snap.tokens.find((token) => token.id === hovered.tokenId),
            character = token && characters.get(token.characterId);
          return character ? (
            <div
              role="tooltip"
              aria-label="角色概览"
              className="character-hover-card surface scroll"
              style={{ left: hovered.x, top: hovered.y }}
              onMouseEnter={holdHover}
              onMouseLeave={endHover}
            >
              <CharacterHoverCard snap={snap} character={character} />
            </div>
          ) : null;
        })()}
      {menu && (
        <div
          role="group"
          aria-label="棋子操作"
          className="surface absolute rounded-lg p-1 z-20 w-36"
          style={{
            left: menu.x - host.current!.getBoundingClientRect().left,
            top: menu.y - host.current!.getBoundingClientRect().top,
          }}
        >
          {tokenActions.map((action) => (
            <button
              key={action.label}
              className="block w-full text-left px-3 py-2 hover:bg-[#30465b] rounded"
              onClick={() => {
                setMenu(null);
                void Promise.resolve()
                  .then(action.run)
                  .catch(() => {});
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {!active && (
        <div className="board-empty">
          <div className="board-sigil">✧</div>
          <div className="eyebrow">THE TABLE IS READY</div>
          <h2 className="display-title text-3xl mt-3">故事从这里展开</h2>
          <p className="subtle mt-3 text-sm">主持人可以布置地图，再将角色拖到场景中。</p>
          <button className="btn btn-primary mt-6" onClick={() => open('maps')}>
            打开地图册
          </button>
        </div>
      )}
      <MapToolsPanel key={toolsKey} storageKey={`${toolsKey}:position`} collapsed={toolsCollapsed}>
        <button
          className="board-tools-heading"
          aria-label={toolsCollapsed ? '展开地图工具' : '折叠地图工具'}
          aria-expanded={!toolsCollapsed}
          aria-controls="map-tools-controls"
          title="拖动标题栏移动，单击折叠或展开"
          onClick={toggleTools}
        >
          <span className="flex items-center gap-1">
            <GripVertical size={15} aria-hidden="true" />
            地图工具
          </span>
          <span className="tiny subtle">
            {toolsCollapsed && `${{ pan: '平移', pen: '画笔', eraser: '擦除', ruler: '量尺' }[tool]} · `}缩放{' '}
            {Math.round(view.scale * 100)}%
          </span>
          {toolsCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {!toolsCollapsed && (
          <div id="map-tools-controls" className="board-tool-controls">
            <div className="flex gap-1 tool-buttons">
              <button className={`btn ${tool === 'pan' ? 'btn-primary' : ''}`} onClick={() => setTool('pan')}>
                平移
              </button>
              <button
                className={`btn ${tool === 'pen' ? 'btn-primary' : ''}`}
                disabled={!canDraw}
                onClick={() => {
                  setTool('pen');
                  open('drawing');
                }}
              >
                画笔
              </button>
              <button
                className={`btn ${tool === 'eraser' ? 'btn-primary' : ''}`}
                disabled={!canDraw}
                onClick={() => setTool('eraser')}
              >
                擦除
              </button>
              <button
                className={`btn ${tool === 'ruler' ? 'btn-primary' : ''}`}
                disabled={!active}
                onClick={() => {
                  setMeasure({ shape: 'LINE', distance: 5 });
                  setTool('ruler');
                }}
              >
                量尺
              </button>
            </div>
            {tool === 'ruler' && measure && (
              <div className="flex gap-2 items-center mt-2">
                <select
                  className="input !w-24 !p-1 tiny"
                  aria-label="量尺形状"
                  value={measure.shape}
                  onChange={(e) => setMeasure({ ...measure, shape: e.target.value })}
                >
                  <option value="LINE">直线</option>
                  <option value="CIRCLE">圆形</option>
                  <option value="SQUARE">方形</option>
                  <option value="CONE">锥形</option>
                </select>
                <input
                  className="input !w-16 !p-1 tiny"
                  aria-label="量尺距离"
                  type="number"
                  min="1"
                  value={measure.distance}
                  onChange={(e) => setMeasure({ ...measure, distance: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="tiny subtle">尺 · 点击地图放置</span>
              </div>
            )}
            {tool === 'eraser' && <p className="tiny subtle mt-2">点击或拖过笔画可整笔擦除，按 Esc 取消本次擦除。</p>}
            <DrawingHistoryControls
              snap={snap}
              userId={me.id}
              mutate={mutate}
              disabled={!!draft || eraser.preview.size > 0}
            />
            {tool === 'pen' && (
              <div className="flex gap-2 items-center mt-2">
                <span className="tiny subtle">笔刷</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="input !w-16 !p-1"
                  title="笔刷大小（0–100）"
                  value={brushSize}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(100, Number(e.target.value)));
                    setBrushSize(value);
                  }}
                />
                {tool === 'pen' && (
                  <input
                    type="color"
                    title="画笔颜色"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-8 h-8"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </MapToolsPanel>
    </div>
  );
}
