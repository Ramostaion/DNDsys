import type { CSSProperties } from 'react';
import { Clock3, Eye, Infinity as InfinityIcon, UserRound } from 'lucide-react';
import { stateDisplayName, type CharacterTag } from '@dnd/shared';
import HoverCard, { type useHoverPreview } from '../HoverCard';
import { TagIcon, visibilityNames } from './TagIcon';
import StateName from './StateName';
import TagMarkdown from './TagMarkdown';
import { durationText } from './DurationInput';
import './state-details.css';

export default function StateDetailsContent({
  tag,
  characterName,
  compact = false,
}: {
  tag: CharacterTag;
  characterName?: string;
  compact?: boolean;
}) {
  const Heading = compact ? 'h3' : 'h2',
    finite = tag.remainingTurns != null;
  return (
    <article
      className={`state-details ${compact ? 'is-compact' : ''}`}
      style={{ '--state-accent': tag.definition.color } as CSSProperties}
    >
      <header className="state-details-header">
        <span className="state-details-icon" aria-hidden="true">
          <TagIcon icon={tag.definition.icon} size={compact ? 21 : 26} />
        </span>
        <div className="state-details-title">
          <span className="eyebrow">角色状态</span>
          <Heading>
            <StateName name={tag.definition.name} numeral={tag.romanNumeral} />
          </Heading>
          {characterName && (
            <p className="state-details-owner">
              <UserRound size={12} />
              {characterName}
            </p>
          )}
        </div>
      </header>
      <div className="state-details-meta">
        <span className={`state-details-duration ${finite ? 'is-finite' : ''}`}>
          {finite ? <Clock3 size={13} /> : <InfinityIcon size={14} />}
          {durationText(tag.remainingTurns)}
        </span>
        <span className="state-details-visibility">
          <Eye size={12} />
          {visibilityNames[tag.visibility]}
        </span>
      </div>
      <section className="state-details-section state-details-description">
        <h4>状态说明</h4>
        <TagMarkdown text={tag.detailsMarkdown} />
      </section>
      {!!tag.customFields?.length && (
        <section className="state-details-section">
          <h4>状态词条</h4>
          <dl className="state-details-fields">
            {tag.customFields.map((field) => (
              <div key={field.name}>
                <dt>{field.name}</dt>
                <dd data-numeric={typeof field.value === 'number'}>
                  {typeof field.value === 'number' && field.value > 0 ? '+' : ''}
                  {String(field.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}

export function StateHoverCard({
  hover,
  tag,
  characterName,
}: {
  hover: Pick<ReturnType<typeof useHoverPreview>, 'preview' | 'keep' | 'leave' | 'close'>;
  tag?: CharacterTag;
  characterName?: string;
}) {
  return tag && hover.preview ? (
    <HoverCard
      anchor={hover.preview.anchor}
      keep={hover.keep}
      leave={hover.leave}
      close={hover.close}
      label={`状态详情：${stateDisplayName(tag.definition.name, tag.romanNumeral)}`}
      className="state-hover-card"
    >
      <StateDetailsContent tag={tag} characterName={characterName} compact />
    </HoverCard>
  ) : null;
}
