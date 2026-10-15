import { useState } from 'react';
import { sortCharacterTags } from '@dnd/shared';
import type { Snapshot } from '../api';
import { canCapability, canEditCharacter } from '../permissions';
import { useUI } from '../store';
import { TagIcon } from './character-tags/TagIcon';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
export default function CharacterSkills({ p, character }: { p: Props; character: any }) {
  const open = useUI((state) => state.open);
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
  const canManage =
    canEditCharacter(p.snap, p.me.id, character) &&
    canCapability(p.snap, p.me.id, 'characterValues') &&
    canCapability(p.snap, p.me.id, 'templateInstall');
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
        <h3>技能·标签·特性</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill: any) => (
          <span key={skill.id} className="badge" title={skill.description}>
            {skill.name}
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
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="badge flex items-center gap-1"
            aria-label={`技能栏标签：${tag.definition.name}`}
            title="查看此角色的标签备注"
            style={{ color: tag.definition.color, borderColor: tag.definition.color }}
            onClick={() => open('tag-detail', tag.id)}
          >
            <TagIcon icon={tag.definition.icon} size={14} />
            {tag.definition.name}
          </button>
        ))}
        {traits.map((trait: any) => (
          <span
            key={trait.id}
            className={`badge character-trait ${trait.enabled === false ? 'opacity-60' : ''}`}
            title={trait.description}
          >
            <span className="tiny subtle mr-1">特性</span>
            {trait.name}
            {trait.enabled === false && <span className="ml-1">· 已停用</span>}
            {canManage && (
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
                <button
                  className="ml-2"
                  disabled={busy}
                  aria-label={`移除特性：${trait.name}`}
                  title={`移除${trait.name}`}
                  onClick={() => void run('template.remove', { field: 'traits', instanceId: trait.id })}
                >
                  ×
                </button>
              </>
            )}
          </span>
        ))}
        {!skills.length && !tags.length && !traits.length && (
          <span className="tiny subtle">尚未添加技能、标签或特性。</span>
        )}
      </div>
      {error && (
        <p role="alert" className="tiny text-red-300 mt-2">
          {error}
        </p>
      )}
    </section>
  );
}
