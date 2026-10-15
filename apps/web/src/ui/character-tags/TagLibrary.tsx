import { useState } from 'react';
import { useUI } from '../../store';
import { TagIcon, visibilityNames } from './TagIcon';
import TagDefinitionEditor from './TagDefinitionEditor';
import TagAttachForm from './TagAttachForm';
import type { TagProps } from './types';
export default function TagLibrary({ p, windowId }: { p: TagProps; windowId: string }) {
  const [editing, setEditing] = useState<string | null>(null),
    [batch, setBatch] = useState(''),
    [search, setSearch] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const open = useUI((s) => s.open);
  if (!p.isGM) return <p>标签库仅主持人可管理。</p>;
  const selected = p.snap.tagDefinitions.find((d) => d.id === editing),
    batchDefinition = p.snap.tagDefinitions.find((d) => d.id === batch);
  if (editing !== null)
    return (
      <TagDefinitionEditor
        key={editing}
        p={p}
        definition={selected}
        windowId={windowId}
        onDone={(id) => {
          setEditing(null);
          if (id) setMessage('标签定义已保存');
        }}
      />
    );
  if (batchDefinition)
    return (
      <TagAttachForm
        p={p}
        definition={batchDefinition}
        windowId={windowId}
        onDone={() => {
          setBatch('');
          setMessage('批量分配列表已更新');
        }}
      />
    );
  async function archive(id: string) {
    const d = p.snap.tagDefinitions.find((value) => value.id === id)!;
    if (
      !d.isArchived &&
      !confirm(`归档「${d.name}」？现有 ${d.characterCount} 个角色标签及独立备注会保留，归档后不能新分配。`)
    )
      return;
    setBusy(true);
    setError('');
    try {
      await p.mutate(d.isArchived ? 'tagDefinition.restore' : 'tagDefinition.archive', {
        id: d.id,
        version: d.version,
      });
      setMessage(d.isArchived ? '已恢复标签定义' : '已归档，历史备注仍保留');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = p.snap.tagDefinitions.filter(
    (d) => (showArchived || !d.isArchived) && d.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="tag-library space-y-4">
      <div>
        <div className="eyebrow">STORY MARKS</div>
        <h2 className="display-title text-2xl">标签库</h2>
        <p className="tiny subtle mt-2">复用图标类别，为每个角色保存不同的故事。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditing('new');
            setMessage('');
          }}
        >
          新建标签定义
        </button>
        <button className="btn" onClick={() => open('tag-overview')}>
          角色标签总览
        </button>
      </div>
      <input
        className="input"
        aria-label="搜索标签库"
        placeholder="搜索标签名称…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label className="tiny flex gap-2 items-center">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        显示归档定义
      </label>
      <div className="space-y-3">
        {list.map((d) => (
          <article key={d.id} className="grid-card tag-definition-row">
            <div className="tag-card-heading">
              <span className="tag-symbol-preview" style={{ color: d.color, borderColor: d.color }}>
                <TagIcon icon={d.icon} size={23} />
              </span>
              <div className="min-w-0 flex-1">
                <strong>{d.name}</strong>
                <div className="tiny subtle">
                  {d.characterCount} 个关联角色 · {visibilityNames[d.defaultVisibility]} · 优先级 {d.defaultPriority}
                  {d.isArchived ? ' · 已归档' : ''}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn tiny" onClick={() => setEditing(d.id)}>
                编辑定义
              </button>
              <button className="btn tiny" disabled={d.isArchived} onClick={() => setBatch(d.id)}>
                批量分配
              </button>
              <button className="btn tiny" disabled={busy} onClick={() => void archive(d.id)}>
                {d.isArchived ? '恢复定义' : '归档定义'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && <div className="empty-note">没有匹配的标签定义。</div>}
      {message && (
        <p className="tiny text-emerald-300" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="tiny text-red-300" role="alert">
          {error}
        </p>
      )}
      <p className="tiny subtle">归档不会删除角色备注。要去掉单个角色上的标签，请在该角色标签管理器中移除。</p>
    </div>
  );
}
