import { useEffect, useState } from 'react';
import type { CombatCue } from './useCombatBroadcast';
import { agilityContestBase } from '@dnd/shared';

export default function CombatResultBanner({ cue }: { cue: CombatCue | null }) {
  return cue ? <CombatNotice key={cue.recordId} cue={cue} /> : null;
}
const ageOf = (cue: CombatCue) =>
  Math.max(0, cue.serverNow - new Date(cue.createdAt).getTime()) + performance.now() - cue.receivedAt;
const phaseAt = (elapsed: number) => (elapsed >= 6000 ? 'hidden' : elapsed >= 5650 ? 'fading' : 'visible');
function CombatNotice({ cue }: { cue: CombatCue }) {
  const [phase, setPhase] = useState(() => phaseAt(ageOf(cue)));
  useEffect(() => {
    const elapsed = ageOf(cue);
    setPhase(phaseAt(elapsed));
    const scheduled = (
      [
        [5650, 'fading'],
        [6000, 'hidden'],
      ] as const
    )
      .filter(([at]) => at > elapsed)
      .map(([at, next]) => setTimeout(() => setPhase(next), at - elapsed));
    return () => scheduled.forEach(clearTimeout);
  }, [cue]);
  return phase !== 'hidden' ? (
    <aside
      className={`combat-result-banner ${cue.hit ? 'is-hit' : 'is-dodge'} is-${phase}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="战斗结果广播"
      data-record-id={cue.recordId}
      data-phase={phase}
    >
      <small>{cue.hit ? '攻击命中' : '成功闪避'}</small>
      <strong>{cue.message}</strong>
      <span>
        {cue.version === 4 && 'MAX(1, '}
        {agilityContestBase(cue.attacker, cue.version)} + D20({cue.attacker.d20}){cue.version === 4 && ')'} ={' '}
        {cue.attacker.total}　{cue.hit ? '>' : cue.attacker.total === cue.defender.total ? '=' : '<'}　
        {cue.version === 4 && 'MAX(1, '}
        {agilityContestBase(cue.defender, cue.version)} + D20(
        {cue.defender.d20}){cue.version === 4 && ')'} = {cue.defender.total}
      </span>
    </aside>
  ) : null;
}
