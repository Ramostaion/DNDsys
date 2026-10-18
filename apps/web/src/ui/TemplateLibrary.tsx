import { useState } from 'react';
import { BookOpen, Plus, Link2, Copy } from 'lucide-react';
import CustomFieldsEditor, { CustomFieldsDetails } from './CustomFieldsEditor';
import { itemFields, validateItemFields, type ItemField } from './item-fields';
import HoverInfo from './HoverInfo';
import type { Snapshot } from '../api';
import { canCapability, canEditCharacter } from '../permissions';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
const labels: Record<string, string> = { SKILL: '技能', TRAIT: '特性', SPECIAL: '特殊机制' };
function Editor({
  p,
  template,
  creationKind = 'ALL',
  onDone,
}: {
  p: Props;
  template?: any;
  creationKind?: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(template?.name || ''),
    [kind, setKind] = useState(template?.kind || (creationKind === 'ALL' ? 'SKILL' : creationKind)),
    [description, setDescription] = useState(template?.description || ''),
    [iconUrl, setIconUrl] = useState(template?.iconUrl || ''),
    [customFields, setCustomFields] = useState<ItemField[]>(
      Array.isArray(template?.data?.customFields) ? itemFields(template.data) : [],
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const sharedCount = template
    ? p.snap.characters.reduce(
        (sum, c) =>
          sum +
          ['skills', 'statuses', 'traits']
            .flatMap((key) => c[key] || [])
            .filter((entry: any) => entry.templateId === template.id && entry.shared === true).length,
        0,
      )
    : 0;
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/rooms/${p.snap.room.id}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '上传失败');
      setIconUrl(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!name.trim()) {
      setError('请输入名称');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const data = { ...(template?.data || {}), customFields: validateItemFields(customFields) };
      if (template)
        await p.mutate('template.update', {
          id: template.id,
          version: template.version,
          patch: { name: name.trim(), description, iconUrl: iconUrl || null, data },
        });
      else await p.mutate('template.create', { name: name.trim(), kind, description, iconUrl: iconUrl || null, data });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="template-editor space-y-3">
      <h3 className="font-semibold">{template ? '编辑模板' : '新建模板'}</h3>
      <div className="template-portrait">
        <div className="template-portrait-preview">
          {iconUrl ? <img src={iconUrl} alt="能力图标预览" /> : <BookOpen size={36} />}
        </div>
        <div>
          <div className="label">能力图标</div>
          <label className="btn inline-block cursor-pointer">
            {busy ? '处理中…' : '选择图片'}
            <input
              hidden
              aria-label="上传能力图标"
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
          {iconUrl && (
            <button className="btn ml-2" disabled={busy} onClick={() => setIconUrl('')}>
              移除图标
            </button>
          )}
          <p className="tiny subtle mt-2">用于表示这项能力。</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">名称</span>
          <input className="input" disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="label">类型</span>
          <select
            aria-label="类型"
            className="input"
            disabled={busy || Boolean(template) || creationKind !== 'ALL'}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {(template || creationKind !== 'ALL' ? [[kind, labels[kind]]] : Object.entries(labels)).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">说明与使用建议</span>
        <textarea
          aria-label="说明与使用建议"
          className="input min-h-24"
          disabled={busy}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="用途、效果和使用条件，由 GM 按规则裁决。"
        />
      </label>
      {kind === 'SKILL' && (
        <CustomFieldsEditor
          fields={customFields}
          onChange={setCustomFields}
          disabled={busy}
          hint="技能词条仅作记录，不改变人物卡基础信息。"
        />
      )}
      {template && <p className="tiny subtle">保存会更新 {sharedCount} 个共享安装；独立副本保持原值。</p>}
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? '保存中…' : '保存模板'}
        </button>
        <button className="btn" disabled={busy} onClick={onDone}>
          取消
        </button>
      </div>
    </div>
  );
}
const installationHelp = {
  shared: '共享：与原模板保持关联。GM 修改模板后，角色上的能力会同步更新；不会让其他玩家自动获得该能力。',
  copy: '副本：保留添加时的内容。GM 后续修改原模板，不会改变角色上的这份能力。',
};
function InstallOptions({ onApply }: { onApply: (shared: boolean) => void }) {
  return (
    <div className="template-install-options">
      {(['shared', 'copy'] as const).map((mode) => (
        <div className="flex items-center gap-2 justify-between" key={mode}>
          <button
            className={`tiny flex gap-1 items-center ${mode === 'shared' ? 'text-emerald-300' : 'text-amber-300'}`}
            onClick={() => onApply(mode === 'shared')}
          >
            {mode === 'shared' ? <Link2 size={12} /> : <Copy size={12} />} {mode === 'shared' ? '共享' : '副本'}
          </button>
          <HoverInfo label={`${mode === 'shared' ? '共享' : '副本'}说明`}>{installationHelp[mode]}</HoverInfo>
        </div>
      ))}
    </div>
  );
}
export default function TemplateLibrary({ p, characterId }: { p: Props; characterId?: string }) {
  const [kind, setKind] = useState('SKILL'),
    [editing, setEditing] = useState<string | null>(null),
    [creating, setCreating] = useState<string | null>(null),
    [toggling, setToggling] = useState(false),
    [error, setError] = useState('');
  const character = p.snap.characters.find((c) => c.id === characterId),
    canApply = Boolean(
      character &&
        canCapability(p.snap, p.me.id, 'characterValues') &&
        canCapability(p.snap, p.me.id, 'templateInstall') &&
        canEditCharacter(p.snap, p.me.id, character),
    );
  const list = p.snap.templates.filter((t) => t.kind !== 'STATUS' && (kind === 'ALL' || t.kind === kind)),
    selected = p.snap.templates.find((t) => t.id === editing);
  async function run(type: string, payload: Record<string, unknown>) {
    setError('');
    try {
      await p.mutate(type, payload);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="space-y-4 template-library">
      <div className="flex justify-between items-center">
        <div>
          <div className="eyebrow">ABILITIES & EFFECTS</div>
          <h2 className="display-title text-xl mt-1">{p.isGM ? '能力模板库' : '能力'}</h2>
        </div>
        {p.isGM && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setCreating(kind);
              setEditing(null);
            }}
          >
            <Plus size={15} />
            新建
          </button>
        )}
      </div>
      {character && (
        <p className="tiny subtle">当前角色：{character.name}。共享安装随模板更新；独立副本保持当前版本。</p>
      )}
      {character && (
        <section className="panel rounded p-3 space-y-2" aria-label="角色特性开关">
          <h3 className="font-semibold text-sm">已安装特性</h3>
          <div className="flex flex-wrap gap-2">
            {(character.traits || [])
              .filter(
                (trait: any) =>
                  trait.kind !== 'SPECIAL' &&
                  !p.snap.templates.some((template) => template.id === trait.templateId && template.kind === 'SPECIAL'),
              )
              .map((trait: any) => (
                <span
                  className={`badge ${trait.enabled === false ? 'opacity-60' : ''}`}
                  key={trait.id}
                  title={trait.description}
                >
                  {trait.name}
                  <span className="tiny subtle ml-1">{trait.enabled === false ? '已停用' : '已启用'}</span>
                  {canEditCharacter(p.snap, p.me.id, character) && (
                    <button
                      className="ml-2 text-amber-300"
                      disabled={toggling}
                      aria-label={`${trait.enabled === false ? '启用' : '停用'}特性：${trait.name}`}
                      onClick={async () => {
                        setToggling(true);
                        await run('template.enable', {
                          characterId: character.id,
                          field: 'traits',
                          instanceId: trait.id,
                          enabled: trait.enabled === false,
                          version: character.version,
                        });
                        setToggling(false);
                      }}
                    >
                      {trait.enabled === false ? '启用' : '停用'}
                    </button>
                  )}
                </span>
              ))}
          </div>
          {!character.traits?.length && <p className="tiny subtle">尚未安装特性，由GM添加后可在此启停。</p>}
        </section>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="能力类型筛选">
        {[['ALL', '全部'], ...Object.entries(labels)].map(([value, label]) => (
          <button
            key={value}
            className={`btn ${kind === value ? 'btn-primary' : ''}`}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {creating && <Editor key={creating} p={p} creationKind={creating} onDone={() => setCreating(null)} />}
      {selected && (
        <Editor key={`${selected.id}-${selected.version}`} p={p} template={selected} onDone={() => setEditing(null)} />
      )}
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      <div className="space-y-2">
        {list.map((template) => (
          <article key={template.id} className="ability-list-card">
            <div className="ability-list-icon">
              {template.iconUrl ? <img src={template.iconUrl} alt="" /> : <BookOpen size={23} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                {template.name} <span className="badge">{labels[template.kind] || template.kind}</span>
              </div>
              <p className="tiny subtle mt-1 whitespace-pre-wrap">{template.description || '暂无说明'}</p>
              <CustomFieldsDetails fields={template.data?.customFields} />
            </div>
            <div className="flex flex-col gap-1">
              {p.isGM && (
                <>
                  <button
                    className="tiny text-amber-300"
                    onClick={() => {
                      setEditing(template.id);
                      setCreating(null);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="tiny text-red-300"
                    onClick={() => void run('template.delete', { id: template.id })}
                  >
                    删除
                  </button>
                </>
              )}
              {canApply && (p.isGM || template.kind !== 'SPECIAL') && (
                <InstallOptions
                  onApply={(shared) => void run('template.apply', { characterId, templateId: template.id, shared })}
                />
              )}
            </div>
          </article>
        ))}
      </div>
      {list.length === 0 && <div className="empty-note">能力库暂时为空。</div>}
    </div>
  );
}
