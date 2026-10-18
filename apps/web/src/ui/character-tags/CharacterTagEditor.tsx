import StateName, { RomanNumeralSelect } from './StateName';
import DurationInput from './DurationInput';
import { useEffect, useState } from 'react';
import { TAG_DETAILS_MAX, type CharacterTag, type TagVisibility } from '@dnd/shared';
import { VisibilitySelect, TagIcon, visibilityNames } from './TagIcon';
import TagMarkdown from './TagMarkdown';
import { useDraftProtection } from './useDraftProtection';
import CustomFieldsEditor from '../CustomFieldsEditor';
import { validateItemFields } from '../item-fields';
import type { TagProps } from './types';
export default function CharacterTagEditor({
  p,
  tag,
  windowId,
  onBack,
  removed = false,
}: {
  p: TagProps;
  tag: CharacterTag;
  windowId: string;
  onBack?: () => void;
  removed?: boolean;
}) {
  const [draft, setDraft] = useState({
    detailsMarkdown: tag.detailsMarkdown,
    visibility: tag.visibility,
    priority: tag.priority,
    sortOrder: tag.sortOrder,
    customFields: tag.customFields || [],
    remainingTurns: tag.remainingTurns ?? null,
    romanNumeral: tag.romanNumeral || '',
  });
  const [base, setBase] = useState(draft),
    [version, setVersion] = useState(tag.version),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useDraftProtection(windowId, dirty);
  function reload() {
    const next = {
      detailsMarkdown: tag.detailsMarkdown,
      visibility: tag.visibility,
      priority: tag.priority,
      sortOrder: tag.sortOrder,
      customFields: tag.customFields || [],
      remainingTurns: tag.remainingTurns ?? null,
      romanNumeral: tag.romanNumeral || '',
    };
    setDraft(next);
    setBase(next);
    setVersion(tag.version);
    setError('');
    setMessage('已加载最新内容');
  }
  useEffect(() => {
    if (!dirty && version !== tag.version) {
      const next = {
        detailsMarkdown: tag.detailsMarkdown,
        visibility: tag.visibility,
        priority: tag.priority,
        sortOrder: tag.sortOrder,
        customFields: tag.customFields || [],
        remainingTurns: tag.remainingTurns ?? null,
        romanNumeral: tag.romanNumeral || '',
      };
      setDraft(next);
      setBase(next);
      setVersion(tag.version);
    }
  }, [
    tag.version,
    tag.detailsMarkdown,
    tag.visibility,
    tag.priority,
    tag.sortOrder,
    tag.customFields,
    tag.remainingTurns,
    tag.romanNumeral,
    dirty,
    version,
  ]);
  async function save() {
    if (removed) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await p.mutate('characterTag.update', {
        id: tag.id,
        version,
        ...draft,
        customFields: validateItemFields(draft.customFields),
      });
      setVersion(result.version);
      setBase(draft);
      setMessage('保存成功');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tag-editor space-y-4">
      <div className="tag-card-heading">
        <span style={{ color: tag.definition.color }}>
          <TagIcon icon={tag.definition.icon} size={24} />
        </span>
        <strong>
          <StateName name={tag.definition.name} numeral={draft.romanNumeral} />
        </strong>
        <span className="tiny subtle">独立角色备注</span>
      </div>
      <RomanNumeralSelect
        value={draft.romanNumeral}
        onChange={(romanNumeral) => setDraft({ ...draft, romanNumeral })}
        disabled={busy || removed}
      />
      <div className="tag-form-grid">
        <VisibilitySelect
          value={draft.visibility}
          onChange={(visibility: TagVisibility) => setDraft({ ...draft, visibility })}
        />
        <label>
          <span className="label">展示优先级（越大越靠前）</span>
          <input
            className="input"
            type="number"
            min="-100"
            max="100"
            aria-label="展示优先级"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
          />
        </label>
      </div>
      {draft.visibility === 'PUBLIC' && (
        <p className="tag-public-notice">保存后，能查看此角色的房间成员都能阅读完整备注。</p>
      )}
      <div className="flex justify-between items-center">
        <span className="label">角色专属详细备注</span>
        <button className="btn tiny" onClick={() => setPreview(!preview)}>
          {preview ? '继续编辑' : '预览备注'}
        </button>
      </div>
      {preview ? (
        <div className="tag-preview">
          <TagMarkdown text={draft.detailsMarkdown} />
        </div>
      ) : (
        <textarea
          className="input tag-details-input"
          aria-label="角色专属详细备注"
          maxLength={TAG_DETAILS_MAX}
          value={draft.detailsMarkdown}
          onChange={(e) => setDraft({ ...draft, detailsMarkdown: e.target.value })}
          placeholder="写下秘密、线索和后续计划。支持 Markdown；仅保存时同步。"
        />
      )}
      <DurationInput
        value={draft.remainingTurns}
        onChange={(remainingTurns) => setDraft({ ...draft, remainingTurns })}
      />
      <CustomFieldsEditor
        fields={draft.customFields}
        onChange={(customFields) => setDraft({ ...draft, customFields })}
        disabled={busy || removed}
        hint="数值词条与基础信息名称一致时自动加成；文字仅作记录。"
      />
      <div className="tiny subtle">
        {draft.detailsMarkdown.length.toLocaleString()} / {TAG_DETAILS_MAX.toLocaleString()} 字符 · 当前范围：
        {visibilityNames[draft.visibility]}
      </div>
      {removed && <div className="tag-conflict">此状态已被其他窗口移除；草稿仍保留，可复制到新备注。</div>}
      {version !== tag.version && (
        <div className="tag-conflict">其他窗口已更新此备注；当前草稿已保留。请复制草稿或重新加载后再编辑。</div>
      )}
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}，草稿已保留。
        </p>
      )}
      {message && (
        <p role="status" className="text-emerald-300 tiny">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          disabled={removed || busy || !dirty || version !== tag.version}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存角色备注'}
        </button>
        <button
          className="btn"
          disabled={removed || busy}
          onClick={() => {
            if (!dirty || confirm('丢弃当前草稿并加载最新备注？')) reload();
          }}
        >
          重新加载
        </button>
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft.detailsMarkdown);
              setMessage('草稿已复制');
            } catch {
              setError('复制失败，请在备注输入框中手动复制');
            }
          }}
        >
          复制草稿
        </button>
        {onBack && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!dirty || confirm('返回状态列表会丢弃未保存草稿，确定返回？')) onBack();
            }}
          >
            返回列表
          </button>
        )}
      </div>
    </div>
  );
}
