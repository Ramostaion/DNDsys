import StateDetailsContent from './character-tags/StateDetailsContent';
import type { SheetField } from '@dnd/shared';
import { CustomFieldsDetails } from './CustomFieldsEditor';
import './character-ability-details.css';

export default function CharacterAbilityDetails({
  kind,
  ability,
  fields = [],
}: {
  kind: '技能' | '状态' | '特性';
  ability: any;
  fields?: SheetField[];
}) {
  const name = kind === '状态' ? ability.definition.name : ability.name;
  if (kind === '状态') return <StateDetailsContent tag={ability} compact />;
  const modifiers =
    Array.isArray(ability.modifierRows) && ability.modifierRows.length
      ? ability.modifierRows.map((row: any) => ({ id: row.targetFieldId, operation: row.operation, value: row.value }))
      : Object.entries(ability.modifiers || {}).map(([id, value]) => ({ id, operation: 'ADD', value }));
  return (
    <div className="character-ability-details">
      <header>
        <span className="eyebrow">{kind}</span>
        <h3>{name}</h3>
        {kind === '特性' && <span className="badge">{ability.enabled === false ? '已停用' : '已启用'}</span>}
      </header>
      <p className="whitespace-pre-wrap">{ability.description || '暂无说明。'}</p>
      <CustomFieldsDetails fields={ability.customFields} />
      {kind !== '技能' && modifiers.length > 0 && (
        <section>
          <h4 className="label">属性修正</h4>
          <dl className="item-detail-fields">
            {modifiers
              .filter((row: any) => typeof row.value === 'number' && Number.isFinite(row.value))
              .map((row: any, index: number) => (
                <div key={index}>
                  <dt>{fields.find((field) => field.fieldId === row.id)?.name || row.id}</dt>
                  <dd>
                    {row.operation === 'MULTIPLY'
                      ? '×'
                      : row.operation === 'OVERRIDE'
                        ? '='
                        : row.value >= 0
                          ? '+'
                          : ''}
                    {row.value}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}
    </div>
  );
}
