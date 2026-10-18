import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, Swords } from 'lucide-react';
import type { CombatDraftSide, CombatDraftView } from '@dnd/shared';
import { request } from '../../api';
import { localCombatDrafts } from './useCombatDraft';
import './combat-drafts.css';

type Card = CombatDraftView & { animate: boolean; leaving?: boolean; receivedAt: number };
export default function CombatDraftPerformances({
  roomId,
  userId,
  connected,
}: {
  roomId: string;
  userId: string;
  connected: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]),
    hidden = localCombatDrafts((s) => s.hidden);
  const seen = useRef(new Set<string>()),
    baseline = useRef(true),
    generation = useRef(0),
    inFlight = useRef<AbortController | null>(null),
    queued = useRef(false),
    recoverQueued = useRef(false);
  const refresh = useCallback(
    async (recover = false): Promise<void> => {
      if (!connected) return;
      const sequence = ++generation.current;
      if (inFlight.current) {
        queued.current = true;
        recoverQueued.current ||= recover;
        return;
      }
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const result = await request<{ drafts: CombatDraftView[] }>(`/rooms/${roomId}/combat-drafts`, {
          signal: controller.signal,
        });
        if (sequence !== generation.current) return;
        const silent = recover || baseline.current;
        baseline.current = false;
        const next = result.drafts.map((draft) => {
          const animate = !silent && !seen.current.has(draft.eventId);
          seen.current.add(draft.eventId);
          return { ...draft, animate, receivedAt: performance.now() };
        });
        setCards((old) => [
          ...next.map((c) => ({ ...c, animate: old.find((o) => o.eventId === c.eventId)?.animate ?? c.animate })),
          ...old.filter((c) => !next.some((n) => n.id === c.id)).map((c) => ({ ...c, leaving: true })),
        ]);
      } catch (error) {
        if (sequence === generation.current && [401, 403, 404].includes((error as any).status)) {
          setCards([]);
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          if (queued.current) {
            const recovery = recoverQueued.current;
            queued.current = false;
            recoverQueued.current = false;
            void refresh(recovery);
          }
        }
      }
    },
    [roomId, connected],
  );
  useEffect(() => {
    baseline.current = true;
    seen.current.clear();
    setCards([]);
    ++generation.current;
    void refresh(true);
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.roomId === roomId) void refresh(detail.recover);
    };
    window.addEventListener('dnd:combat-drafts', changed);
    const poll = setInterval(() => void refresh(), 15_000);
    return () => {
      ++generation.current;
      inFlight.current?.abort();
      inFlight.current = null;
      queued.current = false;
      recoverQueued.current = false;
      clearInterval(poll);
      window.removeEventListener('dnd:combat-drafts', changed);
    };
  }, [roomId, userId, connected, refresh]);
  useEffect(() => {
    if (!cards.length) return;
    const timeout = cards.some((c) => c.leaving)
      ? setTimeout(
          () =>
            setCards((old) =>
              old.filter((c) => !c.leaving && c.serverNow + performance.now() - c.receivedAt < Date.parse(c.expiresAt)),
            ),
          250,
        )
      : undefined;
    const active = cards.filter((c) => !c.leaving);
    const expiry = active.length
      ? setTimeout(
          () =>
            setCards((old) =>
              old.map((c) =>
                c.serverNow + performance.now() - c.receivedAt >= Date.parse(c.expiresAt) ? { ...c, leaving: true } : c,
              ),
            ),
          Math.max(
            0,
            Math.min(...active.map((c) => Date.parse(c.expiresAt) - c.serverNow - (performance.now() - c.receivedAt))),
          ) + 5,
        )
      : undefined;
    return () => {
      clearTimeout(timeout);
      clearTimeout(expiry);
    };
  }, [cards]);
  return (
    <div className="combat-draft-stage" data-multiple={cards.length > 1} aria-label="主视窗临时敏捷对抗">
      {cards.map((card) => (
        <DraftCard
          key={card.eventId}
          card={card}
          leaving={Boolean(card.leaving || (hidden.has(card.id) && hidden.get(card.id) !== card.eventId))}
        />
      ))}
    </div>
  );
}
function DraftCard({ card, leaving }: { card: Card; leaving: boolean }) {
  const [settled, setSettled] = useState(
    () => !card.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (!card.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setTimeout(() => setSettled(true), 1200);
    return () => clearTimeout(timer);
  }, [card.animate]);
  if (!card.contest) return null;
  return (
    <aside
      className={`combat-draft-card ${settled ? 'is-settled' : 'is-rolling'} ${leaving ? 'is-leaving' : ''} ${card.animate && !settled ? 'has-entry' : ''}`}
      data-draft-id={card.id}
      data-event-id={card.eventId}
      data-revision={card.revision}
      data-phase={leaving ? 'leaving' : settled ? 'settled' : 'rolling'}
      aria-label="临时敏捷对抗"
      role="status"
      aria-live={settled && !leaving ? 'polite' : 'off'}
    >
      <div className="draft-heading">
        ✦{' '}
        {card.contest.attacker.attributeName && card.contest.attacker.attributeName !== '敏捷'
          ? `${card.contest.attacker.attributeName} · 敏捷对抗`
          : '敏捷对抗'}{' '}
        ✦ <small>D20</small>
      </div>
      <div className="draft-versus">
        <Side side={card.contest.attacker} attacker winner={settled && card.contest.hit} />
        <div className="draft-center">
          <b>VS</b>
          <span className="draft-result">{settled ? (card.contest.hit ? '攻击有效' : '攻击无效') : '判定中'}</span>
        </div>
        <Side side={card.contest.defender} winner={false} />
      </div>
      <div className="draft-filigree" aria-hidden="true" />
      <footer>{settled ? '已完成属性判定 · 等待保存记录' : '服务器判定已就绪'}</footer>
      <i className="draft-spark spark-one" aria-hidden="true">
        ✦
      </i>
      <i className="draft-spark spark-two" aria-hidden="true">
        ·
      </i>
    </aside>
  );
}
function Side({ side, attacker, winner }: { side: CombatDraftSide; attacker?: boolean; winner: boolean }) {
  return (
    <div className={`draft-side ${attacker ? 'is-attacker' : 'is-defender'} ${winner ? 'is-effective' : ''}`}>
      <div className="draft-avatar">
        {side.avatarUrl ? <img src={side.avatarUrl} alt="" /> : attacker ? <Swords size={25} /> : <Shield size={25} />}
      </div>
      <strong title={side.name}>{side.name}</strong>
      <div className="draft-total">{side.total}</div>
      <div className="draft-operands">
        <span className="draft-d20" aria-label={`D20 ${side.d20}`}>
          <span className="draft-reel" aria-hidden="true">
            {[3, 17, 8, 20, 11, 6, 14, 2, 19, 9, 16, 4].map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </span>
          <b>{side.d20}</b>
        </span>
        <span className="draft-bonus">
          {' '}
          {side.bonus < 0 ? '−' : '+'} {Math.abs(side.bonus)} {side.attributeName || '敏捷'}
        </span>
      </div>
    </div>
  );
}
