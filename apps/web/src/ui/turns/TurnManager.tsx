import { useState } from 'react';
import { calculateInitiative, initiativeFields } from '@dnd/shared';
import type { RoomPanelProps } from '../room/types';
import { InitiativeDetails } from './InitiativeEditor';
import { useTurnAction } from './useTurnAction';
import './turns.css';

export function TurnPortrait({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <span className="turn-portrait">
      {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} /> : <span>{name.slice(0, 1)}</span>}
    </span>
  );
}

export default function TurnManager({ p }: { p: RoomPanelProps }) {
  const session = p.snap.turnSession,
    mapId = session?.mapId ?? p.snap.room.activeMapId,
    map = p.snap.maps.find((row) => row.id === mapId),
    [selected, setSelected] = useState<string[]>([]),
    [total, setTotal] = useState(''),
    [nextRound, setNextRound] = useState(false),
    { run, busy, error } = useTurnAction(p.mutate);
  const fields = initiativeFields(p.snap.room, p.snap.characters),
    preset = p.snap.initiativePresets?.find((row) => row.id === p.snap.room.initiativePresetId);
  const tokens = p.snap.tokens
      .filter((token) => token.mapId === mapId)
      .sort((a, b) => Number(a.visibility === 'GM') - Number(b.visibility === 'GM') || a.id.localeCompare(b.id)),
    seen = new Set<string>();
  const candidates = tokens
    .filter((token) => {
      if (seen.has(token.characterId)) return false;
      seen.add(token.characterId);
      return !session?.participants.some((row) => row.characterId === token.characterId);
    })
    .map((token) => {
      const c = p.snap.characters.find((c) => c.id === token.characterId);
      return { token, c, calculation: c ? calculateInitiative(p.snap.room, c, preset?.weights, fields) : null };
    })
    .filter((row) => row.c);
  const chosen = candidates.filter((row) => selected.includes(row.token.id)),
    totalValue = total === '' ? null : Number(total),
    validTotal = totalValue === null || (Number.isInteger(totalValue) && totalValue > 0 && totalValue <= 1000000);
  const command = (type: string, payload: Record<string, unknown> = {}) =>
    session ? run(type, { sessionId: session.id, version: session.version, ...payload }) : Promise.resolve(undefined);
  function order(index: number, delta: number) {
    if (!session) return;
    const ids = session.participants.map((row) => row.characterId);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void command('turn.order', { characterIds: ids });
  }
  return (
    <div className="turn-panel space-y-4">
      <header>
        <div className="eyebrow">TURN & INITIATIVE · GM</div>
        <h2 className="display-title text-xl">回合系统</h2>
        <p className="tiny subtle">
          {session ? '会话绑定地图' : '当前地图'}：{map?.name || session?.mapName || '尚未选择地图'}
          {session && ' · 切换地图不改变本会话'}
        </p>
      </header>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      {session && (
        <>
          <div className="turn-session-heading">
            <strong>
              第 {session.round}
              {session.totalRounds ? ` / ${session.totalRounds}` : ''} 轮
            </strong>
            <span>
              {session.status === 'ACTIVE' ? '进行中' : session.status === 'PAUSED' ? '已暂停' : '已达预计总轮数'}
            </span>
          </div>
          <p className="tiny subtle">
            当前行动：
            {session.participants.find((row) => row.characterId === session.currentCharacterId)?.name ||
              (session.status === 'LIMIT' ? '等待 GM 延长或结束' : '等待添加人物或继续回合')}
          </p>
          <p className="tiny subtle">本轮顺序锁定；轮末状态结算后自动重算下一轮。手动重算保留当前人物及已行动记录。</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={busy || session.status !== 'ACTIVE' || !session.currentCharacterId}
              onClick={() => void command('turn.advance')}
            >
              结束当前回合
            </button>
            <button
              className="btn"
              disabled={busy || session.status === 'LIMIT' || !session.participants.length}
              onClick={() => void command(session.status === 'PAUSED' ? 'turn.resume' : 'turn.pause')}
            >
              {session.status === 'PAUSED' ? '继续回合' : '暂停回合'}
            </button>
            <button
              className="btn"
              disabled={busy || session.status !== 'ACTIVE'}
              title="视为正式结束，会扣减当前人物的有限状态"
              onClick={() => void command('turn.skip')}
            >
              跳过当前（扣减状态）
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (confirm('重新读取全部人物属性并刷新先手排序？当前行动者和本轮已行动记录保留。'))
                  void command('turn.recalculate');
              }}
            >
              重新计算先手
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm('结束整个回合模式？尚未到期的角色状态与剩余回合将保留。')) void command('turn.end');
              }}
            >
              结束回合模式
            </button>
          </div>
          <ol className="turn-manager-order">
            {session.participants.map((row, i) => (
              <li
                key={row.characterId}
                data-current={row.characterId === session.currentCharacterId}
                data-testid={`turn-participant-${row.characterId}`}
              >
                <div className="flex items-center gap-3">
                  <span className="tiny subtle">{i + 1}</span>
                  <TurnPortrait name={row.name} avatarUrl={row.avatarUrl} />
                  <div className="flex-1 min-w-0">
                    <strong>{row.name}</strong>
                    <p className="tiny subtle">
                      {row.isNpc ? 'NPC' : '玩家'} · 先手 {row.score} ·{' '}
                      {row.firstRound > session.round
                        ? '下轮加入'
                        : row.lastActedRound >= session.round
                          ? '本轮已行动'
                          : row.characterId === session.currentCharacterId
                            ? '正在行动'
                            : '等待行动'}
                      {row.tokenMissing ? ' · Token 已移除' : ''}
                    </p>
                  </div>
                </div>
                {row.calculation && <InitiativeDetails calculation={row.calculation} />}
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    className="btn tiny"
                    disabled={busy || i === 0}
                    aria-label={`上移 ${row.name}`}
                    onClick={() => order(i, -1)}
                  >
                    上移
                  </button>
                  <button
                    className="btn tiny"
                    disabled={busy || i === session.participants.length - 1}
                    aria-label={`下移 ${row.name}`}
                    onClick={() => order(i, 1)}
                  >
                    下移
                  </button>
                  <button
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`将 ${row.name} 移出队列？保留其状态与剩余回合，不执行倒计时。`))
                        void command('turn.remove', { characterId: row.characterId });
                    }}
                  >
                    移出队列
                  </button>
                </div>
                <details className="mt-2">
                  <summary className="tiny subtle">高级：无耗时切换</summary>
                  <p className="tiny subtle">不结束原人物回合，不扣减状态；原人物仍等待本轮行动。</p>
                  <button
                    className="btn tiny"
                    disabled={
                      busy ||
                      session.status === 'LIMIT' ||
                      row.firstRound > session.round ||
                      row.lastActedRound >= session.round ||
                      row.characterId === session.currentCharacterId
                    }
                    onClick={() => void command('turn.focus', { characterId: row.characterId })}
                  >
                    切换至此人物（不扣减）
                  </button>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="turn-total-settings">
        <label>
          <span className="label">{session ? '调整预计总轮数' : '预计总轮数'}（留空则不限）</span>
          <input
            className="input"
            aria-label="预计总轮数"
            placeholder={session?.totalRounds ? `当前 ${session.totalRounds}` : '不限轮数'}
            type="number"
            min={1}
            max={1000000}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        {session && (
          <button
            className="btn"
            disabled={busy || !validTotal}
            onClick={() => void command('turn.total', { totalRounds: totalValue })}
          >
            {total === '' ? '改为不限轮数' : '更新总轮数'}
          </button>
        )}
      </div>
      {session?.status === 'LIMIT' && (
        <p className="tag-conflict">预计轮数已完成。请增加总轮数、改为不限轮数，或结束回合模式。当前状态已保留。</p>
      )}
      <h3 className="label">{session ? '中途添加人物' : '选择参战人物'}</h3>
      <p className="tiny subtle">同一人物卡的多个 Token 仅列一个稳定代表，状态只计时一次；独立 NPC 人物卡分别入场。</p>
      {!session && (
        <div className="flex gap-2">
          <button
            className="btn tiny"
            onClick={() => setSelected(candidates.filter((row) => row.calculation?.valid).map((row) => row.token.id))}
          >
            全选可用人物
          </button>
          <button className="btn tiny" onClick={() => setSelected([])}>
            取消全选
          </button>
        </div>
      )}
      {session && (
        <label className="flex gap-2 tiny">
          <input type="checkbox" checked={nextRound} onChange={(e) => setNextRound(e.target.checked)} />
          新增人物从下一轮参与（不勾选则本轮参与）
        </label>
      )}
      <div className="turn-candidates">
        {candidates.map(({ token, c, calculation }) => (
          <div className="turn-candidate" key={token.id}>
            <div className="flex items-center gap-3">
              {!session && (
                <input
                  type="checkbox"
                  aria-label={`参战 ${c.name}`}
                  checked={selected.includes(token.id)}
                  disabled={!calculation?.valid || busy}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, token.id] : selected.filter((id) => id !== token.id))
                  }
                />
              )}
              <TurnPortrait name={c.name} avatarUrl={c.avatarUrl} />
              <div className="flex-1">
                <strong>{c.name}</strong>
                <p className="tiny subtle">
                  {c.isNpc ? 'NPC' : '玩家'}
                  {c.visibility === 'GM' || token.visibility === 'GM' ? '（仅 GM）' : ''} ·{' '}
                  {calculation?.valid ? `已配置 · 先手 ${calculation.score}` : '先手配置未完成'}
                </p>
              </div>
              {session && (
                <button
                  className="btn tiny"
                  disabled={busy || !calculation?.valid || session.status === 'LIMIT'}
                  onClick={() => void command('turn.add', { tokenId: token.id, nextRound })}
                >
                  加入队列
                </button>
              )}
            </div>
            {calculation && <InitiativeDetails calculation={calculation} />}
          </div>
        ))}
      </div>
      {!candidates.length && <p className="empty-note">此地图没有可加入的人物 Token。</p>}
      {!session && (
        <button
          className="btn btn-primary w-full"
          disabled={busy || !map || !validTotal || !chosen.length || chosen.some((row) => !row.calculation?.valid)}
          onClick={() =>
            void run('turn.start', {
              mapId: map.id,
              tokenIds: chosen.map((row) => row.token.id),
              totalRounds: totalValue,
            })
          }
        >
          {busy ? '准备中…' : '进入回合模式'}
        </button>
      )}
    </div>
  );
}
