import { useState } from 'react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import { canEditCharacter } from '../permissions';
import CharacterTagBadges, { CharacterTagManageButton } from './character-tags/CharacterTagBadges';
import { roomMemberName } from '@dnd/shared';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
export default function CharacterDirectory({ p }: { p: Props }) {
  const open = useUI((s) => s.open);
  const [tab, setTab] = useState<'players' | 'npcs'>('players'),
    [name, setName] = useState(''),
    [ownerId, setOwnerId] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'GM'>('PUBLIC'),
    [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const npcs = tab === 'npcs',
    characters = p.snap.characters.filter((c) => Boolean(c.isNpc) === npcs);
  const lastPage = Math.max(0, Math.ceil(characters.length / 12) - 1),
    currentPage = Math.min(page, lastPage),
    list = characters.slice(currentPage * 12, currentPage * 12 + 12);
  async function create() {
    setBusy(true);
    setError('');
    try {
      await p.mutate('character.create', {
        name: name.trim(),
        ownerId: npcs ? null : ownerId || null,
        visibility,
        isNpc: npcs,
      });
      setName('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(c: any, changes: Record<string, unknown>) {
    setError('');
    try {
      await p.mutate('character.update', { id: c.id, version: c.version, patch: changes });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <div className="space-y-4">
      <div className="eyebrow">CHARACTERS & NPCS</div>
      <div className="character-directory-tabs" role="tablist" aria-label="角色分类">
        {(['players', 'npcs'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`btn ${tab === value ? 'btn-primary' : ''}`}
            onClick={() => {
              setTab(value);
              setPage(0);
              setError('');
            }}
          >
            {value === 'players' ? '玩家角色' : 'NPC'} ·{' '}
            {p.snap.characters.filter((c) => Boolean(c.isNpc) === (value === 'npcs')).length}
          </button>
        ))}
      </div>
      {p.isGM ? (
        <form
          className="panel p-3 rounded-lg space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !busy) void create();
          }}
        >
          <label>
            <span className="label">{npcs ? '新 NPC 名称' : '新角色名称'}</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={npcs ? '商人、守卫、怪物…' : '为角色起名'}
              maxLength={100}
            />
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            {npcs ? (
              <span className="tiny subtle flex-1">NPC 始终由 GM 控制；公开后玩家可查看。</span>
            ) : (
              <select
                className="input !w-auto flex-1 min-w-0"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                aria-label="角色控制者"
              >
                <option value="">暂不分配玩家</option>
                {p.snap.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {roomMemberName(member)}
                    {member.role === 'GM' ? ' · GM' : ''}
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary whitespace-nowrap" disabled={busy || !name.trim()}>
              {busy ? '创建中…' : npcs ? '创建 NPC' : '创建角色'}
            </button>
          </div>
          <label className="flex items-center gap-2 tiny">
            <input
              type="checkbox"
              checked={visibility === 'GM'}
              onChange={(event) => setVisibility(event.target.checked ? 'GM' : 'PUBLIC')}
            />
            仅 GM 可见
          </label>
        </form>
      ) : (
        npcs && <p className="tiny subtle">这里显示 GM 已公开的 NPC，玩家可以查看，控制权属于 GM。</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {list.map((c) => (
          <article key={c.id} className="grid-card text-center">
            <div
              role="button"
              tabIndex={0}
              aria-label={c.name}
              className="w-full cursor-pointer"
              onClick={() => open('character', c.id)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  open('character', c.id);
                }
              }}
              draggable={canEditCharacter(p.snap, p.me.id, c)}
              onDragStart={(event) => event.dataTransfer.setData('characterId', c.id)}
            >
              <CharacterTagBadges snap={p.snap} characterId={c.id}>
                <div className="character-avatar mx-auto">
                  {c.avatarUrl ? <img src={c.avatarUrl} alt="" /> : <span>{c.name.slice(0, 1)}</span>}
                </div>
              </CharacterTagBadges>
              <div className="mt-2 truncate">{c.name}</div>
              <div className="tiny subtle">
                {c.isNpc ? 'GM 控制的 NPC' : p.snap.room.sheetMode ? '自定义人物卡' : `Lv.${c.level}`}
              </div>
            </div>
            {p.isGM ? (
              <div className="mt-2 space-y-2">
                <CharacterTagManageButton characterId={c.id} isGM />
                <select
                  className="input !p-1 text-xs"
                  value={c.isNpc ? 'NPC' : 'PLAYER'}
                  aria-label={`${c.name}角色类型`}
                  onChange={(event) => void patch(c, { isNpc: event.target.value === 'NPC' })}
                >
                  <option value="PLAYER">玩家角色</option>
                  <option value="NPC">NPC（仅 GM 控制）</option>
                </select>
                {!c.isNpc && (
                  <select
                    className="input !p-1 text-xs"
                    value={c.ownerId || ''}
                    onChange={(event) => void patch(c, { ownerId: event.target.value || null })}
                    aria-label={`${c.name}控制者`}
                  >
                    <option value="">未分配</option>
                    {p.snap.members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {roomMemberName(member)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="tiny text-amber-300"
                  onClick={() => void patch(c, { visibility: c.visibility === 'GM' ? 'PUBLIC' : 'GM' })}
                >
                  {c.visibility === 'GM' ? '仅 GM 可见 · 点击公开' : '房间公开 · 点击隐藏'}
                </button>
              </div>
            ) : (
              <div className="tiny subtle mt-2">
                {c.isNpc
                  ? 'GM 控制'
                  : roomMemberName(
                      p.snap.members.find((member) => member.userId === c.ownerId),
                      '未分配',
                    )}
              </div>
            )}
          </article>
        ))}
      </div>
      {!list.length && (
        <div className="empty-note">{npcs ? '暂无可见的 NPC。' : '还没有角色。主持人可创建并分配给玩家。'}</div>
      )}
      <div className="flex justify-between items-center">
        <button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
          上一页
        </button>
        <span className="tiny subtle">第 {currentPage + 1} 页</span>
        <button className="btn" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>
          下一页
        </button>
      </div>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      <p className="tiny subtle">将有控制权限的角色卡拖到地图放置 Token；复制或删除棋子仅 GM 可操作。</p>
    </div>
  );
}
