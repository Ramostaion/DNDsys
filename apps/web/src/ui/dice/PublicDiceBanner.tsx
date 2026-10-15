import { useEffect, useState } from 'react';
import { diceActor, diceCalculation } from '@dnd/shared';
import { rolledDice } from './dice-geometry';
import type { DiceCue } from './useRoomDice';
import DiceStage from './DiceStage';
import './public-dice.css';

/** A live event only. Never mounted from the saved roll history. */
export default function PublicDiceBanner({ cue }: { cue: DiceCue | null }) {
  return cue ? <DicePerformance key={cue.roll.id} cue={cue} /> : null;
}
function DicePerformance({ cue }: { cue: DiceCue }) {
  const [phase, setPhase] = useState<'rolling' | 'result' | 'fading' | 'hidden'>('rolling');
  useEffect(() => {
    const elapsed =
      Math.max(0, cue.serverNow - new Date(cue.roll.createdAt).getTime()) + performance.now() - cue.receivedAt;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setPhase(
      elapsed >= 4800 ? 'hidden' : elapsed >= 4450 ? 'fading' : media.matches || elapsed >= 1500 ? 'result' : 'rolling',
    );
    const timers = [
      [1500, 'result'],
      [4450, 'fading'],
      [4800, 'hidden'],
    ] as const;
    const scheduled = timers
      .filter(([at]) => at > elapsed)
      .map(([at, next]) => setTimeout(() => setPhase(next), at - elapsed));
    const reduce = () => {
      if (media.matches) setPhase((current) => (current === 'rolling' ? 'result' : current));
    };
    media.addEventListener('change', reduce);
    return () => {
      scheduled.forEach(clearTimeout);
      media.removeEventListener('change', reduce);
    };
  }, [cue]);
  if (phase === 'hidden') return null;
  const dice = rolledDice(cue.roll.details);
  return (
    <aside
      className={`public-dice-banner is-${phase}`}
      data-roll-id={cue.roll.id}
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="公开掷骰演出"
    >
      <div className="public-dice-heading">{diceActor(cue.roll)} 掷出了骰子！</div>
      <div className="public-dice-content">
        <DiceStage roll={cue.roll} expression={cue.roll.expression} pending={false} animated reveal compact />
        <div className="public-dice-text">
          <div>骰子：{cue.roll.expression}</div>
          <div className="public-dice-calculation">
            计算：{diceCalculation(cue.roll.details)}
            {dice.length > 6 && `（共 ${dice.length} 颗，演出展示前 6 颗）`}
          </div>
        </div>
        <div className="public-dice-final">
          <small>{phase === 'rolling' ? '骰子落定中' : '最终结果'}</small>
          <strong>{phase === 'rolling' ? '…' : cue.roll.total}</strong>
        </div>
      </div>
    </aside>
  );
}
