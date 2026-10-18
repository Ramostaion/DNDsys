import { useState } from 'react';
import { ChevronLeft, Upload } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import MapEditor from './MapEditor';
import { STARTER_MAP_IMAGE, mapImageUrl } from './map-assets';
type Props = {
  snap: Snapshot;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
const mapName = (snap: Snapshot, map: any) => {
  const parent = snap.maps.find((candidate) => candidate.id === map.parentId);
  return parent ? `${parent.name} / ${map.name}` : map.name;
};
function UploadMap({ p, map }: { p: Props; map: any }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <label className="btn inline-flex gap-1 items-center cursor-pointer text-sm">
        <Upload size={14} />
        {busy ? '上传中…' : '上传图片'}
        <input
          hidden
          disabled={busy}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              const fd = new FormData();
              fd.append('file', file);
              fd.append('visibility', map.visibility === 'GM' ? 'PRIVATE' : 'PUBLIC');
              const response = await fetch(`/api/rooms/${p.snap.room.id}/upload`, {
                method: 'POST',
                body: fd,
                credentials: 'include',
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error);
              await p.mutate('map.update', { id: map.id, version: map.version, patch: { imageUrl: data.url } });
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
              event.target.value = '';
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </>
  );
}
export default function MapLibrary({ p, id }: { p: Props; id?: string }) {
  const [current, setCurrent] = useState(id || ''),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [privateMap, setPrivate] = useState(false),
    [portalTarget, setPortalTarget] = useState(''),
    [portalLabel, setPortalLabel] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const open = useUI((state) => state.open),
    selected = p.snap.maps.find((map) => map.id === current),
    source = p.snap.maps.find((map) => map.id === p.snap.room.activeMapId);
  const shown = p.snap.maps.filter((map) => map.parentId === (selected?.id || null)),
    targets = p.snap.maps.filter((map) => map.id !== source?.id);
  const entrances = p.snap.portals.filter((portal) => portal.sourceMapId === (selected?.id || source?.id));
  async function run(type: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      return await p.mutate(type, payload);
    } catch (error) {
      setError((error as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function chooseTarget(targetId: string) {
    setPortalTarget(targetId);
    setPortalLabel(p.snap.maps.find((map) => map.id === targetId)?.name || '');
  }
  function controls(map: any) {
    return (
      <div className="flex flex-wrap gap-2 mt-3">
        {p.isGM && (
          <>
            <button
              className="btn btn-primary"
              disabled={busy || map.id === p.snap.room.activeMapId}
              onClick={() => void run('map.activate', { id: map.id })}
            >
              {map.id === p.snap.room.activeMapId ? '当前地图' : '切换到这里'}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setCurrent(map.id);
                setEditing(map.id);
              }}
            >
              编辑地图
            </button>
            <UploadMap p={p} map={map} />
            <button
              className="btn"
              disabled={busy || !source || source.id === map.id}
              onClick={() => chooseTarget(map.id)}
            >
              创建入口
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run('map.update', {
                  id: map.id,
                  version: map.version,
                  patch: { visibility: map.visibility === 'GM' ? 'PUBLIC' : 'GM' },
                })
              }
            >
              {map.visibility === 'GM' ? '公开地图' : '仅 GM 可见'}
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                if (confirm(`删除地图“${map.name}”？与此地图关联的入口也会删除，子地图将保留在地图册。`)) {
                  const result = await run('map.delete', { id: map.id });
                  if (result && selected?.id === map.id) setCurrent(map.parentId || '');
                }
              }}
            >
              删除地图
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="map-library space-y-4">
      <div className="flex gap-2 items-end">
        <button
          aria-label="返回上级地图"
          className="btn"
          disabled={!selected}
          onClick={() => setCurrent(selected?.parentId || '')}
        >
          <ChevronLeft size={16} />
        </button>
        <label className="flex-1">
          <span className="label">地图册 · 选择地图（含子地图）</span>
          <select
            aria-label="地图册选择地图"
            className="input"
            value={selected?.id || ''}
            onChange={(event) => setCurrent(event.target.value)}
          >
            <option value="">全部根地图</option>
            {p.snap.maps.map((map) => (
              <option key={map.id} value={map.id}>
                {mapName(p.snap, map)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected && editing !== selected.id && (
        <section className="grid-card map-detail" aria-label="所选地图详情">
          <h3 className="display-title text-xl">{selected.name}</h3>
          {selected.imageUrl && (
            <img
              src={mapImageUrl(selected.imageUrl)}
              alt={selected.name}
              className="w-full max-h-44 object-cover rounded mt-3"
            />
          )}
          <p className="tiny subtle mt-2">
            {selected.width} × {selected.height} · {selected.visibility === 'GM' ? '仅 GM 可见' : '房间公开'}
          </p>
          {controls(selected)}
          {!p.isGM && <p className="tiny subtle mt-2">由 GM 切换全房间的当前地图。</p>}
        </section>
      )}
      {p.isGM && selected && editing === selected.id && (
        <MapEditor
          key={selected.id}
          map={selected}
          onSave={(payload) => p.mutate('map.update', payload)}
          onClose={() => setEditing(null)}
        />
      )}
      {p.isGM && (
        <section className="panel p-3 rounded-lg space-y-3">
          <h3 className="font-semibold">{selected ? `在“${selected.name}”下创建子地图` : '创建根地图'}</h3>
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const map = await run('map.create', {
                name: name.trim(),
                parentId: selected?.id || null,
                visibility: privateMap ? 'GM' : 'PUBLIC',
              });
              if (map) {
                setName('');
                setCurrent(map.id);
              }
            }}
          >
            <input
              className="input"
              aria-label="新地图名称"
              value={name}
              placeholder="新地图名称"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <button className="btn btn-primary whitespace-nowrap" disabled={busy || !name.trim()}>
              新建
            </button>
          </form>
          <label className="flex gap-2 items-center tiny">
            <input
              type="checkbox"
              checked={privateMap || selected?.visibility === 'GM'}
              disabled={selected?.visibility === 'GM'}
              onChange={(event) => setPrivate(event.target.checked)}
            />
            仅 GM 可见
          </label>
          {!selected && (
            <button
              disabled={busy}
              className="starter-map"
              onClick={async () => {
                const map = await run('map.create', {
                  name: '荒原瞭望塔',
                  imageUrl: STARTER_MAP_IMAGE,
                  width: 1672,
                  height: 940,
                });
                if (map) {
                  await run('map.activate', { id: map.id });
                  setCurrent(map.id);
                }
              }}
            >
              <img src={STARTER_MAP_IMAGE} alt="荒原瞭望塔夜间预览" />
              <span>
                <strong>使用示例战斗地图</strong>
                <small>一键创建并切换到荒原瞭望塔（月夜）</small>
              </span>
            </button>
          )}
        </section>
      )}
      <section>
        <h3 className="font-semibold mb-2">{selected ? '子地图' : '根地图'}</h3>
        <div className="grid grid-cols-2 gap-3">
          {shown.map((map) => (
            <article className="grid-card" key={map.id}>
              {map.imageUrl && (
                <img src={mapImageUrl(map.imageUrl)} alt="" className="w-full h-24 object-cover rounded mb-2" />
              )}
              <strong>{map.name}</strong>
              {map.id === p.snap.room.activeMapId && <span className="badge ml-2">当前</span>}
              <button className="btn block mt-3" onClick={() => setCurrent(map.id)}>
                查看地图
              </button>
              {controls(map)}
            </article>
          ))}
        </div>
        {!shown.length && <p className="tiny subtle">{selected ? '暂无子地图，可在上方创建。' : '暂无根地图。'}</p>}
      </section>
      {p.isGM && (
        <section className="panel p-3 rounded-lg space-y-3" aria-label="创建地图入口">
          <h3 className="font-semibold">创建地图入口</h3>
          <p className="tiny subtle">
            在当前地图“{source?.name || '未选择'}
            ”上放置入口，目标可选择地图册中的任意地图或子地图。创建入口不会自动创建地图。
          </p>
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!source) return;
              const portal = await run('portal.create', {
                sourceMapId: source.id,
                targetMapId: portalTarget,
                label: portalLabel.trim(),
                x: source.width / 2,
                y: source.height / 2,
              });
              if (portal) {
                setPortalTarget('');
                setPortalLabel('');
                open('portal', portal.id);
              }
            }}
          >
            <label>
              <span className="label">入口目标地图</span>
              <select
                className="input"
                aria-label="入口目标地图"
                value={portalTarget}
                onChange={(event) => chooseTarget(event.target.value)}
                required
              >
                <option value="">从地图册选择…</option>
                {targets.map((map) => (
                  <option key={map.id} value={map.id}>
                    {mapName(p.snap, map)}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="入口名称"
              className="input"
              placeholder="入口名称"
              value={portalLabel}
              maxLength={100}
              onChange={(event) => setPortalLabel(event.target.value)}
              required
            />
            <button className="btn btn-primary" disabled={busy || !source || !portalTarget || !portalLabel.trim()}>
              放置入口
            </button>
          </form>
        </section>
      )}
      <section aria-label="地图入口列表">
        <h3 className="font-semibold mb-2">{selected?.name || source?.name || '当前地图'}的入口</h3>
        <div className="space-y-2">
          {entrances.map((portal) => (
            <div className="grid-card flex gap-2 items-center" key={portal.id}>
              <div className="flex-1">
                <strong>{portal.label}</strong>
                <p className="tiny subtle">
                  通往 {p.snap.maps.find((map) => map.id === portal.targetMapId)?.name || '地图'}
                </p>
              </div>
              <button className="btn" onClick={() => open('portal', portal.id)}>
                入口详情
              </button>
              {p.isGM && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`删除入口“${portal.label}”？目标地图会保留。`))
                      void run('portal.delete', { id: portal.id });
                  }}
                >
                  删除入口
                </button>
              )}
            </div>
          ))}
        </div>
        {!entrances.length && <p className="tiny subtle">暂无入口。</p>}
      </section>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
export function MapPortal({ p, id }: { p: Props; id?: string }) {
  const portal = p.snap.portals.find((portal) => portal.id === id),
    target = p.snap.maps.find((map) => map.id === portal?.targetMapId),
    source = p.snap.maps.find((map) => map.id === portal?.sourceMapId);
  const [draft, setDraft] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const open = useUI((state) => state.open);
  async function run(type: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await p.mutate(type, payload);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!portal || !target)
    return (
      <div className="map-portal subtle" role="status">
        此入口已删除或不可见，可返回地图册查看其他地图。
      </div>
    );
  return (
    <div className="space-y-4 map-portal">
      <div>
        <div className="eyebrow">MAP PORTAL</div>
        <div className="flex gap-2 items-center justify-between mt-1">
          <h3 className="display-title text-2xl">{portal.label}</h3>
          {p.isGM && (
            <button
              className="btn shrink-0"
              disabled={busy}
              onClick={() => {
                setDraft(portal.label);
                setError('');
              }}
            >
              编辑入口名称
            </button>
          )}
        </div>
        <p className="subtle text-sm mt-2">
          {source?.name} → {target.name}
        </p>
      </div>
      {p.isGM && draft !== null && (
        <form
          className="portal-name-editor panel p-3 rounded-lg space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run('portal.update', { id: portal.id, label: draft.trim() })) setDraft(null);
          }}
        >
          <label className="block">
            <span className="label">入口名称</span>
            <input
              className="input"
              value={draft}
              maxLength={100}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              required
            />
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !draft.trim()}>
              {busy ? '保存中…' : '保存入口名称'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {target.imageUrl && (
        <img src={mapImageUrl(target.imageUrl)} alt={target.name} className="w-full max-h-52 object-cover rounded" />
      )}
      <div className="flex gap-2 flex-wrap">
        {p.isGM ? (
          <button
            className="btn btn-primary"
            disabled={busy || p.snap.room.activeMapId === target.id}
            onClick={() => void run('map.activate', { id: target.id })}
          >
            {p.snap.room.activeMapId === target.id ? '已到达此地图' : '跳转到该地图'}
          </button>
        ) : (
          <p className="tiny subtle">请 GM 点击入口跳转，全体玩家会同步切换地图。</p>
        )}
        <button className="btn" onClick={() => open('maps', target.id)}>
          在地图册查看
        </button>
        {p.isGM && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (confirm(`删除入口“${portal.label}”？目标地图会保留。`)) void run('portal.delete', { id: portal.id });
            }}
          >
            删除入口
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
