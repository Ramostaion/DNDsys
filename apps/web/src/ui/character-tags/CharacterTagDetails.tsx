import { useRef, useState } from 'react';
import type { CharacterTag } from '@dnd/shared';
import { useUI } from '../../store';
import { TagIcon, visibilityNames } from './TagIcon';
import TagMarkdown from './TagMarkdown';
import CharacterTagEditor from './CharacterTagEditor';
import type { TagProps } from './types';
export default function CharacterTagDetails({ p, id, windowId }: { p: TagProps; id?: string; windowId: string }) {
  const [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const open = useUI((s) => s.open);
  const lastGMTag = useRef<CharacterTag | null>(null);
  const tag = p.snap.characterTags?.find((t) => t.id === id);
  if (p.isGM && tag) lastGMTag.current = tag;
  if (!p.isGM) lastGMTag.current = null;
  if (editing && p.isGM && lastGMTag.current)
    return (
      <CharacterTagEditor
        key={lastGMTag.current.id}
        p={p}
        tag={lastGMTag.current}
        removed={!tag}
        windowId={windowId}
        onBack={() => setEditing(false)}
      />
    );
  // Read directly from the current filtered snapshot; revoked details leave the DOM immediately.
  if (!tag) return <div className="empty-note">此标签已移除，或当前账号没有查看权限。</div>;
  const character = p.snap.characters.find((c) => c.id === tag.characterId);
  return (
    <div className="space-y-4 tag-detail-view">
      <div className="tag-card-heading">
        <span style={{ color: tag.definition.color }}>
          <TagIcon icon={tag.definition.icon} size={26} />
        </span>
        <div>
          <h2 className="display-title text-xl">{tag.definition.name}</h2>
          <div className="tiny subtle">
            {character?.name} · 优先级 {tag.priority}
          </div>
        </div>
      </div>
      {p.isGM && (
        <div className="flex flex-wrap gap-2">
          <span className="badge">{visibilityNames[tag.visibility]}</span>
          {tag.definition.isArchived && <span className="badge">定义已归档</span>}
          <button className="btn" onClick={() => setEditing(true)}>
            编辑此角色备注
          </button>
          <button className="btn" onClick={() => open('character-tags', tag.characterId)}>
            管理角色标签
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`从 ${character?.name} 移除「${tag.definition.name}」及此角色备注？其他角色不受影响。`))
                return;
              setBusy(true);
              setError('');
              try {
                await p.mutate('characterTag.detach', { id: tag.id, version: tag.version });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            从此角色移除
          </button>
        </div>
      )}
      <TagMarkdown text={tag.detailsMarkdown} />
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      <p className="tiny subtle">最后修改：{new Date(tag.updatedAt).toLocaleString()}</p>
    </div>
  );
}
