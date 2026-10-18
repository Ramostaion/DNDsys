import StateName from './character-tags/StateName';
import CharacterInitiative from './turns/CharacterInitiative';
import { useState, type PointerEvent, type FocusEvent } from 'react';
import { sortCharacterTags, stateDisplayName } from '@dnd/shared';
import type { Snapshot } from '../api';
import { canCapability, canEditCharacter } from '../permissions';
import { useUI } from '../store';
import { TagIcon } from './character-tags/TagIcon';
import HoverCard, { useHoverPreview } from './HoverCard';
import CharacterAbilityDetails from './CharacterAbilityDetails';
import { CustomFieldsDetails } from './CustomFieldsEditor';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
export default function CharacterSkills({ p, character }: { p: Props; character: any }) {
  const open = useUI((state) => state.open);
  const hover = useHoverPreview();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const skills = (character.skills || []).filter(
    (skill: any) =>
      skill.kind !== 'SPECIAL' &&
      !p.snap.templates.some((template) => template.id === skill.templateId && template.kind === 'SPECIAL'),
  );
  const traits = (character.traits || []).filter(
    (trait: any) =>
      trait.kind !== 'SPECIAL' &&
      !p.snap.templates.some((template) => template.id === trait.templateId && template.kind === 'SPECIAL'),
  );
  const tags = sortCharacterTags((p.snap.characterTags || []).filter((tag) => tag.characterId === character.id));
  const candidates = [
    ...skills.map((ability: any) => ({ id: `skill:${ability.id}`, kind: '技能' as const, ability })),
    ...tags.map((ability) => ({ id: `state:${ability.id}`, kind: '状态' as const, ability })),
    ...traits.map((ability: any) => ({ id: `trait:${ability.id}`, kind: '特性' as const, ability })),
  ];
  // Always resolve against the latest permission-filtered snapshot; revoked content disappears immediately.
  const preview = candidates.find((candidate) => candidate.id === hover.preview?.id);
  const previewEvents = (id: string) => ({
    'data-ability-preview': id,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => hover.show(id, event.currentTarget),
    onPointerLeave: hover.leave,
    onFocus: (event: FocusEvent<HTMLElement>) => hover.show(id, event.currentTarget),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node) && !event.currentTarget.matches(':hover'))
        hover.leave();
    },
  });
  const canManage =
    canEditCharacter(p.snap, p.me.id, character) &&
    canCapability(p.snap, p.me.id, 'characterValues') &&
    canCapability(p.snap, p.me.id, 'templateInstall');
  const canToggle = canEditCharacter(p.snap, p.me.id, character);
  async function run(type: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await p.mutate(type, { characterId: character.id, ...payload });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="character-skills">
      <div className="sheet-section-heading">
        <h3>技能</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill: any) => (
          <span
            key={skill.id}
            className="badge"
            tabIndex={0}
            aria-label={`技能：${skill.name}`}
            {...previewEvents(`skill:${skill.id}`)}
          >
            {skill.name}
            <CustomFieldsDetails fields={skill.customFields} />
            {canManage && (
              <button
                className="ml-2"
                disabled={busy}
                aria-label={`移除技能：${skill.name}`}
                title={`移除${skill.name}`}
                onClick={() => void run('template.remove', { field: 'skills', instanceId: skill.id })}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!skills.length && <span className="tiny subtle">尚未添加技能。</span>}
      </div>
      <div className="sheet-section-heading mt-4">
        <h3>状态</h3>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="人物状态">
        {!tags.length && <span className="tiny subtle">暂无状态。</span>}
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="badge flex items-center gap-1"
            aria-label={`状态：${stateDisplayName(tag.definition.name, tag.romanNumeral)}`}
            {...previewEvents(`state:${tag.id}`)}
            style={{ color: tag.definition.color, borderColor: tag.definition.color }}
            onClick={() => {
              hover.close();
              open('tag-detail', tag.id);
            }}
          >
            <TagIcon icon={tag.definition.icon} size={14} />
            <StateName name={tag.definition.name} numeral={tag.romanNumeral} />
            {tag.remainingTurns != null && <strong className="ml-1">{tag.remainingTurns}</strong>}
          </button>
        ))}
      </div>
      <div className="sheet-section-heading mt-4">
        <h3>特性</h3>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="人物特性">
        {!traits.length && <span className="tiny subtle">尚未添加特性。</span>}
        {traits.map((trait: any) => (
          <span
            key={trait.id}
            className={`badge character-trait ${trait.enabled === false ? 'opacity-60' : ''}`}
            tabIndex={0}
            aria-label={`特性：${trait.name}`}
            {...previewEvents(`trait:${trait.id}`)}
          >
            <span className="tiny subtle mr-1">特性</span>
            {trait.name}
            {trait.enabled === false && <span className="ml-1">· 已停用</span>}
            {canToggle && (
              <>
                <button
                  className="ml-2"
                  disabled={busy}
                  aria-label={`${trait.enabled === false ? '启用' : '停用'}特性：${trait.name}`}
                  onClick={() =>
                    void run('template.enable', {
                      field: 'traits',
                      instanceId: trait.id,
                      enabled: trait.enabled === false,
                      version: character.version,
                    })
                  }
                >
                  {trait.enabled === false ? '启用' : '停用'}
                </button>
                {canManage && (
                  <button
                    className="ml-2"
                    disabled={busy}
                    aria-label={`移除特性：${trait.name}`}
                    title={`移除${trait.name}`}
                    onClick={() => void run('template.remove', { field: 'traits', instanceId: trait.id })}
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </span>
        ))}
      </div>
      {hover.preview && preview && (
        <HoverCard
          anchor={hover.preview.anchor}
          keep={hover.keep}
          leave={hover.leave}
          close={hover.close}
          label={`${preview.kind}详情：${preview.ability.name || preview.ability.definition?.name}`}
          className="character-ability-tooltip"
        >
          <CharacterAbilityDetails kind={preview.kind} ability={preview.ability} fields={p.snap.room.sheetSchema} />
        </HoverCard>
      )}
      {error && (
        <p role="alert" className="tiny text-red-300 mt-2">
          {error}
        </p>
      )}
      {p.isGM && <CharacterInitiative p={p} character={character} />}
    </section>
  );
}
