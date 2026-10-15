import { useEffect, useState } from 'react';
import { calculateSheet, validateSheetDefinitions, type SheetField, type SheetModifier } from '@dnd/shared';
import type { Snapshot } from '../api';
import HealthBarSettings from './HealthBarSettings';

type Props = {
  snap: Snapshot;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
const blank = (): SheetField => ({
  fieldId: '',
  name: '',
  type: 'number',
  group: '基础信息',
  sort: 0,
  defaultValue: 0,
  visibility: 'ALL',
  editableBy: 'GM',
});
export function modifiersFor(c: any): SheetModifier[] {
  const modifiers: SheetModifier[] = [];
  function add(data: any, kind: 'equipment' | 'trait' | 'buff', id: string, name: string, enabled = true) {
    if (data?.modifierRows?.length) {
      data.modifierRows.forEach((row: any, index: number) =>
        modifiers.push({
          id: `${kind}:${id}:${index}`,
          targetFieldId: row.targetFieldId,
          value: row.value,
          operation: row.operation,
          enabled,
          source: { kind, instanceId: id, name },
          priority: row.priority ?? index,
        }),
      );
    } else
      for (const [targetFieldId, value] of Object.entries(data?.modifiers || {}))
        if (typeof value === 'number')
          modifiers.push({
            id: `${kind}:${id}:${targetFieldId}`,
            targetFieldId,
            value,
            operation: 'ADD',
            enabled,
            source: { kind, instanceId: id, name },
          });
  }
  for (const entry of c.inventory || [])
    for (const equipped of entry.equipped || []) add(entry.item?.data, 'equipment', equipped.id, entry.item.name);
  for (const [kind, effects] of [
    ['trait', c.traits || []],
    ['buff', c.statuses || []],
  ] as const)
    for (const effect of effects) add(effect, kind, effect.id, effect.name, effect.enabled !== false);
  return modifiers;
}
export default function SheetManager({ snap, isGM, mutate }: Props) {
  const fields = (snap.room.sheetSchema || []) as SheetField[];
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<SheetField>(blank()),
    [baseVersion, setBaseVersion] = useState(snap.room.version),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [characterId, setCharacterId] = useState(''),
    [showHealth, setShowHealth] = useState(false);
  const character = snap.characters.find((c) => c.id === characterId) || snap.characters[0];
  useEffect(() => {
    const current = fields.find((f) => f.fieldId === selected);
    setDraft(current ? { ...current } : blank());
    setBaseVersion(snap.room.version);
  }, [selected]);
  function update(patch: Partial<SheetField>) {
    setDraft((value) => ({ ...value, ...patch }));
  }
  const exists = fields.some((f) => f.fieldId === selected);
  const next = exists ? fields.map((f) => (f.fieldId === selected ? draft : f)) : [...fields, draft];
  let preview: any = null,
    validation = '';
  try {
    if (draft.fieldId && draft.name) {
      validateSheetDefinitions(next);
      if (character) preview = calculateSheet(next, character.fieldValues || {}, modifiersFor(character));
    }
  } catch (e) {
    validation = (e as Error).message;
  }
  async function save() {
    setError('');
    setBusy(true);
    try {
      const result = await mutate('sheet.field.upsert', {
        version: baseVersion,
        field: { ...draft, editableBy: 'GM' },
      });
      setBaseVersion(result.roomVersion);
      setSelected(draft.fieldId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setError('');
    setBusy(true);
    try {
      await mutate('sheet.field.remove', { version: baseVersion, fieldId: selected });
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const numeric = fields.filter((f) => f.type === 'number' && f.fieldId !== draft.fieldId);
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <div className="eyebrow">ROOM CHARACTER SHEET</div>
          <h2 className="display-title text-xl">人物卡字段</h2>
        </div>
        {isGM && (
          <div className="flex gap-2">
            <button className="btn" aria-pressed={showHealth} onClick={() => setShowHealth(!showHealth)}>
              设置血条
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSelected(null);
                setDraft(blank());
                setBaseVersion(snap.room.version);
                setError('');
              }}
            >
              新建字段
            </button>
          </div>
        )}
      </div>
      <p className="tiny subtle">
        自由添加数值、文字和选项，按分组显示。字段及其数值仅 GM 可修改，已有角色数值不会重置。
      </p>
      {isGM && showHealth && <HealthBarSettings snap={snap} mutate={mutate} />}
      <div className="space-y-2">
        {[...fields]
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((field) => (
            <button
              key={field.fieldId}
              className={`grid-card w-full text-left flex justify-between ${selected === field.fieldId ? '!border-amber-400' : ''}`}
              onClick={() => setSelected(field.fieldId)}
            >
              <span>
                <strong>{field.name}</strong>
                <span className="tiny subtle ml-2">
                  {field.group || '其他'} · {field.fieldId}
                </span>
              </span>
              <span className="badge">
                {{ number: '数值', text: '文字', boolean: '是/否', select: '选项' }[field.type]}
              </span>
            </button>
          ))}
      </div>
      {isGM && (
        <div className="panel p-4 rounded-lg space-y-3">
          <div className="font-semibold">{exists ? '编辑字段' : '新增字段'}</div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">字段标识</span>
              <input
                className="input"
                value={draft.fieldId}
                disabled={exists}
                placeholder="例如 spirit"
                onChange={(e) => update({ fieldId: e.target.value.trim() })}
              />
            </label>
            <label>
              <span className="label">显示名称</span>
              <input
                className="input"
                value={draft.name}
                placeholder="例如 魂力"
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              <span className="label">类型</span>
              <select
                className="input"
                value={draft.type}
                onChange={(e) => {
                  const type = e.target.value as SheetField['type'];
                  update({
                    type,
                    formula: undefined,
                    defaultValue: type === 'number' ? 0 : type === 'boolean' ? false : undefined,
                  });
                }}
              >
                <option value="number">数值</option>
                <option value="text">文本</option>
                <option value="boolean">是/否</option>
                <option value="select">选项</option>
              </select>
            </label>
            <label>
              <span className="label">分组</span>
              <input className="input" value={draft.group || ''} onChange={(e) => update({ group: e.target.value })} />
            </label>
            <label>
              <span className="label">顺序</span>
              <input
                className="input"
                type="number"
                value={draft.sort ?? 0}
                onChange={(e) => update({ sort: Number(e.target.value) })}
              />
            </label>
            <label>
              <span className="label">可见范围</span>
              <select
                className="input"
                value={draft.visibility || 'ALL'}
                onChange={(e) => update({ visibility: e.target.value as SheetField['visibility'] })}
              >
                <option value="ALL">全房间</option>
                <option value="OWNER">角色控制者与 GM</option>
                <option value="GM">仅 GM</option>
              </select>
            </label>
          </div>
          {draft.type === 'number' && (
            <>
              <div>
                <label>
                  <span className="label">默认值</span>
                  <input
                    className="input"
                    type="number"
                    disabled={Boolean(draft.formula)}
                    value={typeof draft.defaultValue === 'number' ? draft.defaultValue : 0}
                    onChange={(e) => update({ defaultValue: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="flex gap-2 items-center tiny">
                <input
                  type="checkbox"
                  checked={draft.isResource === true}
                  onChange={(e) => update({ isResource: e.target.checked })}
                />
                以“当前值 / 上限值”显示
              </label>
              {draft.isResource && (
                <label>
                  <span className="label">上限字段</span>
                  <select
                    className="input"
                    value={draft.maxFieldId || ''}
                    onChange={(e) => update({ maxFieldId: e.target.value || undefined })}
                  >
                    <option value="">无上限</option>
                    {numeric.map((f) => (
                      <option key={f.fieldId} value={f.fieldId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {draft.type === 'select' && (
            <label>
              <span className="label">选项（每行一个）</span>
              <textarea
                className="input"
                value={(draft.options || []).join('\n')}
                onChange={(e) =>
                  update({
                    options: e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          )}
          {draft.type === 'text' && (
            <label>
              <span className="label">默认文字</span>
              <input
                className="input"
                value={typeof draft.defaultValue === 'string' ? draft.defaultValue : ''}
                onChange={(e) => update({ defaultValue: e.target.value })}
              />
            </label>
          )}
          <div className="border-t border-amber-800/40 pt-3">
            <span className="label">预览角色</span>
            <select className="input" value={character?.id || ''} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">选择角色</option>
              {snap.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {draft.fieldId && (
              <p className="tiny mt-2">
                {validation ? (
                  <span className="text-red-300">{validation}</span>
                ) : preview?.errors?.[draft.fieldId] ? (
                  <span className="text-red-300">{preview.errors[draft.fieldId]}</span>
                ) : (
                  <span className="text-emerald-300">
                    {draft.name || draft.fieldId} = {String(preview?.values?.[draft.fieldId] ?? '尚无角色')}
                  </span>
                )}
              </p>
            )}
          </div>
          {snap.room.version !== baseVersion && (
            <div className="grid-card tiny text-amber-300">
              房间字段已由其他客户端更新。当前输入已保留；请载入最新版本后再保存。
              <button
                className="btn mt-2"
                onClick={() => {
                  setDraft(fields.find((f) => f.fieldId === selected) || blank());
                  setBaseVersion(snap.room.version);
                }}
              >
                载入最新版本
              </button>
            </div>
          )}
          {error && <p className="text-red-300 tiny">{error}</p>}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={
                busy || snap.room.version !== baseVersion || !draft.fieldId || !draft.name || Boolean(validation)
              }
              onClick={() => void save()}
            >
              {busy ? '保存中…' : '保存字段'}
            </button>
            {exists && (
              <button
                className="btn btn-danger ml-auto"
                disabled={busy || snap.room.version !== baseVersion}
                onClick={() => void remove()}
              >
                删除字段
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
