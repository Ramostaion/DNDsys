import type { ReactNode } from 'react';
import { Tags } from 'lucide-react';
import { sortCharacterTags, stateDisplayName } from '@dnd/shared';
import type { Snapshot } from '../../api';
import { useUI } from '../../store';
import { TagIcon } from './TagIcon';
import { useHoverPreview } from '../HoverCard';
import { StateHoverCard } from './StateDetailsContent';
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
  const hover = useHoverPreview();
  const tags = sortCharacterTags((snap.characterTags || []).filter((tag) => tag.characterId === characterId));
  const preview = tags.find((tag) => tag.id === hover.preview?.id);
  return (
    <div className={`tag-avatar-wrap ${compact ? 'compact' : ''}`}>
      {children}
      <div className="tag-badges">
        {tags.slice(0, 3).map((tag, i) => (
          <button
            type="button"
            key={tag.id}
            className={`tag-avatar-badge anchor-${i}`}
            aria-label={`状态：${stateDisplayName(tag.definition.name, tag.romanNumeral)}`}
            onPointerEnter={(e) => hover.show(tag.id, e.currentTarget)}
            onPointerLeave={hover.leave}
            onFocus={(e) => hover.show(tag.id, e.currentTarget)}
            onBlur={hover.leave}
            style={{ color: tag.definition.color, borderColor: tag.definition.color }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              hover.close();
              open('tag-detail', tag.id);
            }}
          >
            <TagIcon icon={tag.definition.icon} size={compact ? 11 : 14} />
          </button>
        ))}
        {tags.length > 3 && (
          <button
            type="button"
            className="tag-avatar-badge tag-overflow"
            title="查看全部可见状态"
            aria-label={`查看全部 ${tags.length} 个可见状态`}
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
      <StateHoverCard
        hover={hover}
        tag={preview}
        characterName={snap.characters.find((c) => c.id === characterId)?.name}
      />
    </div>
  );
}
export function CharacterTagManageButton({ characterId, isGM }: { characterId: string; isGM: boolean }) {
  const open = useUI((s) => s.open);
  return (
    <button className="btn" onClick={() => open('character-tags', characterId)}>
      <Tags size={15} />
      {isGM ? '管理状态' : '查看状态'}
    </button>
  );
}
