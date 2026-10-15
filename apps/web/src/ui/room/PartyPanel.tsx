import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Copy, Check, Sparkles } from 'lucide-react';
import type { Snapshot } from '../../api';
import { useUI } from '../../store';
import { characterHealth, characterShield } from '../character-summary';
import ResourceBar from '../ResourceBar';
import CharacterHoverCard from '../CharacterHoverCard';

function HeroSummary({ c, snap }: { c: any; snap: Snapshot }) {
  const health = characterHealth(snap, c);
  const shield = characterShield(snap, c);
  return (
    <div className="hero-health-summary space-y-2">
      {shield && <ResourceBar resource={shield} kind="shield" compact />}
      {health ? (
        <ResourceBar resource={health} kind="health" compact />
      ) : (
        <span className="tiny subtle">生命未设置</span>
      )}
    </div>
  );
}

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  online: Set<string>;
  connected: boolean;
  onError: (message: string) => void;
  onStart: () => void;
};
export default function PartyPanel({ snap, me, isGM, online, connected, onError, onStart }: Props) {
  const open = useUI((s) => s.open),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const owned = snap.characters.filter((c) => c.ownerId === me.id);
  const latestRoll = snap.rolls[0];
  const rollerName =
    latestRoll?.rollerName || snap.members.find((m) => m.userId === latestRoll?.userId)?.user.username || '未知冒险者';
  const rollSummary = latestRoll && (
    <button className="last-roll" aria-label="最近掷骰结果" onClick={() => open('dice')}>
      <Sparkles size={16} />
      <span className="last-roll-details">
        <span className="last-roll-player-name truncate" title={rollerName}>
          {rollerName}
        </span>
        <span className="truncate" title={latestRoll.reason || latestRoll.expression}>
          {latestRoll.reason || latestRoll.expression}
        </span>
      </span>
      <strong>{latestRoll.total}</strong>
    </button>
  );

  return (
    <div className="party-stack">
      <div className="party-panel">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">THE PARTY</div>
            <div className="display-title text-lg mt-1">
              同行者 <span className="text-sm text-amber-200/70">{snap.members.length}</span>
            </div>
          </div>
          <div title={connected ? '已连接' : '正在重连'} className={connected ? 'text-emerald-300' : 'text-red-300'}>
            {connected ? <Wifi size={17} /> : <WifiOff size={17} />}
          </div>
        </div>
        <div className="party-list scroll">
          {snap.members.map((m) => (
            <div key={m.userId} className="party-member">
              <span className={`presence ${online.has(m.userId) || m.userId === me.id ? 'online' : ''}`} />
              <span className="truncate flex-1">{m.user.username}</span>
              {m.role === 'GM' && <span className="badge">GM</span>}
            </div>
          ))}
        </div>
        <button
          className="invite-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(snap.room.inviteCode);
              setCopied(true);
            } catch {
              onError('复制邀请码失败');
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
          {copied ? '邀请码已复制' : `邀请码 · ${snap.room.inviteCode}`}
        </button>
        {isGM && snap.room.status !== 'ACTIVE' && (
          <button className="btn btn-primary w-full mt-3 text-sm" onClick={() => onStart()}>
            开启冒险
          </button>
        )}
      </div>
      {isGM && rollSummary}
      {owned.length > 0 && (
        <div className="hero-tray">
          {owned.map((c) => (
            <div key={c.id} className="hero-chip-wrap">
              <button className="hero-chip" onClick={() => open('character', c.id)}>
                <div className="hero-initial">
                  {c.avatarUrl ? <img src={c.avatarUrl} alt="" /> : c.name.slice(0, 1)}
                </div>
                <div className="text-left min-w-0">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <HeroSummary c={c} snap={snap} />
                </div>
              </button>
              <div role="tooltip" aria-label="角色概览" className="hero-hover-card surface scroll">
                <CharacterHoverCard snap={snap} character={c} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!isGM && rollSummary}
    </div>
  );
}
