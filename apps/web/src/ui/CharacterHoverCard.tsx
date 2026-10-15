import type { Snapshot } from '../api';
import { characterHealth, characterShield } from './character-summary';
import ResourceBar from './ResourceBar';

export default function CharacterHoverCard({ snap, character }: { snap: Snapshot; character: any }) {
  const health = characterHealth(snap, character),
    shield = characterShield(snap, character),
    values = character.derived?.values || {};
  const owner = snap.members.find((member) => member.userId === character.ownerId)?.user.username;
  const basics = (snap.room.sheetSchema || [])
    .filter((field: any) => field.type === 'text' || field.type === 'select' || /基础|基本/.test(field.group || ''))
    .filter((field: any) => Object.hasOwn(values, field.fieldId) && !field.isResource)
    .slice(0, 8);
  const entries = ['traits', 'skills', 'statuses'].flatMap((field) =>
    (character[field] || []).map((entry: any) => ({
      ...entry,
      field,
      kind: entry.kind || snap.templates.find((template) => template.id === entry.templateId)?.kind,
    })),
  );
  const sections = [
    { name: '特性', list: entries.filter((entry) => entry.field === 'traits' && entry.kind !== 'SPECIAL') },
    { name: '技能', list: entries.filter((entry) => entry.field === 'skills' && entry.kind !== 'SPECIAL') },
    { name: 'Buff / 状态', list: entries.filter((entry) => entry.field === 'statuses' && entry.kind !== 'SPECIAL') },
    { name: '特殊机制', list: entries.filter((entry) => entry.kind === 'SPECIAL') },
  ];
  return (
    <div className="character-hover-content">
      <header className="flex items-center gap-3">
        {character.avatarUrl ? (
          <img className="hover-avatar" src={character.avatarUrl} alt="" />
        ) : (
          <div className="hover-avatar grid place-items-center">{character.name.slice(0, 1)}</div>
        )}
        <div>
          <h3 className="font-semibold text-lg">{character.name}</h3>
          <p className="tiny subtle">{character.isNpc ? 'NPC · GM 控制' : owner ? `玩家：${owner}` : '未分配玩家'}</p>
        </div>
      </header>
      {shield && <ResourceBar resource={shield} kind="shield" />}
      {health ? <ResourceBar resource={health} kind="health" /> : <p className="tiny subtle">暂无可见生命数据</p>}
      {basics.length > 0 && (
        <dl className="hover-basics">
          {basics.map((field: any) => (
            <div key={field.fieldId}>
              <dt>{field.name}</dt>
              <dd>{String(values[field.fieldId] ?? '—')}</dd>
            </div>
          ))}
        </dl>
      )}
      {!snap.room.sheetMode && (
        <p className="tiny subtle">
          等级 {character.level} · 防御 {values.防御 ?? '—'}
        </p>
      )}
      {sections.map((section) => (
        <section key={section.name}>
          <h4 className="text-sm font-semibold text-amber-200 mb-1">{section.name}</h4>
          {section.list.length ? (
            <div className="space-y-1">
              {section.list.map((entry: any) => (
                <div key={entry.id} className={`hover-ability ${entry.enabled === false ? 'opacity-60' : ''}`}>
                  <strong className="text-sm">
                    {entry.name}
                    {entry.enabled === false ? ' · 已停用' : ''}
                  </strong>
                  {entry.description && <p className="tiny subtle whitespace-pre-wrap">{entry.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="tiny subtle">暂无</p>
          )}
        </section>
      ))}
      {character.description && (
        <section>
          <h4 className="text-sm font-semibold text-amber-200 mb-1">故事与特殊规则</h4>
          <p className="tiny subtle whitespace-pre-wrap">{character.description}</p>
        </section>
      )}
    </div>
  );
}
