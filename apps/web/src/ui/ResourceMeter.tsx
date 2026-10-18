import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const LiveResources = createContext(true);

/** The first authoritative snapshot after joining/reconnecting establishes a quiet baseline. */
export function ResourceFeedbackScope({
  connected,
  updatedAt,
  children,
}: {
  connected: boolean;
  updatedAt: number;
  children: ReactNode;
}) {
  const gate = useRef({ connected, updatedAt, ready: false });
  if (!connected || gate.current.connected !== connected) gate.current = { connected, updatedAt, ready: false };
  else if (updatedAt > gate.current.updatedAt) gate.current.ready = true;
  return <LiveResources.Provider value={connected && gate.current.ready}>{children}</LiveResources.Provider>;
}

export function resourceChange(
  before: { identity: string; value: number; maximum: number; live: boolean },
  after: typeof before,
) {
  if (
    !before.live ||
    !after.live ||
    before.identity !== after.identity ||
    before.maximum !== after.maximum ||
    !Number.isFinite(before.value) ||
    !Number.isFinite(after.value)
  )
    return 0;
  return after.value - before.value;
}

export default function ResourceMeter({
  value,
  maximum,
  identity,
  kind = 'health',
  label,
  showMaximum = true,
}: {
  value: number;
  maximum: number;
  identity: string;
  kind?: 'health' | 'shield';
  label?: string;
  showMaximum?: boolean;
}) {
  const live = useContext(LiveResources);
  const percent = maximum > 0 ? Math.max(0, Math.min(100, (value / maximum) * 100)) : 0;
  const previous = useRef({ identity, value, maximum, live, percent });
  const [change, setChange] = useState<{ delta: number; from: number; id: number } | null>(null);
  useEffect(() => {
    const next = { identity, value, maximum, live, percent },
      delta = resourceChange(previous.current, next);
    const from = previous.current.percent;
    previous.current = next;
    setChange(delta ? { delta, from, id: Date.now() } : null);
    if (!delta) return;
    const timer = setTimeout(() => setChange(null), 1200);
    return () => clearTimeout(timer);
  }, [identity, value, maximum, live, percent]);
  const visible = live && change;
  return (
    <div className={`resource-meter resource-${kind}`}>
      <div
        className={`sheet-progress ${kind === 'shield' ? 'shield' : ''}`}
        role="progressbar"
        aria-label={label || `${kind === 'shield' ? '护盾' : '生命'}条`}
        aria-valuemin={0}
        aria-valuemax={showMaximum ? Math.max(0, maximum) : 100}
        aria-valuenow={showMaximum ? value : percent}
        aria-valuetext={showMaximum ? `${value} / ${maximum}` : String(value)}
      >
        {visible && visible.delta < 0 && (
          <div key={visible.id} className="resource-trail" style={{ width: `${visible.from}%` }} />
        )}
        <div className="resource-fill" style={{ width: `${percent}%` }} />
      </div>
      <span
        className={`resource-delta ${visible ? (visible.delta > 0 ? 'is-gain' : 'is-loss') : ''}`}
        aria-live="off"
        aria-hidden="true"
      >
        {visible && (
          <span key={visible.id}>
            {visible.delta > 0 ? '+' : '−'}
            {Number(Math.abs(visible.delta).toFixed(2))}
          </span>
        )}
      </span>
    </div>
  );
}
