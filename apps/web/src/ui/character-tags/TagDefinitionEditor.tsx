import StateName, { RomanNumeralSelect } from './StateName';
import DurationInput from './DurationInput';
import { useEffect, useState } from 'react';
import { TAG_DETAILS_MAX, type TagDefinition, type TagVisibility } from '@dnd/shared';
import { IconPicker, VisibilitySelect } from './TagIcon';
import { useDraftProtection } from './useDraftProtection';
import CustomFieldsEditor from '../CustomFieldsEditor';
import { validateItemFields } from '../item-fields';
import type { TagProps } from './types';
const initial = (definition?: TagDefinition) => ({
  name: definition?.name || '',
  romanNumeral: definition?.romanNumeral || '',
  icon: definition?.icon || 'clue',
  color: definition?.color || '#c69452',
  templateDescription: definition?.templateDescription || '',
  defaultVisibility: definition?.defaultVisibility || ('PUBLIC' as TagVisibility),
  defaultPriority: definition?.defaultPriority || 0,
  defaultDurationTurns: definition?.defaultDurationTurns ?? null,
  customFields: definition?.customFields || [],
});
export default function TagDefinitionEditor({
  p,
  definition,
  windowId,
  onDone,
}: {
  p: TagProps;
  definition?: TagDefinition;
  windowId: string;
  onDone: (id?: string) => void;
}) {
  const [draft, setDraft] = useState(initial(definition)),
    [base, setBase] = useState(draft),
    [version, setVersion] = useState(definition?.version ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useDraftProtection(windowId, dirty);
  const conflict = !!definition && definition.version !== version;
  useEffect(() => {
    if (!dirty && definition && definition.version !== version) {
      const next = initial(definition);
      setDraft(next);
      setBase(next);
      setVersion(definition.version);
    }
  }, [definition, dirty, version]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await p.mutate(definition ? 'tagDefinition.update' : 'tagDefinition.create', {
        ...draft,
        customFields: validateItemFields(draft.customFields),
        ...(definition ? { id: definition.id, version } : {}),
      });
      setBase(draft);
      onDone(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tag-definition-editor space-y-4">
      <h2 className="display-title text-xl">{definition ? '编辑状态定义' : '新建状态定义'}</h2>
      <label>
        <span className="label">状态名称</span>
        <input
          className="input"
          aria-label="状态名称"
          value={draft.name}
          maxLength={80}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <RomanNumeralSelect
        value={draft.romanNumeral}
        onChange={(romanNumeral) => setDraft({ ...draft, romanNumeral })}
        disabled={busy}
      />
      <p className="tiny subtle">
        名称预览：
        <StateName name={draft.name || '状态名称'} numeral={draft.romanNumeral} />
      </p>
      <p className="tiny subtle">罗马数字在新分配时复制到人物状态，可单独修改，仅作名称展示。</p>
      <IconPicker
        icon={draft.icon}
        color={draft.color}
        onIcon={(icon) => setDraft({ ...draft, icon })}
        onColor={(color) => setDraft({ ...draft, color })}
      />
      <div className="tag-form-grid">
        <VisibilitySelect
          label="默认可见范围"
          value={draft.defaultVisibility}
          onChange={(defaultVisibility) => setDraft({ ...draft, defaultVisibility })}
        />
        <label>
          <span className="label">默认优先级</span>
          <input
            className="input"
            type="number"
            min="-100"
            max="100"
            aria-label="默认优先级"
            value={draft.defaultPriority}
            onChange={(e) => setDraft({ ...draft, defaultPriority: Number(e.target.value) })}
          />
        </label>
      </div>
      <label>
        <span className="label">新分配时的备注初稿（可选）</span>
        <textarea
          className="input min-h-32"
          aria-label="备注初稿"
          maxLength={TAG_DETAILS_MAX}
          value={draft.templateDescription}
          onChange={(e) => setDraft({ ...draft, templateDescription: e.target.value })}
        />
      </label>
      <DurationInput
        label="持续回合数"
        value={draft.defaultDurationTurns}
        onChange={(defaultDurationTurns) => setDraft({ ...draft, defaultDurationTurns })}
      />
      <p className="tiny subtle">持续时间仅在新分配时复制，已有角色的剩余回合不受影响。</p>
      <CustomFieldsEditor
        fields={draft.customFields}
        onChange={(customFields) => setDraft({ ...draft, customFields })}
        disabled={busy}
        hint="数值词条与基础信息名称一致时自动加成；文字仅作记录。分配时复制到角色，可独立修改。"
      />
      <p className="tiny subtle">
        初稿仅在新分配时复制一次。更新名称、图标、颜色会改变已有状态外观，不会覆盖任何角色的独立详情。
      </p>
      {conflict && <div className="tag-conflict">定义已被其他窗口更新；当前草稿已保留。</div>}
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || !draft.name.trim() || !draft.icon || conflict}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存状态定义'}
        </button>
        {conflict && (
          <button
            className="btn"
            onClick={() => {
              if (confirm('丢弃当前定义草稿并重新加载？')) {
                const next = initial(definition);
                setDraft(next);
                setBase(next);
                setVersion(definition!.version);
                setError('');
              }
            }}
          >
            重新加载
          </button>
        )}
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm('放弃未保存的状态定义？')) onDone();
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
