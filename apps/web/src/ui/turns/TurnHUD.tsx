import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Check, ChevronRight, Hourglass, Settings2 } from 'lucide-react';
import { stateDisplayName } from '@dnd/shared';
import type { TurnSessionView, TurnTransition, CharacterTag } from '@dnd/shared';
import { useUI } from '../../store';
import { TagIcon } from '../character-tags/TagIcon';
import { TurnPortrait } from './TurnManager';
import { useTurnAction } from './useTurnAction';
import './turns.css';
import { useHoverPreview } from '../HoverCard';
import { StateHoverCard } from '../character-tags/StateDetailsContent';

export function TurnCounter({ session }: { session?: TurnSessionView | null }) {
  const open = useUI((s) => s.open);
  if (!session) return null;
  return (
    <div className="turn-counter" aria-label="回合计数器">
      <Hourglass size={17} />
      <div>
        <strong key={`${session.id}:${session.round}`}>
          第 {session.round}
          {session.totalRounds ? ` / ${session.totalRounds}` : ''} 轮
        </strong>
        <p>
          {session.status === 'LIMIT'
            ? '已达预计轮数 · 等待 GM'
            : session.status === 'PAUSED'
              ? '回合已暂停'
              : session.totalRounds
                ? `剩余 ${Math.max(0, session.totalRounds - session.round)} 轮`
                : '不限轮数'}
        </p>
      </div>
      <button
        className="turn-counter-info"
        title="查看当前回合人物"
        onClick={() => {
          const id = session.currentCharacterId;
          if (id) open('character', id);
        }}
      >
        ✦
      </button>
    </div>
  );
}

export default function TurnHUD({
  session,
  isGM,
  connected,
  mutate,
  visibleCharacters,
  visibleMaps,
  visibleStates,
}: {
  session?: TurnSessionView | null;
  isGM: boolean;
  connected: boolean;
  visibleCharacters: { id: string }[];
  visibleMaps: { id: string }[];
  visibleStates: CharacterTag[];
  mutate: (type: string, payload: Record<string, unknown>, id?: string) => Promise<any>;
}) {
  const previousSession = useRef(session ?? null),
    [departing, setDeparting] = useState<TurnSessionView | null>(null);
  useLayoutEffect(() => {
    const previous = previousSession.current;
    previousSession.current = session ?? null;
    setDeparting(null);
    if (session || !previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setDeparting(previous);
    const timer = setTimeout(() => setDeparting(null), 240);
    return () => clearTimeout(timer);
  }, [session]);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(expiryTimer.current), []);
  const open = useUI((s) => s.open),
    list = useRef<HTMLDivElement>(null),
    positions = useRef<{ id: string; version: number; offsets: Map<string, number> } | null>(null),
    motions = useRef<Animation[]>([]),
    baseline = useRef<{ id: string; version: number } | null>(null),
    skipNext = useRef(false),
    wasConnected = useRef(connected),
    [effect, setEffect] = useState<TurnTransition | null>(null),
    { run, busy, error } = useTurnAction(mutate);
  useLayoutEffect(() => {
    motions.current.forEach((animation) => animation.cancel());
    motions.current = [];
    if (!session || !list.current || !connected) {
      positions.current = null;
      return;
    }
    const previous = positions.current,
      nodes = [...list.current.querySelectorAll<HTMLElement>('[data-actor-id]')],
      offsets = new Map(nodes.map((node) => [node.dataset.actorId!, node.offsetLeft]));
    positions.current = { id: session.id, version: session.version, offsets };
    if (
      !previous ||
      previous.id !== session.id ||
      previous.version >= session.version ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    for (const node of nodes) {
      const before = previous.offsets.get(node.dataset.actorId!);
      if (before === undefined || before === node.offsetLeft) continue;
      motions.current.push(
        node.animate([{ transform: `translateX(${before - node.offsetLeft}px)` }, { transform: 'translateX(0)' }], {
          duration: 260,
          easing: 'cubic-bezier(.2,.75,.25,1)',
        }),
      );
    }
    return () => motions.current.forEach((animation) => animation.cancel());
  }, [session, connected]);
  useEffect(() => {
    if (!connected) {
      baseline.current = null;
      skipNext.current = true;
      wasConnected.current = false;
      setEffect(null);
      return;
    }
    if (!session) {
      baseline.current = null;
      setEffect(null);
      return;
    }
    const previous = baseline.current;
    baseline.current = { id: session.id, version: session.version };
    if (!wasConnected.current) {
      wasConnected.current = true;
      return;
    }
    if (!previous || previous.id !== session.id || previous.version >= session.version) return;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (session.transition?.version === session.version) {
      setEffect(session.transition);
      clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => setEffect(null), 480);
    }
  }, [session, connected]);
  useEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('[data-current="true"]');
    if (!current || !list.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = current.offsetLeft - (list.current.clientWidth - current.clientWidth) / 2;
    list.current.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'instant' : 'smooth' });
  }, [session?.currentCharacterId, session?.id]);
  if (!session) {
    // A permission withdrawal must never retain a now-hidden character or map.
    const safeToFade =
      departing?.mapId &&
      visibleMaps.some((map) => map.id === departing.mapId) &&
      departing.participants.every((p) => visibleCharacters.some((c) => c.id === p.characterId));
    return departing && safeToFade ? (
      <TurnOrderCard
        session={departing}
        isGM={false}
        connected={false}
        activeEffect={null}
        listRef={list}
        visibleStates={[]}
        leaving
      />
    ) : null;
  }
  const current = session.participants.find((row) => row.characterId === session.currentCharacterId),
    activeEffect = effect?.operationId === session.transition?.operationId ? effect : null,
    atLimit = session.status === 'LIMIT';
  return (
    <>
      <TurnOrderCard
        session={session}
        isGM={isGM}
        connected={connected}
        activeEffect={activeEffect}
        listRef={list}
        visibleStates={visibleStates}
      />
      <div className="turn-end-control">
        {error && <p role="alert">{error}</p>}
        {isGM && atLimit && (
          <button className="turn-limit-extend" onClick={() => open('turn-system')}>
            延长轮数
          </button>
        )}
        {isGM ? (
          <button
            className="turn-end-button"
            aria-label={atLimit ? '结束回合模式' : '结束回合'}
            disabled={busy || !connected || (!atLimit && (session.status !== 'ACTIVE' || !current))}
            onClick={() => {
              if (atLimit && !confirm('结束整个回合模式？尚未到期的角色状态与剩余回合将保留。')) return;
              void run(atLimit ? 'turn.end' : 'turn.advance', { sessionId: session.id, version: session.version });
            }}
          >
            <span className="turn-end-icon">{atLimit ? <Check size={27} /> : <ChevronRight size={29} />}</span>
            <span>
              <strong>{busy ? (atLimit ? '结束中…' : '推进中…') : atLimit ? '结束回合模式' : '结束回合'}</strong>
              <small>
                {session.status === 'PAUSED'
                  ? '已暂停'
                  : session.status === 'LIMIT'
                    ? '预计轮数已完成'
                    : current?.name || '等待行动'}
              </small>
            </span>
          </button>
        ) : (
          <div className="turn-readonly">
            <Hourglass size={15} />
            <span>
              {session.status === 'PAUSED'
                ? '回合已暂停'
                : session.status === 'LIMIT'
                  ? '等待 GM 延长或结束'
                  : current
                    ? `${current.name} 正在行动`
                    : '等待其他行动完成'}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function TurnOrderCard({
  session,
  isGM,
  connected,
  activeEffect,
  listRef,
  leaving = false,
  visibleStates,
}: {
  session: TurnSessionView;
  isGM: boolean;
  connected: boolean;
  activeEffect: TurnTransition | null;
  listRef: RefObject<HTMLDivElement | null>;
  leaving?: boolean;
  visibleStates: CharacterTag[];
}) {
  const open = useUI((s) => s.open);
  const hover = useHoverPreview();
  const preview = leaving
    ? undefined
    : visibleStates.find(
        (tag) =>
          tag.id === hover.preview?.id &&
          session.participants.some((p) => p.states.some((state) => state.id === tag.id)),
      );
  return (
    <>
      <div
        className={`turn-hud ${leaving ? 'is-leaving' : ''}`}
        aria-hidden={leaving || undefined}
        inert={leaving}
        role="region"
        aria-label="回合顺序"
        data-round={session.round}
        data-version={session.version}
        data-status={session.status}
        style={{ '--turn-count': Math.max(2, session.participants.length) } as CSSProperties}
      >
        <header>
          <div className="turn-hud-heading">
            <div className="turn-hud-title-row">
              <h2 className="eyebrow">行动顺序</h2>
              {(session.status !== 'ACTIVE' || !session.currentCharacterId) && (
                <span className="turn-hud-session-status">
                  {session.status === 'PAUSED' ? '已暂停' : session.status === 'LIMIT' ? '本轮已完成' : '等待行动'}
                </span>
              )}
            </div>
            <p className="turn-hud-subtitle tiny subtle" title={`${session.mapName} · 第 ${session.round} 轮`}>
              <span className="turn-hud-map">{session.mapName}</span>
              <span aria-hidden="true">·</span>
              <span className="turn-hud-round">第 {session.round} 轮</span>
            </p>
          </div>
          {isGM && (
            <button
              className="turn-hud-settings"
              title="打开回合系统"
              aria-label="打开回合系统"
              onClick={() => open('turn-system')}
            >
              <Settings2 size={15} strokeWidth={1.5} />
            </button>
          )}
        </header>
        <div className="turn-hud-list" ref={listRef}>
          {session.participants.map((row, i) => {
            const changes =
                activeEffect?.changed.filter(
                  (change) =>
                    change.characterId === row.characterId &&
                    session.transition?.changed.some((allowed) => allowed.id === change.id),
                ) || [],
              expired = changes.filter((change) => change.after === 0),
              finite = row.states.filter((state) => state.remainingTurns != null),
              isCurrent = row.characterId === session.currentCharacterId,
              hasActed = row.lastActedRound >= session.round;
            return (
              <div
                className={`turn-hud-person ${row.lastActedRound >= session.round ? 'has-acted' : ''} ${row.firstRound > session.round ? 'next-round' : ''}`}
                key={row.characterId}
                data-actor-id={row.characterId}
                data-current={row.characterId === session.currentCharacterId}
                data-state={
                  isCurrent ? 'current' : row.firstRound > session.round ? 'next-round' : hasActed ? 'acted' : 'pending'
                }
                data-testid={`turn-hud-${row.characterId}`}
                style={{ '--turn-index': i } as CSSProperties}
              >
                <span className="turn-order-number" aria-label={`第 ${i + 1} 位${hasActed ? '，已行动' : ''}`}>
                  {hasActed && <Check size={10} strokeWidth={1.8} aria-hidden="true" />}
                  {i + 1}
                </span>
                <button
                  className="turn-hud-avatar"
                  title={`${row.name} · ${row.firstRound > session.round ? '下轮参与' : row.lastActedRound >= session.round ? '本轮已行动' : row.characterId === session.currentCharacterId ? '正在行动' : '等待行动'}${isGM ? ` · 先手 ${row.score}` : ''}`}
                  aria-label={`查看人物 ${row.name}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => open('character', row.characterId)}
                >
                  <TurnPortrait name={row.name} avatarUrl={row.avatarUrl} />
                </button>
                <span className="turn-hud-name" title={row.name}>
                  {row.name}
                </span>
                <div className="turn-hud-states">
                  {finite.map((state) => (
                    <button
                      className={`turn-state ${changes.some((change) => change.id === state.id) ? 'just-changed' : ''}`}
                      key={`${state.id}:${state.remainingTurns}`}
                      style={{ color: state.color }}
                      aria-label={`${row.name}：${stateDisplayName(state.name, state.romanNumeral)} 剩余 ${state.remainingTurns} 回合`}
                      onPointerEnter={(e) => !leaving && hover.show(state.id, e.currentTarget)}
                      onPointerLeave={hover.leave}
                      onFocus={(e) => !leaving && hover.show(state.id, e.currentTarget)}
                      onBlur={hover.leave}
                      onClick={() => {
                        hover.close();
                        open('tag-detail', state.id);
                      }}
                    >
                      <TagIcon icon={state.icon} size={14} />
                      <span>{state.remainingTurns}</span>
                    </button>
                  ))}
                  {expired.map((state) => (
                    <span
                      key={state.id}
                      className="turn-state is-expiring"
                      style={{ color: state.color }}
                      title={`${stateDisplayName(state.name, state.romanNumeral)}已结束`}
                    >
                      <TagIcon icon={state.icon} size={14} />
                      <span>0</span>
                    </span>
                  ))}
                </div>
                <span className="turn-current-mark" aria-hidden="true" />
              </div>
            );
          })}
        </div>
        <TurnRoundProgress session={session} connected={connected && !leaving} />
      </div>
      <StateHoverCard
        hover={hover}
        tag={preview}
        characterName={session.participants.find((p) => p.characterId === preview?.characterId)?.name}
      />
    </>
  );
}

function TurnRoundProgress({ session, connected }: { session: TurnSessionView; connected: boolean }) {
  const eligible = session.participants.filter((row) => row.firstRound <= session.round),
    acted = eligible.filter((row) => row.lastActedRound >= session.round).length;
  const baseline = useRef<{
      id: string;
      version: number;
      round: number;
      status: string;
      ids: string[];
      acted: number;
    } | null>(null),
    everConnected = useRef(false),
    skipRecovery = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    [complete, setComplete] = useState<{ key: string; round: number; ids: string[]; from: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const previous = baseline.current;
    if (!connected) {
      skipRecovery.current = everConnected.current;
      baseline.current = null;
      clearTimeout(timer.current);
      setComplete(null);
      return;
    }
    everConnected.current = true;
    const ids = session.participants.filter((row) => row.firstRound <= session.round).map((row) => row.characterId);
    baseline.current = {
      id: session.id,
      version: session.version,
      round: session.round,
      status: session.status,
      ids,
      acted: session.participants.filter(
        (row) => row.firstRound <= session.round && row.lastActedRound >= session.round,
      ).length,
    };
    if (!previous || previous.id !== session.id) {
      clearTimeout(timer.current);
      setComplete(null);
      return;
    }
    if (session.version <= previous.version) return;
    clearTimeout(timer.current);
    setComplete(null);
    if (skipRecovery.current) {
      skipRecovery.current = false;
      return;
    }
    if (
      session.round !== previous.round + 1 ||
      previous.status !== 'ACTIVE' ||
      !previous.ids.length ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !previous.ids.every((id) => ids.includes(id))
    )
      return;
    // Only the bar celebrates the confirmed old round; queue/counter already show the new one.
    setComplete({
      key: `${session.id}:${session.version}`,
      round: previous.round,
      ids: previous.ids,
      from: (previous.acted / previous.ids.length) * 100,
    });
    timer.current = setTimeout(() => setComplete(null), 420);
  }, [session, connected]);
  const flash =
      connected && complete?.ids.every((id) => eligible.some((row) => row.characterId === id)) ? complete : null,
    total = flash ? flash.ids.length : eligible.length,
    done = flash ? total : acted;
  return (
    <footer className="turn-hud-footer">
      <span>
        {flash
          ? `第 ${flash.round} 轮完成`
          : total
            ? `已行动 ${done} / ${total}`
            : session.participants.length
              ? '等待下轮参与'
              : '暂无可见人物'}
      </span>
      <div
        className="turn-hud-progress"
        role="progressbar"
        aria-label="可见人物本轮行动进度"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, total)}
        aria-valuenow={done}
        data-phase={flash ? 'complete' : 'normal'}
      >
        <span
          key={flash?.key ?? `round:${session.id}:${session.round}`}
          className={flash ? 'is-round-complete' : ''}
          style={
            {
              width: `${total ? (done / total) * 100 : 0}%`,
              '--progress-from': `${flash?.from ?? 0}%`,
            } as CSSProperties
          }
        />
      </div>
      <span className="turn-hud-order-label">
        先手顺序 <ChevronRight size={10} />
      </span>
    </footer>
  );
}
