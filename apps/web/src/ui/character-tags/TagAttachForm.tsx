import { useState } from 'react';
import { TAG_DETAILS_MAX, type TagDefinition } from '@dnd/shared';
import type { TagProps } from './types';
import { VisibilitySelect, TagIcon } from './TagIcon';
import TagMarkdown from './TagMarkdown';
import { useDraftProtection } from './useDraftProtection';
export default function TagAttachForm({
  p,
  definition,
  characterId,
  windowId,
  onDone,
}: {
  p: TagProps;
  definition: TagDefinition;
  characterId?: string;
  windowId: string;
  onDone: (attached?: boolean) => void;
}) {
  const [details, setDetails] = useState(definition.templateDescription),
    [visibility, setVisibility] = useState(definition.defaultVisibility),
    [priority, setPriority] = useState(definition.defaultPriority),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false);
  const dirty =
    details !== definition.templateDescription ||
    visibility !== definition.defaultVisibility ||
    priority !== definition.defaultPriority ||
    selected.length > 0;
  useDraftProtection(windowId, dirty);
  async function attach() {
    setBusy(true);
    setError('');
    try {
      await p.mutate(characterId ? 'characterTag.attach' : 'characterTag.attachBatch', {
        tagDefinitionId: definition.id,
        definitionVersion: definition.version,
        detailsMarkdown: details,
        visibility,
        priority,
        ...(characterId ? { characterId } : { characterIds: selected }),
      });
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tag-attach-form space-y-4">
      <div className="tag-card-heading">
        <span style={{ color: definition.color }}>
          <TagIcon icon={definition.icon} size={24} />
        </span>
        <h3>{definition.name}</h3>
      </div>
      {!characterId && (
        <fieldset className="tag-batch-list">
          <legend className="label">选择角色（已拥有该标签的角色会跳过）</legend>
          {p.snap.characters.map((c) => {
            const attached = p.snap.characterTags.some(
              (t) => t.characterId === c.id && t.tagDefinitionId === definition.id,
            );
            return (
              <label key={c.id} className="flex gap-2 items-center py-1">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  disabled={attached}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
                  }
                />
                {c.name}
                {attached && <span className="tiny subtle">已拥有</span>}
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="tag-form-grid">
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        <label>
          <span className="label">展示优先级</span>
          <input
            className="input"
            aria-label="展示优先级"
            type="number"
            min="-100"
            max="100"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
      </div>
      {visibility === 'PUBLIC' && <p className="tag-public-notice">分配后，能查看角色的房间成员都能阅读完整备注。</p>}
      <div className="flex justify-between items-center">
        <span className="label">角色专属详细备注</span>
        <button className="btn tiny" onClick={() => setPreview(!preview)}>
          {preview ? '继续编辑' : '预览备注'}
        </button>
      </div>
      {preview ? (
        <div className="tag-preview">
          <TagMarkdown text={details} />
        </div>
      ) : (
        <textarea
          className="input tag-details-input"
          aria-label="角色专属详细备注"
          value={details}
          maxLength={TAG_DETAILS_MAX}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="填写此角色独立的剧情秘密与 GM 备忘…"
        />
      )}
      <p className="tiny subtle">
        {characterId ? '这份备注只属于当前角色。' : '为每个选中角色分别复制一份初稿，之后可独立编辑。'}
        标签不会改变属性、资源或战斗。
      </p>
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}，输入已保留。
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || (!characterId && !selected.length)}
          onClick={() => void attach()}
        >
          {busy ? '分配中…' : characterId ? '添加到此角色' : `分配给 ${selected.length} 个角色`}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm('取消分配会丢弃未保存草稿，确定取消？')) onDone(false);
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
