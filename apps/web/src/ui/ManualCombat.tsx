import { useEffect, useMemo, useRef, useState } from 'react';
import { compareCombatants } from '@dnd/shared';
import { Dices, Plus, ChevronRight } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import { canEditCharacter } from '../permissions';
import { createId } from '../id';
import AgilityResult from './combat/AgilityResult';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>, operationId?: string) => Promise<any>;
};
const kinds = [
  ['DECLARATION', '动作声明'],
  ['RESULT', '结果记录'],
  ['RULING', 'GM 裁定'],
  ['STATE', '状态备注'],
  ['SCENE', '场景事件'],
  ['NOTE', '自由备注'],
  ['CORRECTION', '更正'],
  ['START', '开始遭遇'],
  ['TURN', '指定行动'],
  ['ORDER', '调整顺序'],
  ['ROUND', '设置轮次'],
  ['ADD', '加入遭遇'],
  ['REMOVE', '离开遭遇'],
  ['END', '结束遭遇'],
];
const nameOf = (snap: Snapshot, id?: string) => snap.characters.find((c) => c.id === id)?.name || '未关联角色';
function eventText(snap: Snapshot, event: any) {
  if (event.kind === 'ATTACK')
    return `${nameOf(snap, event.actorId)} → ${nameOf(snap, event.targetId)}；旧版自动结算 ${event.data.hit ? '命中' : '未命中'}，伤害 ${event.data.damage ?? 0}`;
  if (event.kind === 'TURN') return `第 ${event.data.round} 轮焦点：${nameOf(snap, event.data.characterId)}`;
  if (event.kind === 'DAMAGE' || event.kind === 'HEAL')
    return `${nameOf(snap, event.targetId)} ${event.kind === 'HEAL' ? '恢复' : '减少'} ${event.data.amount ?? 0} 点生命；${event.data.previousHp ?? '—'} → ${event.data.currentHp ?? '—'}${event.data.note ? ` · ${event.data.note}` : ''}`;
  if (event.kind === 'START')
    return `建立遭遇：${(event.data.participants || []).map((id: string) => nameOf(snap, id)).join('、')}`;
  if (event.kind === 'INITIATIVE') return `${nameOf(snap, event.data.characterId)} 先攻设为 ${event.data.initiative}`;
  if (event.kind === 'ADD' || event.kind === 'REMOVE')
    return `${nameOf(snap, event.data.characterId)} ${event.kind === 'ADD' ? '加入' : '离开'}遭遇`;
  if (event.kind === 'ORDER') return 'GM 调整了参与者的行动顺序';
  if (event.kind === 'ROUND') return `GM 将轮次设为第 ${event.data.round} 轮`;
  if (event.kind === 'END') return '遭遇结束';
  if (event.kind === 'CORRECTION')
    return `更正记录 ${String(event.data?.correctsEventId || '').slice(-6)}：${event.data?.note || ''}`;
  return event.data?.note || event.kind;
}
export default function ManualCombat({ snap, me, isGM, mutate }: Props) {
  const open = useUI((s) => s.open),
    encounter = snap.encounter;
  const [selected, setSelected] = useState<string[]>([]),
    [startNote, setStartNote] = useState(''),
    [actorId, setActorId] = useState<string | null>(null),
    [targetId, setTargetId] = useState(''),
    [kind, setKind] = useState('DECLARATION'),
    [note, setNote] = useState(''),
    [privateRecord, setPrivate] = useState(false),
    [roundDraft, setRoundDraft] = useState(String(encounter?.round || 1)),
    [correcting, setCorrecting] = useState(''),
    [correction, setCorrection] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [lastRecord, setLastRecord] = useState<any>(null),
    [retrying, setRetrying] = useState(false);
  const recordInFlight = useRef(false);
  const pendingRecord = useRef<{ id: string; payload: Record<string, unknown> } | null>(null);
  const combatants = useMemo(() => [...(encounter?.combatants || [])].sort(compareCombatants), [encounter]);
  const availableActors = snap.characters.filter((c) => canEditCharacter(snap, me.id, c));
  const actor = actorId === null ? availableActors[0] : availableActors.find((c) => c.id === actorId);
  useEffect(() => setRoundDraft(String(encounter?.round || 1)), [encounter?.round]);
  async function run(type: string, payload: Record<string, unknown>) {
    setError('');
    setBusy(true);
    try {
      return await mutate(type, payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const events = (
    encounter ? snap.combatEvents.filter((e) => e.encounterId === encounter.id) : snap.combatEvents
  ).slice(0, 100);
  const target = snap.characters.find((c) => c.id === targetId);
  const automatic = kind === 'DECLARATION' && actor && target && actor.id !== target.id;
  const preview = !automatic
    ? kind !== 'DECLARATION'
      ? '此类型仅保存记录，不执行对抗。'
      : !actor
        ? '请选择声明角色。'
        : !target
          ? '未选择关联目标，仅保存普通行动记录。'
          : '同一角色不能与自己对抗。'
    : !actor.derived?.agility
      ? `${actor.name}缺少合法敏捷，保存普通行动记录。`
      : !target.derived?.agility
        ? `${target.name}缺少可见合法敏捷，保存普通行动记录。`
        : `将由服务器独立投掷双方 D20，比较敏捷属性加值 + D20，结果小于等于 0 按 1 计；相等时闪避。`;
  async function saveRecord() {
    if (recordInFlight.current) return;
    recordInFlight.current = true;
    const pending = pendingRecord.current || {
      id: createId(),
      payload: {
        kind,
        actorId: actor?.id || undefined,
        targetId: targetId || undefined,
        note: note.trim(),
        visibility: privateRecord ? 'PRIVATE' : 'PUBLIC',
      },
    };
    pendingRecord.current = pending;
    setBusy(true);
    setError('');
    try {
      const result = await mutate('combat.record', pending.payload, pending.id);
      pendingRecord.current = null;
      setRetrying(false);
      setLastRecord(result);
      setNote('');
    } catch (e) {
      const cause = e as Error & { status?: number };
      if (cause.status && cause.status < 500) pendingRecord.current = null;
      setRetrying(Boolean(pendingRecord.current));
      setError(cause.message);
    } finally {
      recordInFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 manual-combat">
      <div>
        <div className="eyebrow">MANUAL ENCOUNTER</div>
        <h2 className="display-title text-xl mt-1">遭遇与裁决记录</h2>
        <p className="tiny subtle mt-1">GM 直接指定谁行动、调整顺序与轮次。掷骰和记录不会自动扣血、耗点或触发状态。</p>
      </div>
      {!encounter && isGM && (
        <div className="panel p-3 rounded-lg space-y-3">
          <strong>建立遭遇</strong>
          <div className="grid grid-cols-2 gap-2">
            {snap.characters.map((c) => (
              <label key={c.id} className="grid-card tiny flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((old) => (e.target.checked ? [...old, c.id] : old.filter((id) => id !== c.id)))
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          <input
            className="input"
            placeholder="遭遇名称或说明（可选）"
            value={startNote}
            onChange={(e) => setStartNote(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || selected.length < 1}
            onClick={() => void run('combat.start', { characterIds: selected, note: startNote })}
          >
            开始记录
          </button>
        </div>
      )}
      {encounter && (
        <div className="panel p-3 rounded-lg space-y-3 combat-control">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div>
              <div className="tiny text-amber-300">第 {encounter.round} 轮</div>
              <strong>
                当前行动：
                {encounter.currentCharacterId ? nameOf(snap, encounter.currentCharacterId) : 'GM 尚未指定公开角色'}
              </strong>
            </div>
            {isGM && (
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy || !combatants.length}
                  onClick={() => void run('combat.advance', { version: encounter.version })}
                >
                  <ChevronRight size={14} />
                  下一位
                </button>
                <button className="btn" disabled={busy} onClick={() => void run('combat.end', {})}>
                  结束
                </button>
              </div>
            )}
          </div>
          {isGM && (
            <div className="flex gap-2 items-center">
              <label className="tiny" htmlFor="combat-round">
                轮次
              </label>
              <input
                id="combat-round"
                className="input !w-20"
                type="number"
                min="1"
                max="10000"
                value={roundDraft}
                onChange={(e) => setRoundDraft(e.target.value)}
              />
              <button
                className="btn tiny"
                disabled={busy || !Number.isSafeInteger(Number(roundDraft)) || Number(roundDraft) < 1}
                onClick={() => void run('combat.round', { round: Number(roundDraft), version: encounter.version })}
              >
                设置轮次
              </button>
            </div>
          )}
          <div className="space-y-2">
            {combatants.map((entry: any, index: number) => {
              const characterName = nameOf(snap, entry.characterId);
              async function reorder(offset: number) {
                const ids = combatants.map((c: any) => c.characterId);
                [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
                await run('combat.order', { characterIds: ids, version: encounter.version });
              }
              return (
                <div
                  key={entry.id}
                  className={`grid-card flex flex-wrap items-center gap-2 combat-participant ${entry.characterId === encounter.currentCharacterId ? '!border-amber-400' : ''}`}
                >
                  <span className="badge">{index + 1}</span>
                  <strong className="flex-1 min-w-14 whitespace-nowrap">{characterName}</strong>
                  {isGM && (
                    <>
                      <button
                        className="btn tiny"
                        disabled={busy}
                        onClick={() =>
                          void run('combat.focus', { characterId: entry.characterId, version: encounter.version })
                        }
                      >
                        让{characterName}行动
                      </button>
                      <button
                        className="btn tiny"
                        aria-label={`上移${characterName}`}
                        disabled={busy || index === 0}
                        onClick={() => void reorder(-1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn tiny"
                        aria-label={`下移${characterName}`}
                        disabled={busy || index === combatants.length - 1}
                        onClick={() => void reorder(1)}
                      >
                        ↓
                      </button>
                      <button
                        className="tiny text-red-300"
                        disabled={busy}
                        onClick={() =>
                          void run('combat.remove', { characterId: entry.characterId, version: encounter.version })
                        }
                      >
                        移出
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {isGM && (
            <div className="flex gap-2">
              <select
                className="input"
                aria-label="添加遭遇参与者"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">添加参与者</option>
                {snap.characters
                  .filter((c) => !combatants.some((entry: any) => entry.characterId === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <button
                className="btn whitespace-nowrap"
                disabled={!targetId || busy}
                onClick={() => void run('combat.add', { characterId: targetId, version: encounter.version })}
              >
                <Plus size={14} />
                加入
              </button>
            </div>
          )}
        </div>
      )}
      <div className="panel p-3 rounded-lg space-y-3">
        <div className="flex justify-between items-center">
          <strong>记录一次行动或裁定</strong>
          <button className="btn tiny" onClick={() => open('dice')}>
            <Dices size={14} />
            自由掷骰
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">类型</span>
            <select
              className="input"
              aria-label="记录类型"
              disabled={busy || retrying}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {kinds
                .filter(
                  ([value]) =>
                    ['DECLARATION', 'RESULT', 'RULING', 'STATE', 'SCENE', 'NOTE'].includes(value) &&
                    (isGM || !['RULING', 'SCENE'].includes(value)),
                )
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="label">声明角色</span>
            <select
              className="input"
              aria-label="声明角色"
              disabled={busy || retrying}
              value={actor?.id || ''}
              onChange={(e) => setActorId(e.target.value)}
            >
              <option value="">无</option>
              {availableActors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">关联目标</span>
            <select
              className="input"
              aria-label="关联目标"
              disabled={busy || retrying}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">无</option>
              {snap.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {isGM && (
            <label className="flex gap-2 items-center tiny">
              <input
                type="checkbox"
                disabled={busy || retrying}
                checked={privateRecord}
                onChange={(e) => setPrivate(e.target.checked)}
              />
              仅 GM 可见
            </label>
          )}
        </div>
        <textarea
          aria-label="行动或裁定内容"
          disabled={busy || retrying}
          className="input min-h-20"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：我挥剑攻击。动作声明关联双方敏捷时自动对抗；伤害请由 GM 另行裁定。"
        />
        <button
          className="btn btn-primary"
          disabled={busy || (!retrying && !note.trim() && !automatic)}
          onClick={() => void saveRecord()}
        >
          {retrying ? '重试保存上次记录' : '保存记录'}
        </button>
        <p className="tiny subtle">{retrying ? '上次保存结果尚未确认，重试会沿用原操作，不会重复投骰。' : preview}</p>
        {lastRecord?.data?.contest && <AgilityResult contest={lastRecord.data.contest} recordId={lastRecord.id} />}
        {lastRecord?.data?.skippedReason && (
          <p role="status" className="tiny text-amber-200">
            未执行自动判定：{lastRecord.data.skippedReason}
          </p>
        )}
      </div>
      {error && <p className="tiny text-red-300">{error}</p>}
      {correcting && (
        <div className="panel p-3 rounded-lg space-y-2">
          <strong>追加更正记录</strong>
          <textarea
            className="input min-h-16"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="说明原记录哪里有误，以及最终裁定…"
          />
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={busy || !correction.trim()}
              onClick={async () => {
                const result = await run('combat.correct', { eventId: correcting, note: correction.trim() });
                if (result) {
                  setCorrecting('');
                  setCorrection('');
                }
              }}
            >
              保存更正
            </button>
            <button className="btn" onClick={() => setCorrecting('')}>
              取消
            </button>
          </div>
        </div>
      )}
      <div>
        <h3 className="font-semibold mb-2">时间线</h3>
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="grid-card tiny combat-event">
              <div className="tiny subtle mb-2">
                记录者：
                {event.user?.username ||
                  snap.members.find((member) => member.userId === event.userId)?.user?.username ||
                  '已离开的玩家'}
                {event.actorId && ` · 行动角色：${event.data?.contest?.attacker.name || nameOf(snap, event.actorId)}`}
                {event.targetId && ` → ${event.data?.contest?.defender.name || nameOf(snap, event.targetId)}`}
              </div>
              <span className="badge mr-2">
                {event.kind === 'ATTACK'
                  ? '旧版自动攻击'
                  : kinds.find(([value]) => value === event.kind)?.[1] || event.kind}
              </span>
              <span>{eventText(snap, event)}</span>
              {event.data?.contest && (
                <details className="contest-history">
                  <summary>{event.data.contest.hit ? '攻击命中' : '成功闪避'} · 查看判定详情</summary>
                  <AgilityResult contest={event.data.contest} recordId={event.id} />
                </details>
              )}
              {event.data?.skippedReason && <p className="subtle mt-1">未执行自动判定：{event.data.skippedReason}</p>}
              <span className="subtle ml-2">{new Date(event.createdAt).toLocaleString()}</span>
              {(isGM || event.userId === me.id) && (
                <button
                  className="tiny text-amber-300 ml-2"
                  onClick={() => {
                    setCorrecting(event.id);
                    setCorrection('');
                  }}
                >
                  更正
                </button>
              )}
            </div>
          ))}
          {events.length === 0 && <p className="tiny subtle">还没有记录。</p>}
        </div>
      </div>
    </div>
  );
}
