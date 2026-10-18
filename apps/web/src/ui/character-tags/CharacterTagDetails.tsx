import { useRef, useState } from 'react';
import type { CharacterTag } from '@dnd/shared';
import { useUI } from '../../store';
import StateDetailsContent from './StateDetailsContent';
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
  if (!tag) return <div className="empty-note">此状态已移除，或当前账号没有查看权限。</div>;
  const character = p.snap.characters.find((c) => c.id === tag.characterId);
  return (
    <div className="tag-detail-view">
      <StateDetailsContent tag={tag} characterName={character?.name} />
      {p.isGM && tag.definition.isArchived && <p className="state-detail-archived">来源已从状态库删除</p>}
      {p.isGM && (
        <div className="state-detail-actions">
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            编辑此角色备注
          </button>
          <button className="btn" onClick={() => open('character-tags', tag.characterId)}>
            管理角色状态
          </button>
          <button
            className="btn state-detail-remove"
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
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      <footer className="state-detail-audit">
        <span>最后修改：{new Date(tag.updatedAt).toLocaleString()}</span>
        {p.isGM && <span>展示优先级 {tag.priority}</span>}
      </footer>
    </div>
  );
}
