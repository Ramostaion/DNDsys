import { useEffect, useState } from 'react';
import { TAG_DETAILS_MAX, type TagDefinition, type TagVisibility } from '@dnd/shared';
import { IconPicker, VisibilitySelect } from './TagIcon';
import { useDraftProtection } from './useDraftProtection';
import type { TagProps } from './types';
const initial = (definition?: TagDefinition) => ({
  name: definition?.name || '',
  icon: definition?.icon || 'clue',
  color: definition?.color || '#c69452',
  templateDescription: definition?.templateDescription || '',
  defaultVisibility: definition?.defaultVisibility || ('GM_ONLY' as TagVisibility),
  defaultPriority: definition?.defaultPriority || 0,
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
      <h2 className="display-title text-xl">{definition ? '编辑标签定义' : '新建标签定义'}</h2>
      <label>
        <span className="label">标签名称</span>
        <input
          className="input"
          aria-label="标签名称"
          value={draft.name}
          maxLength={80}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
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
      <p className="tiny subtle">
        初稿仅在新分配时复制一次。更新名称、图标、颜色会改变已有标签外观，不会覆盖任何角色的独立详情。
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
          {busy ? '保存中…' : '保存标签定义'}
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
            if (!dirty || confirm('放弃未保存的标签定义？')) onDone();
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
