import { useState } from 'react';
import { sortCharacterTags } from '@dnd/shared';
import { useUI } from '../../store';
import CharacterTagBadges from './CharacterTagBadges';
import { TagIcon, visibilityNames } from './TagIcon';
import TagDefinitionEditor from './TagDefinitionEditor';
import TagAttachForm from './TagAttachForm';
import type { TagProps } from './types';
export default function CharacterTagManager({ p, id, windowId }: { p: TagProps; id?: string; windowId: string }) {
  const open = useUI((s) => s.open),
    [creating, setCreating] = useState(false),
    [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const character = p.snap.characters.find((c) => c.id === id);
  if (!character) return <p>角色不存在或没有查看权限。</p>;
  const tags = sortCharacterTags(p.snap.characterTags.filter((t) => t.characterId === id)),
    definition = p.snap.tagDefinitions.find((d) => d.id === selected),
    adding = creating || choosing || !!definition;
  async function remove(tagId: string, version: number, name: string) {
    if (!confirm(`从 ${character!.name} 移除「${name}」及其独立备注？其他角色和标签库不会变化。`)) return;
    setBusy(true);
    setError('');
    try {
      await p.mutate('characterTag.detach', { id: tagId, version });
      setMessage('已从此角色移除');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 tag-manager">
      <div className="flex items-center gap-5">
        <CharacterTagBadges snap={p.snap} characterId={character.id}>
          <div className="character-avatar">
            {character.avatarUrl ? <img src={character.avatarUrl} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
          </div>
        </CharacterTagBadges>
        <div>
          <h2 className="display-title text-xl">{character.name}</h2>
          <p className="tiny subtle">{p.isGM ? '角色独立备注与叙事标记' : '当前账号可见的角色标签'}</p>
        </div>
      </div>
      {p.isGM && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={adding}
            onClick={() => {
              setCreating(true);
              setMessage('');
            }}
          >
            添加标签
          </button>
          <button
            className="btn"
            disabled={adding}
            onClick={() => {
              setChoosing(true);
              setSearch('');
              setMessage('');
            }}
          >
            从标签库选择
          </button>
          <button className="btn" onClick={() => open('tag-library')}>
            打开标签库
          </button>
          <button className="btn" onClick={() => open('tag-overview')}>
            角色标签总览
          </button>
        </div>
      )}
      {p.isGM && creating && (
        <TagDefinitionEditor
          p={p}
          windowId={windowId}
          onDone={(newId) => {
            setCreating(false);
            if (newId) setSelected(newId);
          }}
        />
      )}
      {p.isGM && definition && (
        <TagAttachForm
          key={definition.id}
          p={p}
          definition={definition}
          characterId={character.id}
          windowId={windowId}
          onDone={(attached) => {
            setSelected('');
            setChoosing(false);
            if (attached) setMessage('标签列表已更新');
          }}
        />
      )}
      {p.isGM && choosing && !definition && (
        <div className="panel rounded p-3 space-y-3">
          <h3 className="font-semibold">选择已有标签定义</h3>
          <input
            className="input"
            aria-label="搜索标签库定义"
            placeholder="筛选已有标签…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="tag-selection-list">
            {p.snap.tagDefinitions
              .filter(
                (d) =>
                  !d.isArchived &&
                  !tags.some((t) => t.tagDefinitionId === d.id) &&
                  d.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((d) => (
                <button className="tag-list-row" key={d.id} onClick={() => setSelected(d.id)}>
                  <span style={{ color: d.color }}>
                    <TagIcon icon={d.icon} />
                  </span>
                  <span>{d.name}</span>
                  <span className="tiny subtle ml-auto">{visibilityNames[d.defaultVisibility]}</span>
                </button>
              ))}
          </div>
          <button className="btn" onClick={() => setChoosing(false)}>
            取消选择
          </button>
        </div>
      )}
      <section className="space-y-2 attached-tag-list">
        <h3 className="font-semibold text-sm">已有标签 · {tags.length}</h3>
        {tags.map((tag) => (
          <article key={tag.id} className="grid-card">
            <button className="tag-list-row w-full !p-0" onClick={() => open('tag-detail', tag.id)}>
              <span style={{ color: tag.definition.color }}>
                <TagIcon icon={tag.definition.icon} size={22} />
              </span>
              <div className="min-w-0 text-left flex-1">
                <strong>{tag.definition.name}</strong>
                <p className="tag-summary tiny subtle">{tag.detailsMarkdown || '尚未填写详情'}</p>
              </div>
              <span className="tiny subtle">{tag.priority}</span>
            </button>
            {p.isGM && (
              <div className="flex justify-between items-center mt-3">
                <span className="tiny subtle">
                  {visibilityNames[tag.visibility]}
                  {tag.definition.isArchived ? ' · 定义已归档' : ''}
                </span>
                <button
                  className="tiny text-red-300"
                  disabled={busy || adding}
                  onClick={() => void remove(tag.id, tag.version, tag.definition.name)}
                >
                  从此角色移除
                </button>
              </div>
            )}
          </article>
        ))}
        {!tags.length && (
          <div className="empty-note">{p.isGM ? '此角色尚未添加标签。' : '此角色暂无你可见的标签。'}</div>
        )}
      </section>
      {message && (
        <p role="status" className="tiny text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
    </div>
  );
}
