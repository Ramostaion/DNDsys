import { useEffect, useState } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useUI } from '../store';
import type { Snapshot } from '../api';
import { canCapability } from '../permissions';
import { itemFields, validateItemFields, type ItemField } from './item-fields';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
const defaultKinds = ['杂物', '装备', '饰品', '道具', '任务物品'];
function canEdit(p: Props) {
  return p.isGM && canCapability(p.snap, p.me.id, 'publicItems');
}

export function ItemLibrary({ p }: { p: Props }) {
  const open = useUI((s) => s.open),
    [name, setName] = useState(''),
    [kind, setKind] = useState('杂物'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    editor = canEdit(p);
  if (!p.isGM) return <p className="empty-note">物品库仅 GM 可查看。已有物品可在背包与装备中查看。</p>;
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await p.mutate('item.create', { name: name.trim(), kind });
      setName('');
      open('item', created.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 item-library">
      {editor ? (
        <form
          className="panel rounded-lg p-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h3 className="font-semibold">创建物品</h3>
          <label>
            <span className="label">物品名称</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：铁锭"
              maxLength={100}
              disabled={busy}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1 min-w-0">
              <span className="label">物品种类</span>
              <select className="input" value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
                {defaultKinds.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary self-end whitespace-nowrap" disabled={busy || !name.trim()}>
              {busy ? '创建中…' : '创建物品'}
            </button>
          </div>
          {error && (
            <p role="alert" className="tiny text-red-300">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="tiny subtle">物品库由 GM 管理。GM 可在房间设置中授予你“编辑物品库”权限。</p>
      )}
      <p className="tiny subtle">点击格子查看物品卡；GM 授权“从物品库加入背包”后，可拖入自己或获准控制的角色背包。</p>
      <div className="inventory-grid item-library-grid">
        {p.snap.items.map((item) => (
          <button
            key={item.id}
            aria-label={item.name}
            title={`${item.name} · ${item.kind}`}
            className="inventory-slot filled item-library-slot"
            draggable={canCapability(p.snap, p.me.id, 'inventoryAdd')}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData(
                'application/x-dnd-item',
                JSON.stringify({ roomId: p.snap.room.id, itemId: item.id }),
              );
            }}
            onClick={() => open('item', item.id)}
          >
            <div className="inventory-icon">
              {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Package size={30} />}
            </div>
            <strong className="truncate w-full">{item.name}</strong>
            <span className="tiny subtle">{item.kind}</span>
          </button>
        ))}
      </div>
      {p.snap.items.length === 0 && <p className="subtle">物品库为空。</p>}
    </div>
  );
}

export function ItemEditor({ p, id, windowId }: { p: Props; id?: string; windowId: string }) {
  const item = p.snap.items.find((x) => x.id === id),
    [loaded, setLoaded] = useState(Boolean(item));
  useEffect(() => {
    if (item) setLoaded(true);
  }, [item]);
  if (!item) return <p>{loaded ? '物品已删除。' : '正在载入物品…'}</p>;
  return <LoadedItemEditor key={item.id} p={p} item={item} windowId={windowId} />;
}
function LoadedItemEditor({ p, item, windowId }: { p: Props; item: any; windowId: string }) {
  const close = useUI((s) => s.close),
    [version, setVersion] = useState(item.version),
    [name, setName] = useState(item.name),
    [kind, setKind] = useState(item.kind),
    [description, setDescription] = useState(item.description || ''),
    [imageUrl, setImageUrl] = useState(item.imageUrl || ''),
    [fields, setFields] = useState<ItemField[]>(itemFields(item.data)),
    [notes, setNotes] = useState(String(item.data?.notes || '')),
    [slots, setSlots] = useState((item.compatibleSlots || []).join(', ')),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    editor = canEdit(p);
  const changedElsewhere = item.version !== version;
  function reload() {
    setVersion(item.version);
    setName(item.name);
    setKind(item.kind);
    setDescription(item.description || '');
    setImageUrl(item.imageUrl || '');
    setFields(itemFields(item.data));
    setNotes(String(item.data?.notes || ''));
    setSlots((item.compatibleSlots || []).join(', '));
    setError('');
  }
  function updateField(index: number, patch: Partial<ItemField>) {
    setFields((old) => old.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  async function save() {
    setError('');
    let customFields: ItemField[];
    try {
      customFields = validateItemFields(fields);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    setBusy(true);
    try {
      const saved = await p.mutate('item.update', {
        id: item.id,
        version,
        patch: {
          name: name.trim(),
          kind: kind.trim(),
          description,
          imageUrl: imageUrl || null,
          data: { ...(item.data || {}), customFields, notes },
          compatibleSlots: slots
            .split(',')
            .map((x: string) => x.trim())
            .filter(Boolean),
        },
      });
      setVersion(saved.version);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setError('');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/rooms/${p.snap.room.id}/upload`, {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '上传失败');
      setImageUrl(result.url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 item-editor">
      <div className="flex items-center gap-4">
        <div className="character-avatar !w-20 !h-20 grid place-items-center overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="物品头像" className="w-full h-full object-cover" />
          ) : (
            <Package size={36} />
          )}
        </div>
        <div>
          <div className="font-semibold">{item.name}</div>
          <div className="tiny subtle">房间物品库 · 第 {version} 版</div>
          {editor && (
            <label className="btn inline-block mt-2 cursor-pointer text-sm">
              上传头像
              <input
                hidden
                aria-label="上传物品头像"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>
      {changedElsewhere && (
        <div className="rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm">
          这件物品已被其他人更新。
          <button className="text-cyan-300 ml-2" onClick={reload}>
            载入最新版本
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">名称</span>
          <input
            className="input"
            maxLength={100}
            disabled={!editor || busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className="label">种类</span>
          <input
            className="input"
            disabled={!editor || busy}
            list="item-kinds"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
          <datalist id="item-kinds">
            {defaultKinds.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="block">
        <span className="label">描述</span>
        <textarea
          aria-label="描述"
          className="input min-h-28"
          maxLength={5000}
          disabled={!editor || busy}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="用途、外观、来历…"
        />
      </label>
      <section className="space-y-2">
        <h3 className="font-semibold text-sm">自定义项目</h3>
        <p className="tiny subtle">
          自由填写资料。装备与饰品中，项目类型选“数值”、名称与人物卡属性名称一致时，穿戴后自动加成（例如法伤
          +5）。文字项目与杂物仅作记录。
        </p>
        {fields.map((field, index) => (
          <div className="item-field-row" key={index}>
            <input
              className="input"
              aria-label={`项目名称 ${index + 1}`}
              placeholder="项目名称，例如重量"
              maxLength={80}
              disabled={!editor || busy}
              value={field.name}
              onChange={(e) => updateField(index, { name: e.target.value })}
            />
            <select
              className="input"
              aria-label={`项目类型 ${index + 1}`}
              disabled={!editor || busy}
              value={typeof field.value}
              onChange={(e) =>
                updateField(index, {
                  value: e.target.value === 'number' ? Number(field.value) || 0 : String(field.value),
                })
              }
            >
              <option value="string">文字</option>
              <option value="number">数值</option>
            </select>
            <input
              className="input"
              aria-label={`项目内容 ${index + 1}`}
              disabled={!editor || busy}
              type={typeof field.value === 'number' ? 'number' : 'text'}
              value={field.value}
              onChange={(e) =>
                updateField(index, { value: typeof field.value === 'number' ? e.target.valueAsNumber : e.target.value })
              }
            />
            {editor && (
              <button
                className="icon-button"
                aria-label={`删除项目 ${index + 1}`}
                disabled={busy}
                onClick={() => setFields(fields.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {editor && (
          <button
            className="btn"
            disabled={busy || fields.length >= 50}
            onClick={() => setFields([...fields, { name: '', value: '' }])}
          >
            <Plus size={15} />
            添加项目
          </button>
        )}
        {!editor && !fields.length && <p className="tiny subtle">暂无自定义项目。</p>}
      </section>
      <label className="block">
        <span className="label">备注</span>
        <textarea
          aria-label="备注"
          className="input min-h-24"
          maxLength={5000}
          disabled={!editor || busy}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="使用限制、特殊效果或剧情备注…"
        />
      </label>
      {(kind === '装备' || kind === '饰品') && (
        <label className="block">
          <span className="label">可装备部位（逗号分隔）</span>
          <input
            className="input"
            disabled={!editor || busy}
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            placeholder={(p.snap.room.equipmentSlots || []).join(', ')}
          />
          <span className="tiny subtle">留空表示可以放入任意装备部位。</span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      {editor ? (
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim() || changedElsewhere}
            onClick={() => void save()}
          >
            {busy ? '处理中…' : '保存物品卡'}
          </button>
          <button className="btn" disabled={busy} onClick={reload}>
            撤销未保存更改
          </button>
          <button
            className="btn btn-danger ml-auto"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`删除 ${item.name}？已在背包中的物品不能删除。`)) return;
              try {
                await p.mutate('item.delete', { id: item.id });
                close(windowId);
              } catch (cause) {
                setError((cause as Error).message);
              }
            }}
          >
            删除物品
          </button>
        </div>
      ) : (
        <p className="tiny subtle">只有 GM 或被授予“编辑物品库”权限的玩家可以修改公共物品。</p>
      )}
    </div>
  );
}
