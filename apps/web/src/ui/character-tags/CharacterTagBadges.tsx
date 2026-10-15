import type { ReactNode } from 'react';
import { Tags } from 'lucide-react';
import { sortCharacterTags } from '@dnd/shared';
import type { Snapshot } from '../../api';
import { useUI } from '../../store';
import { TagIcon } from './TagIcon';
export default function CharacterTagBadges({
  snap,
  characterId,
  children,
  compact = false,
}: {
  snap: Snapshot;
  characterId: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const open = useUI((s) => s.open);
  const tags = sortCharacterTags((snap.characterTags || []).filter((tag) => tag.characterId === characterId));
  return (
    <div className={`tag-avatar-wrap ${compact ? 'compact' : ''}`}>
      {children}
      <div className="tag-badges">
        {tags.slice(0, 3).map((tag, i) => (
          <button
            type="button"
            key={tag.id}
            className={`tag-avatar-badge anchor-${i}`}
            title={tag.definition.name}
            aria-label={`标签：${tag.definition.name}`}
            style={{ color: tag.definition.color, borderColor: tag.definition.color }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              open('tag-detail', tag.id);
            }}
          >
            <TagIcon icon={tag.definition.icon} size={compact ? 11 : 14} />
            <span className="tag-badge-tooltip" aria-hidden="true">
              {tag.definition.name}
            </span>
          </button>
        ))}
        {tags.length > 3 && (
          <button
            type="button"
            className="tag-avatar-badge tag-overflow"
            title="查看全部可见标签"
            aria-label={`查看全部 ${tags.length} 个可见标签`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              open('character-tags', characterId);
            }}
          >
            +{tags.length - 3}
          </button>
        )}
      </div>
    </div>
  );
}
export function CharacterTagManageButton({ characterId, isGM }: { characterId: string; isGM: boolean }) {
  const open = useUI((s) => s.open);
  return (
    <button className="btn" onClick={() => open('character-tags', characterId)}>
      <Tags size={15} />
      {isGM ? '管理标签' : '查看标签'}
    </button>
  );
}
