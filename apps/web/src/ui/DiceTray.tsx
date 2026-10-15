import { useEffect, useRef, useState } from 'react';
import { Dices, Lock, Globe2, Sparkles } from 'lucide-react';
import type { Snapshot } from '../api';
import { canEditCharacter } from '../permissions';
import DiceStage, { type VisibleRoll } from './dice/DiceStage';
import { diceActor, diceCalculation } from '@dnd/shared';
import { useDiceCountdown } from './dice/useRoomDice';
import { createId } from '../id';

type Props = {
  snap: Snapshot;
  me: any;
  mutate: (type: string, payload: Record<string, unknown>, operationId?: string) => Promise<any>;
};
const dice = [4, 6, 8, 10, 12, 20, 100];
const reasonOptions = {
  战斗: ['命中', '闪避'],
  鉴定: [
    '力量',
    '敏捷',
    '智力',
    '体质',
    '感知',
    '魅力',
    '特技',
    '驯兽',
    '奥秘',
    '运动',
    '欺瞒',
    '历史',
    '洞悉',
    '威吓',
    '调查',
    '医药',
    '自然',
    '察觉',
    '表演',
    '游说',
    '宗教',
    '巧手',
    '隐匿',
    '求生',
  ],
};

export default function DiceTray({ snap, me, mutate }: Props) {
  const { remainingMs, updateClock } = useDiceCountdown();
  const retryRequest = useRef<{ id: string; payload: Record<string, unknown> } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [expression, setExpression] = useState('1d20');
  const [reason, setReason] = useState('');
  const [selectedReason, setSelectedReason] = useState<{ category: keyof typeof reasonOptions; value: string } | null>(
    null,
  );
  const [characterId, setCharacterId] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [last, setLast] = useState<VisibleRoll | null>(snap.rolls[0] || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [animated, setAnimated] = useState(() => {
    try {
      return localStorage.getItem('dnd:dice-animation') !== 'off';
    } catch {
      return true;
    }
  });
  const [revealedId, setRevealedId] = useState<string | null>(null),
    [rollingExpression, setRollingExpression] = useState('1d20');
  const stageRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef(snap.rolls[0]?.id),
    inFlight = useRef(false);
  const [count, setCount] = useState('1'),
    [sides, setSides] = useState('37'),
    [modifier, setModifier] = useState('0');
  const isGM = snap.members.find((m) => m.userId === me.id)?.role === 'GM';
  const characters = snap.characters.filter((c) => canEditCharacter(snap, me.id, c));
  const latest = snap.rolls[0] as VisibleRoll | undefined;
  useEffect(() => {
    if (!latest || latest.id === lastSeen.current) return;
    lastSeen.current = latest.id;
    if (inFlight.current) return;
    setLast(latest);
    setRevealedId(latest.id);
  }, [latest]);
  function toggleMotion(enabled: boolean) {
    setAnimated(enabled);
    try {
      localStorage.setItem('dnd:dice-animation', enabled ? 'on' : 'off');
    } catch {
      /* Browser storage is optional. */
    }
  }
  async function roll() {
    if (inFlight.current || (!retryRequest.current && visibility === 'PUBLIC' && remainingMs > 0)) return;
    const pending = retryRequest.current || {
      id: createId(),
      payload: {
        expression,
        reason: selectedReason ? `${selectedReason.category} · ${selectedReason.value}` : reason,
        characterId: characterId || undefined,
        visibility,
      },
    };
    inFlight.current = true;
    setBusy(true);
    setError('');
    setRevealedId(null);
    setRollingExpression(String(pending.payload.expression));
    stageRef.current?.scrollIntoView({ block: 'nearest' });
    try {
      const result: VisibleRoll = await mutate('dice.roll', pending.payload, pending.id);
      retryRequest.current = null;
      setRetrying(false);
      lastSeen.current = result.id;
      setLast(result);
      setRevealedId(result.id);
    } catch (e) {
      const cause = e as Error & { status?: number; code?: string; serverNow?: number; cooldownUntil?: number };
      if (cause.code === 'DICE_COOLDOWN' && cause.serverNow !== undefined && cause.cooldownUntil !== undefined)
        updateClock({ serverNow: cause.serverNow, cooldownUntil: cause.cooldownUntil });
      retryRequest.current = !cause.status || cause.status >= 500 ? pending : null;
      setRetrying(Boolean(retryRequest.current));
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="dice-tray space-y-5">
      <div className="text-center">
        <div className="eyebrow">THE DICE DECIDE</div>
        <h2 className="display-title text-2xl">命运之骰</h2>
        <p className="tiny subtle mt-1">所有骰子由服务器掷出；公开结果同步全房间，私密结果只给掷骰者和 GM。</p>
      </div>
      <div className="dice-presets">
        {dice.map((sides) => (
          <button
            key={sides}
            className={expression === `1d${sides}` ? 'selected' : ''}
            onClick={() => setExpression(`1d${sides}`)}
          >
            <span className="dice-icon">{sides}</span>
            <span>D{sides}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className="label">数量</span>
          <input
            className="input"
            type="number"
            min="1"
            max="100"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <label>
          <span className="label">面数</span>
          <input
            className="input"
            type="number"
            min="2"
            max="1000"
            value={sides}
            onChange={(e) => setSides(e.target.value)}
          />
        </label>
        <label>
          <span className="label">修正</span>
          <input className="input" type="number" value={modifier} onChange={(e) => setModifier(e.target.value)} />
        </label>
        <button
          className="btn col-span-3"
          onClick={() => setExpression(`${count}d${sides}${Number(modifier) >= 0 ? `+${modifier}` : modifier}`)}
        >
          生成表达式
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2">
          <span className="label">掷骰表达式</span>
          <input
            className="input dice-expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="例：2d6+3"
          />
        </label>
        <label>
          <span className="label">关联角色</span>
          <select className="input" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            <option value="">不关联</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">可见范围</span>
          <select
            className="input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'PRIVATE')}
          >
            <option value="PUBLIC">房间公开</option>
            <option value="PRIVATE">{isGM ? '仅 GM 可见' : '仅自己与 GM'}</option>
          </select>
        </label>
        {(Object.keys(reasonOptions) as (keyof typeof reasonOptions)[]).map((category) => (
          <label key={category}>
            <span className="label">{category}大类</span>
            <select
              className="input"
              aria-label={`${category}大类`}
              value={selectedReason?.category === category ? selectedReason.value : ''}
              disabled={selectedReason !== null && selectedReason.category !== category}
              onChange={(event) =>
                setSelectedReason(event.target.value ? { category, value: event.target.value } : null)
              }
            >
              <option value="">未选择</option>
              {reasonOptions[category].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="col-span-2">
          <span className="label">自定义掷骰原因</span>
          <input
            className="input"
            aria-label="掷骰原因"
            value={reason}
            disabled={selectedReason !== null}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：察觉埋伏、力量检定…"
          />
        </label>
        <p className="tiny subtle col-span-2">
          战斗与鉴定只能选一项；将已选列表改为“未选择”，即可切换分类或填写自定义原因。
        </p>
      </div>
      <div ref={stageRef}>
        <label className="dice-motion-toggle">
          <input type="checkbox" checked={animated} onChange={(e) => toggleMotion(e.target.checked)} />
          3D 掷骰动效
        </label>
        <DiceStage
          key={`stage:${busy ? 'pending' : last?.id || 'idle'}`}
          roll={last}
          expression={busy ? rollingExpression : expression}
          pending={busy}
          animated={animated}
          reveal={revealedId === last?.id}
        />
      </div>
      <button
        className="btn btn-primary w-full !py-3 text-lg"
        disabled={busy || (!retrying && (!expression.trim() || (visibility === 'PUBLIC' && remainingMs > 0)))}
        onClick={() => void roll()}
      >
        <Dices size={21} />
        {busy ? '命运正在转动…' : retrying ? '重试上次掷骰' : '掷出骰子'}
      </button>
      {visibility === 'PUBLIC' && remainingMs > 0 && (
        <p className="dice-cooldown tiny text-center" role="status">
          {(Math.ceil(remainingMs / 100) / 10).toFixed(1)} 秒后可掷骰 · 全房间共享冷却
        </p>
      )}
      {retrying && <p className="tiny subtle">结果暂未确认。重试使用上次的表达式和请求编号，不会重复记账。</p>}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {last && !busy && (
        <div className="dice-result" key={last.id} role="status" aria-live="polite" aria-atomic="true">
          <div className="eyebrow">LATEST ROLL</div>
          <div className="tiny subtle">
            {diceActor(last)} · {last.visibility === 'PRIVATE' ? '私密' : '房间公开'}
          </div>
          <div className="dice-result-number">{last.total}</div>
          <div className="text-sm">
            {last.reason || '自由掷骰'} · {last.expression}
          </div>
          <div className="tiny subtle mt-2">
            {(last.details || []).map((part: any, i: number) => (
              <span key={i} className="mr-2">
                {part.sign < 0 ? '−' : '+'}
                {part.label}
                {part.rolls ? ` [${part.rolls.join(', ')}]` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="sheet-section-heading">
          <h3>掷骰记录</h3>
          <span>最近结果</span>
        </div>
        <div className="space-y-2">
          {snap.rolls.map((roll) => (
            <div key={roll.id} className="dice-history">
              <div className="dice-history-total">{roll.total}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm dice-history-description">
                  {new Date(roll.createdAt).toLocaleTimeString('zh-CN', { hour12: false })} — {diceActor(roll)} 掷出{' '}
                  {roll.expression}，结果 {roll.total}
                </div>
                <div className="tiny subtle">
                  {roll.reason || '自由掷骰'} · 计算：{diceCalculation(roll.details || [])}
                </div>
              </div>
              <span title={roll.visibility === 'PRIVATE' ? '掷骰者与 GM 可见' : '房间公开'} className="text-amber-300">
                {roll.visibility === 'PRIVATE' ? <Lock size={14} /> : <Globe2 size={14} />}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="tiny subtle flex items-center gap-2">
        <Sparkles size={13} /> 支持 NdM、加减常数与角色属性，如 1d20+力量加值。
      </p>
    </div>
  );
}
