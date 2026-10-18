import { useEffect, useState } from 'react';
import { canEditSheetField, resourceField, roomMemberName, type SheetField } from '@dnd/shared';
import { Backpack, Shirt, BookOpen } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import { CharacterTagManageButton } from './character-tags/CharacterTagBadges';
import CharacterAvatar from './CharacterAvatar';
import NpcSearchControl from './NpcSearchControl';
import ValueSource from './ValueSource';
import CharacterSkills from './CharacterSkills';
import { useSyncedText } from './useSyncedText';
import { canEditCharacter, canEditBasics, canViewInventory } from '../permissions';
import ResourceMeter from './ResourceMeter';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<unknown>;
};
function FieldValue({ p, c, field }: { p: Props; c: any; field: SheetField }) {
  const raw = c.fieldValues?.[field.fieldId] ?? field.defaultValue ?? null;
  const effective = c.derived?.values?.[field.fieldId];
  const [draft, setDraft] = useState(String(raw ?? '')),
    [delta, setDelta] = useState('1'),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => setDraft(String(raw ?? '')), [raw]);
  const can = canEditSheetField(
    p.snap.room,
    p.snap.members.find((member) => member.userId === p.me.id),
    c,
    p.me.id,
    field,
    p.snap.room.sheetSchema || [],
  );
  const sources = c.derived?.sources?.[field.fieldId] || [];
  const shield = resourceField(p.snap.room.sheetSchema || [], 'shield');
  const isShieldField = field.fieldId === shield?.fieldId || field.fieldId === shield?.maxFieldId;
  async function submit(type: 'character.field.set' | 'character.field.adjust', value: unknown) {
    setBusy(true);
    setError('');
    try {
      await p.mutate(type, {
        characterId: c.id,
        fieldId: field.fieldId,
        version: c.version,
        reason,
        ...(type === 'character.field.adjust' ? { delta: value } : { value }),
      });
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const max = field.maxFieldId ? c.derived?.values?.[field.maxFieldId] : null;
  return (
    <div
      className={`grid-card sheet-field space-y-2 ${field.isResource ? 'is-resource' : ''}`}
      data-field-id={field.fieldId}
      data-field-type={field.type}
      data-resource={field.isResource ? (isShieldField ? 'shield' : 'health') : undefined}
    >
      <div className="flex justify-between gap-3 sheet-field-heading">
        <div className="sheet-field-name">
          <strong>{field.name}</strong>
          {!isShieldField && <span className="tiny subtle ml-2 sheet-field-id">{field.fieldId}</span>}
        </div>
        <div className="flex items-center gap-2">
          <strong className="text-amber-300 sheet-field-value">
            {effective === undefined ? '—' : String(effective)}
            {field.isResource && p.isGM && typeof max === 'number' && <small>{` / ${max}`}</small>}
          </strong>
          {field.type === 'number' && (
            <ValueSource name={field.name} base={raw} trace={c.derived?.breakdown?.[field.fieldId]} sources={sources} />
          )}
        </div>
      </div>
      {field.type === 'number' && field.isResource && typeof max === 'number' && typeof effective === 'number' && (
        <ResourceMeter
          value={effective}
          maximum={max}
          identity={`${c.id}:${field.fieldId}`}
          showMaximum={p.isGM}
          kind={field.resourceKind === 'shield' ? 'shield' : 'health'}
        />
      )}
      {can && (
        <>
          <div className="flex gap-2 items-center sheet-field-controls">
            {field.type === 'number' ? (
              <>
                <input
                  className="input !w-16 flex-none"
                  type="number"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={`${field.name}原始值`}
                />
                <button
                  className="btn whitespace-nowrap flex-none"
                  disabled={busy || !Number.isFinite(Number(draft))}
                  onClick={() => void submit('character.field.set', Number(draft))}
                >
                  设定
                </button>
                <input
                  className="input !w-14 flex-none"
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  aria-label={`${field.name}增减量`}
                />
                <button
                  className="btn whitespace-nowrap flex-none"
                  disabled={busy || !Number.isFinite(Number(delta))}
                  onClick={() => void submit('character.field.adjust', -Number(delta))}
                >
                  −
                </button>
                <button
                  className="btn whitespace-nowrap flex-none"
                  disabled={busy || !Number.isFinite(Number(delta))}
                  onClick={() => void submit('character.field.adjust', Number(delta))}
                >
                  +
                </button>
              </>
            ) : field.type === 'boolean' ? (
              <label className="tiny flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={raw === true}
                  onChange={(e) => void submit('character.field.set', e.target.checked)}
                />
                启用
              </label>
            ) : field.type === 'select' ? (
              <select
                className="input"
                value={String(raw ?? '')}
                onChange={(e) => void submit('character.field.set', e.target.value)}
              >
                <option value="">请选择</option>
                {field.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <>
                <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button className="btn" disabled={busy} onClick={() => void submit('character.field.set', draft)}>
                  保存
                </button>
              </>
            )}
          </div>
          <input
            className="input !py-1 tiny"
            placeholder="变更原因（可选，写入日志）"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      )}
      {field.formula && <p className="tiny subtle">此历史字段由原模板计算，已有数值继续保留。</p>}
      {c.derived?.agility?.fieldId === field.fieldId && (
        <p className="tiny text-sky-200">
          当前有效敏捷 {c.derived.agility.effective} · 敏捷属性加值 {c.derived.agility.bonus >= 0 ? '+' : ''}
          {c.derived.agility.bonus}
        </p>
      )}
      {!can && !field.formula && <p className="tiny subtle">仅 GM 可修改此字段。</p>}
      {error && <p className="tiny text-red-300">{error}。请刷新后重试。</p>}
    </div>
  );
}
export function ShieldSection({ p, c }: { p: Props; c: any }) {
  const fields = p.snap.room.sheetSchema || [];
  const shield = resourceField(fields, 'shield');
  if (!shield || !Object.hasOwn(c.derived?.values || {}, shield.fieldId)) return null;
  return (
    <section className="shield-section" aria-label="角色护盾">
      <div className="sheet-section-heading">
        <h3>护盾</h3>
      </div>
      <div className="sheet-fields is-resources">
        {[shield, ...(p.isGM ? fields.filter((field: SheetField) => field.fieldId === shield.maxFieldId) : [])].map(
          (field) => (
            <FieldValue key={field.fieldId} p={p} c={c} field={field} />
          ),
        )}
      </div>
    </section>
  );
}

export default function ConfigurableSheet({ p, c }: { p: Props; c: any }) {
  const open = useUI((s) => s.open);
  const [name, setName] = useSyncedText(c.name, c.id),
    [description, setDescription] = useSyncedText(c.description, c.id),
    [error, setError] = useState('');
  const can = canEditBasics(p.snap, p.me.id, c),
    inventoryVisible = canViewInventory(p.snap, p.me.id, c);
  const health = resourceField(p.snap.room.sheetSchema || [], 'health');
  const shield = resourceField(p.snap.room.sheetSchema || [], 'shield');
  const fields = (p.snap.room.sheetSchema || []).filter(
    (f: SheetField) =>
      f.fieldId !== shield?.fieldId &&
      f.fieldId !== shield?.maxFieldId &&
      (p.isGM ||
        (f.fieldId !== health?.maxFieldId &&
          f.visibility !== 'GM' &&
          (f.visibility !== 'OWNER' || canEditCharacter(p.snap, p.me.id, c)))),
  ) as SheetField[];
  const healthFields = fields.filter(
    (f) => f.fieldId === health?.fieldId || f.fieldId === health?.maxFieldId || f.group === '生命',
  );
  const otherFields = fields.filter((f) => !healthFields.includes(f));
  const sections = [
    ...(healthFields.length ? [{ name: '生命', fields: healthFields }] : []),
    ...[...new Set(otherFields.map((f) => f.group || '其他'))].map((name) => ({
      name,
      fields: otherFields.filter((f) => (f.group || '其他') === name),
    })),
  ];
  async function patch(value: Record<string, unknown>) {
    try {
      setError('');
      await p.mutate('character.update', { id: c.id, version: c.version, patch: value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="character-sheet sheet-configurable space-y-5">
      <div className="sheet-hero">
        <CharacterAvatar p={p} character={c} />
        <div className="flex-1 min-w-0 sheet-identity">
          <div className="eyebrow">{c.isNpc ? 'GM CONTROLLED NPC' : 'ADVENTURER DOSSIER'}</div>
          <input
            className="sheet-name"
            aria-label="角色名称"
            value={name}
            disabled={!can}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== c.name && void patch({ name: name.trim() })}
          />
          <div className="tiny subtle">
            {c.isNpc
              ? 'NPC · 仅 GM 可控制'
              : `${roomMemberName(
                  p.snap.members.find((m) => m.userId === c.ownerId),
                  '未分配玩家',
                )} 的角色`}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sheet-actions">
        <button className="btn" onClick={() => open('templates', c.id)}>
          <BookOpen size={15} />
          技能
        </button>
        <CharacterTagManageButton characterId={c.id} isGM={p.isGM} />
        {p.isGM && (
          <button className="btn" onClick={() => open('sheet')}>
            编辑人物卡
          </button>
        )}
        {inventoryVisible && (
          <>
            <button className="btn" onClick={() => open('inventory', c.id)}>
              <Backpack size={15} />
              背包
            </button>
            <button className="btn" onClick={() => open('equipment', c.id)}>
              <Shirt size={15} />
              装备
            </button>
          </>
        )}
      </div>
      <NpcSearchControl character={c} isGM={p.isGM} mutate={p.mutate} />
      {!inventoryVisible && (
        <p className="tiny subtle">
          {c.isNpc
            ? 'NPC 生命归零且 GM 允许搜索后，才能查看背包和装备。'
            : c.ownerId === p.me.id
              ? '生命归零后无法打开自己的背包和装备，其他玩家可拾取物品。'
              : '该角色的背包和装备由 GM 隐藏。'}
        </p>
      )}
      <ShieldSection p={p} c={c} />
      {sections.map((section) => (
        <section key={section.name}>
          <div className="sheet-section-heading">
            <h3>{section.name}</h3>
          </div>
          <div className={`sheet-fields ${section.name === '生命' ? 'is-resources' : ''}`}>
            {section.fields
              .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
              .map((field) => (
                <FieldValue key={field.fieldId} p={p} c={c} field={field} />
              ))}
          </div>
        </section>
      ))}
      {!fields.length && (
        <div className="empty-note">这个房间还没有人物卡字段。GM 可点击“编辑人物卡”添加数值、文字，或设置血条。</div>
      )}
      <section>
        <div className="sheet-section-heading">
          <h3>故事与特殊机制</h3>
        </div>
        <textarea
          className="input min-h-24"
          aria-label="角色描述"
          value={description}
          disabled={!p.isGM}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== c.description && void patch({ description })}
          placeholder="角色背景、特殊规则…"
        />
      </section>
      <CharacterSkills p={p} character={c} />
      {error && <p className="text-red-300 tiny">{error}</p>}
    </div>
  );
}
