import StateName from './StateName';
import { durationText } from './DurationInput';
import { useState } from 'react';
import { sortCharacterTags } from '@dnd/shared';
import { useUI } from '../../store';
import CharacterTagBadges from './CharacterTagBadges';
import { TagIcon, visibilityNames } from './TagIcon';
import TagDefinitionEditor from './TagDefinitionEditor';
import TagAttachForm from './TagAttachForm';
import type { TagProps } from './types';
import { CustomFieldsDetails } from '../CustomFieldsEditor';
export default function CharacterTagManager({ p, id, windowId }: { p: TagProps; id?: string; windowId: string }) {
  const open = useUI((s) => s.open),
    [creating, setCreating] = useState(false),
    [choosing, setChoosing] = useState(false),
    [choosingSkill, setChoosingSkill] = useState(false),
    [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const character = p.snap.characters.find((c) => c.id === id);
  if (!character) return <p>角色不存在或没有查看权限。</p>;
  const tags = sortCharacterTags(p.snap.characterTags.filter((t) => t.characterId === id)),
    definition = p.snap.tagDefinitions.find((d) => d.id === selected),
    adding = creating || choosing || choosingSkill || !!definition;
  async function remove(tagId: string, version: number, name: string) {
    if (!confirm(`从 ${character!.name} 移除「${name}」及其独立备注？其他角色和状态库不会变化。`)) return;
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
          <p className="tiny subtle">{p.isGM ? '角色独立备注与叙事标记' : '当前账号可见的角色状态'}</p>
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
            添加状态
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
            从状态库选择
          </button>
          <button
            className="btn"
            disabled={adding}
            onClick={() => {
              setChoosingSkill(true);
              setSearch('');
              setError('');
            }}
          >
            从技能选择
          </button>
          <button className="btn" onClick={() => open('tag-library')}>
            打开状态库
          </button>
          <button className="btn" onClick={() => open('tag-overview')}>
            角色状态总览
          </button>
        </div>
      )}
      {p.isGM && choosingSkill && (
        <section className="panel rounded p-3 space-y-3">
          <h3 className="font-semibold">从技能选择状态</h3>
          <p className="tiny subtle">
            复制技能名称、说明和词条为独立状态；数值词条此时开始与同名基础信息联动，技能模板保持原样。
          </p>
          <input
            className="input"
            aria-label="搜索技能状态"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能…"
          />
          <div className="tag-selection-list">
            {p.snap.templates
              .filter((t) => t.kind === 'SKILL' && t.name.toLowerCase().includes(search.toLowerCase()))
              .map((template) => (
                <button
                  className="tag-list-row"
                  key={template.id}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await p.mutate('characterTag.fromSkill', {
                        characterId: character.id,
                        templateId: template.id,
                        templateVersion: template.version,
                      });
                      setChoosingSkill(false);
                      setMessage('已从技能添加状态');
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span className="text-left">
                    <strong>{template.name}</strong>
                    <CustomFieldsDetails fields={template.data?.customFields} />
                  </span>
                </button>
              ))}
          </div>
          {!p.snap.templates.some((t) => t.kind === 'SKILL') && <p className="empty-note">能力模板库中尚无技能。</p>}
          <button className="btn" disabled={busy} onClick={() => setChoosingSkill(false)}>
            取消选择
          </button>
        </section>
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
            if (attached) setMessage('状态列表已更新');
          }}
        />
      )}
      {p.isGM && choosing && !definition && (
        <div className="panel rounded p-3 space-y-3">
          <h3 className="font-semibold">选择已有状态定义</h3>
          <input
            className="input"
            aria-label="搜索状态库定义"
            placeholder="筛选已有状态…"
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
                  <span>
                    <StateName name={d.name} numeral={d.romanNumeral} />
                  </span>
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
        <h3 className="font-semibold text-sm">已有状态 · {tags.length}</h3>
        {tags.map((tag) => (
          <article key={tag.id} className="grid-card">
            <button className="tag-list-row w-full !p-0" onClick={() => open('tag-detail', tag.id)}>
              <span style={{ color: tag.definition.color }}>
                <TagIcon icon={tag.definition.icon} size={22} />
              </span>
              <div className="min-w-0 text-left flex-1">
                <strong>
                  <StateName name={tag.definition.name} numeral={tag.romanNumeral} />
                </strong>
                <p className="tiny subtle">{durationText(tag.remainingTurns)}</p>
                <p className="tag-summary tiny subtle">{tag.detailsMarkdown || '尚未填写详情'}</p>
              </div>
              <span className="tiny subtle">{tag.priority}</span>
            </button>
            {p.isGM && (
              <div className="flex justify-between items-center mt-3">
                <span className="tiny subtle">
                  {visibilityNames[tag.visibility]}
                  {tag.definition.isArchived ? ' · 来源已从状态库删除' : ''}
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
          <div className="empty-note">{p.isGM ? '此角色尚未添加状态。' : '此角色暂无你可见的状态。'}</div>
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
