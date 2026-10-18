import { useEffect, useRef, useState } from 'react';
import { diceActor } from '@dnd/shared';
import PublicDiceBanner from './dice/PublicDiceBanner';
import CombatResultBanner from './combat/CombatResultBanner';
import type { DiceCue } from './dice/useRoomDice';
import type { CombatCue } from './combat/useCombatBroadcast';
import { broadcastId, broadcastRemaining, recentBroadcasts, type RecentBroadcast } from './broadcast-layout';
import './room-broadcasts.css';

/** Layout only: original event clocks, visibility, deduplication and expiration remain authoritative. */
export default function RoomBroadcasts({
  roomId,
  dice,
  combat,
  hasTurn,
}: {
  roomId: string;
  dice: DiceCue | null;
  combat: CombatCue | null;
  hasTurn: boolean;
}) {
  const previous = useRef<{ dice: DiceCue | null; combat: CombatCue | null }>({ dice: null, combat: null });
  const [recent, setRecent] = useState<RecentBroadcast[]>([]);
  useEffect(() => {
    const older: RecentBroadcast[] = [];
    if (dice && previous.current.dice && dice.roll.id !== previous.current.dice.roll.id)
      older.push({ kind: 'dice', cue: previous.current.dice });
    if (combat && previous.current.combat && combat.recordId !== previous.current.combat.recordId)
      older.push({ kind: 'combat', cue: previous.current.combat });
    previous.current = { dice, combat };
    if (older.length) setRecent((items) => recentBroadcasts([...items, ...older], roomId, performance.now()));
  }, [roomId, dice, combat]);
  useEffect(() => {
    if (!recent.length) return;
    const delay = Math.min(...recent.map((item) => broadcastRemaining(item, performance.now())));
    const timer = setTimeout(
      () => setRecent((items) => recentBroadcasts(items, roomId, performance.now())),
      delay + 10,
    );
    return () => clearTimeout(timer);
  }, [recent, roomId]);
  return (
    <div className="room-broadcasts" data-has-turn={hasTurn}>
      <PublicDiceBanner cue={dice?.roomId === roomId ? dice : null} />
      <CombatResultBanner cue={combat?.roomId === roomId ? combat : null} />
      {recent.length > 0 && (
        <div className="broadcast-recent" aria-label="刚才的公开广播">
          {recent.map((item) => (
            <div
              key={broadcastId(item)}
              className={`broadcast-summary is-${item.kind}`}
              data-event-id={broadcastId(item)}
            >
              <span>{item.kind === 'dice' ? '掷骰' : item.cue.hit ? '命中' : '闪避'}</span>
              <strong
                title={
                  item.kind === 'dice' ? `${diceActor(item.cue.roll)} · ${item.cue.roll.expression}` : item.cue.message
                }
              >
                {item.kind === 'dice' ? `${diceActor(item.cue.roll)} · ${item.cue.roll.expression}` : item.cue.message}
              </strong>
              {item.kind === 'dice' && <b>{item.cue.roll.total}</b>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
