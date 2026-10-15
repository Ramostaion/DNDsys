import { useState } from 'react';
import { sortCharacterTags, TAG_VISIBILITIES } from '@dnd/shared';
import { useUI } from '../../store';
import { TagIcon, visibilityNames } from './TagIcon';
import type { TagProps } from './types';
export default function GmTagOverview({ p }: { p: TagProps }) {
  const [search, setSearch] = useState(''),
    [characterId, setCharacterId] = useState(''),
    [definitionId, setDefinitionId] = useState(''),
    [visibility, setVisibility] = useState(''),
    [priority, setPriority] = useState('');
  const open = useUI((s) => s.open);
  if (!p.isGM) return <p>角色标签总览仅主持人可查看。</p>;
  const names = new Map(p.snap.characters.map((c) => [c.id, c.name as string]));
  const tags = sortCharacterTags(
    p.snap.characterTags.filter(
      (t) =>
        (!characterId || t.characterId === characterId) &&
        (!definitionId || t.tagDefinitionId === definitionId) &&
        (!visibility || t.visibility === visibility) &&
        (!priority ||
          (priority === 'high' && t.priority > 0) ||
          (priority === 'normal' && t.priority === 0) ||
          (priority === 'low' && t.priority < 0)) &&
        `${names.get(t.characterId)}\n${t.definition.name}\n${t.detailsMarkdown}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
  );
  return (
    <div className="space-y-4 tag-overview-panel">
      <div>
        <div className="eyebrow">GM STORY NOTEBOOK</div>
        <h2 className="display-title text-2xl">角色标签总览</h2>
      </div>
      <input
        className="input"
        aria-label="搜索角色标签与详情"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索角色、标签名称或详情全文…"
      />
      <div className="tag-form-grid">
        <select
          className="input"
          aria-label="按角色筛选"
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
        >
          <option value="">所有角色</option>
          {p.snap.characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="按标签筛选"
          value={definitionId}
          onChange={(e) => setDefinitionId(e.target.value)}
        >
          <option value="">所有标签</option>
          {p.snap.tagDefinitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="按可见范围筛选"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="">所有可见范围</option>
          {TAG_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {visibilityNames[v]}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="按优先级筛选"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">所有优先级</option>
          <option value="high">高（大于 0）</option>
          <option value="normal">普通（0）</option>
          <option value="low">低（小于 0）</option>
        </select>
      </div>
      <div className="tiny subtle">找到 {tags.length} 条独立角色备注</div>
      {tags.map((tag) => (
        <button
          key={tag.id}
          className="grid-card w-full text-left tag-overview-row"
          onClick={() => open('tag-detail', tag.id)}
        >
          <div className="tag-card-heading">
            <span style={{ color: tag.definition.color }}>
              <TagIcon icon={tag.definition.icon} size={20} />
            </span>
            <strong>
              {names.get(tag.characterId)} · {tag.definition.name}
            </strong>
          </div>
          <p className="tag-summary text-sm mt-2">{tag.detailsMarkdown || '尚未填写详情'}</p>
          <p className="tiny subtle mt-2">
            {visibilityNames[tag.visibility]} · 优先级 {tag.priority} · 点击查看/编辑此实例
          </p>
        </button>
      ))}
      {!tags.length && <div className="empty-note">没有匹配的角色标签。</div>}
    </div>
  );
}
