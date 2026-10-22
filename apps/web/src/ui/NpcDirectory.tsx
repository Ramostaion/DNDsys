import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../api';
import { folderChain, folderDescendants, folderPath, type NpcFolder } from './npc-directory-model';
import './npc-directory.css';

type Props = {
  snap: Snapshot;
  me: any;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
  renderCard: (character: any) => ReactNode;
};
type Action = { kind: 'create' | 'rename' | 'move' | 'delete' | 'assign'; id: string | null; ids?: string[] };
export default function NpcDirectory({ snap, me, mutate, renderCard }: Props) {
  const directory = snap.npcDirectory ?? { revision: 0, folders: [], classifications: [] },
    folders = directory.folders;
  const npcs = snap.characters.filter((row) => row.isNpc),
    classification = new Map(directory.classifications.map((row) => [row.characterId, row.folderId]));
  const [current, setCurrent] = useState('all'),
    [includeChildren, setIncludeChildren] = useState(true),
    [search, setSearch] = useState(''),
    [scope, setScope] = useState('current'),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [collapsed, setCollapsed] = useState(false),
    [action, setAction] = useState<Action | null>(null),
    [actionName, setActionName] = useState(''),
    [destination, setDestination] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [hidden, setHidden] = useState(false);
  const storageKey = `npc-folders:${snap.room.id}:${me.id}`;
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const pending = useRef(false);
  const concrete = current !== 'all' && current !== 'unfiled',
    folder = folders.find((row) => row.id === current);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(expanded));
    } catch {}
  }, [expanded, storageKey]);
  useEffect(() => {
    if (concrete && !folder) {
      setCurrent('all');
      setPage(0);
      setError('当前目录已删除，已返回全部 NPC。');
      setAction(null);
    }
  }, [concrete, folder]);
  const allowed = concrete ? (includeChildren ? folderDescendants(folders, current) : new Set([current])) : null;
  const filtered = npcs.filter((c) => {
    if (!c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
    if (search.trim() && scope === 'all') return true;
    const id = classification.get(c.id);
    return current === 'all' || (current === 'unfiled' ? !id : !!id && allowed!.has(id));
  });
  const lastPage = Math.max(0, Math.ceil(filtered.length / 12) - 1),
    currentPage = Math.min(page, lastPage),
    list = filtered.slice(currentPage * 12, currentPage * 12 + 12);
  const liveSelection = selected.filter((id) => npcs.some((c) => c.id === id));
  function navigate(id: string) {
    setCurrent(id);
    setPage(0);
    setSelected([]);
    setError('');
    if (id !== 'all' && id !== 'unfiled')
      setExpanded((old) => [...new Set([...old, ...folderChain(folders, id).map((row) => row.id)])]);
  }
  function locate(id: string) {
    setSearch('');
    setScope('current');
    navigate(id);
  }
  function begin(kind: Action['kind'], id = concrete ? current : null, ids?: string[]) {
    setAction({ kind, id, ids });
    setActionName(kind === 'rename' ? folders.find((row) => row.id === id)?.name || '' : '');
    setDestination(kind === 'delete' ? 'PARENT' : '');
    setError('');
  }
  async function run(work: () => Promise<unknown>, done?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      done?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const command = (kind: string, payload: Record<string, unknown>) =>
    mutate(`npcDirectory.${kind}`, { version: directory.revision, ...payload });
  const childrenOf = (id: string | null) =>
    folders.filter((row) => row.parentId === id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  function count(id: string) {
    const ids = folderDescendants(folders, id);
    return npcs.filter((c) => ids.has(classification.get(c.id) || '')).length;
  }
  function tree(parentId: string | null, depth = 0): ReactNode {
    return childrenOf(parentId).map((row: NpcFolder) => (
      <div key={row.id}>
        <div className={`npc-tree-row ${current === row.id ? 'is-current' : ''}`} style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            aria-label={`${expanded.includes(row.id) ? '收起' : '展开'}目录 ${row.name}`}
            aria-expanded={expanded.includes(row.id)}
            onClick={() =>
              setExpanded((old) => (old.includes(row.id) ? old.filter((id) => id !== row.id) : [...old, row.id]))
            }
          >
            {expanded.includes(row.id) ? '▾' : '▸'}
          </button>
          <button type="button" title={folderPath(folders, row.id)} onClick={() => navigate(row.id)}>
            {row.name}
            <span>{count(row.id)}</span>
          </button>
        </div>
        {expanded.includes(row.id) && tree(row.id, depth + 1)}
      </div>
    ));
  }
  const actionFolder = folders.find((row) => row.id === action?.id);
  const excluded = action?.kind === 'move' && action.id ? folderDescendants(folders, action.id) : new Set<string>();
  return (
    <section className="npc-manager" aria-label="GM NPC目录管理">
      <div className="npc-manager-heading">
        <button className="btn" onClick={() => setCollapsed((old) => !old)} aria-expanded={!collapsed}>
          {collapsed ? '展开目录' : '收起目录'}
        </button>
        <nav aria-label="NPC目录路径">
          <button onClick={() => locate('all')}>全部 NPC</button>
          {current === 'unfiled' ? (
            <span> / 未分类</span>
          ) : (
            folderChain(folders, concrete ? current : null).map((row) => (
              <span key={row.id}>
                {' '}
                / <button onClick={() => locate(row.id)}>{row.name}</button>
              </span>
            ))
          )}
        </nav>
      </div>
      <div className={`npc-browser ${collapsed ? 'is-collapsed' : ''}`}>
        {!collapsed && (
          <aside className="npc-tree" aria-label="NPC目录树">
            <button className={`npc-fixed ${current === 'all' ? 'is-current' : ''}`} onClick={() => navigate('all')}>
              全部 NPC <span>{npcs.length}</span>
            </button>
            <button
              className={`npc-fixed ${current === 'unfiled' ? 'is-current' : ''}`}
              onClick={() => navigate('unfiled')}
            >
              未分类 <span>{npcs.filter((c) => !classification.has(c.id)).length}</span>
            </button>
            {tree(null)}
            <button className="btn w-full mt-2" disabled={busy} onClick={() => begin('create', null)}>
              新建根目录
            </button>
          </aside>
        )}
        <div className="npc-results">
          <div className="npc-toolbar">
            <button className="btn" disabled={busy} onClick={() => begin('create')}>
              {concrete ? '新建子目录' : '新建目录'}
            </button>
            {concrete && (
              <>
                <button className="btn" disabled={busy} onClick={() => begin('rename')}>
                  重命名
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  aria-label="目录上移"
                  onClick={() => void run(() => command('sort', { id: current, direction: -1 }))}
                >
                  ↑
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  aria-label="目录下移"
                  onClick={() => void run(() => command('sort', { id: current, direction: 1 }))}
                >
                  ↓
                </button>
                <button className="btn" disabled={busy} onClick={() => begin('move')}>
                  移动目录
                </button>
                <button className="btn" disabled={busy} onClick={() => begin('delete')}>
                  删除目录
                </button>
              </>
            )}
          </div>
          {action && (
            <form
              className="npc-action panel"
              aria-label="目录操作"
              onSubmit={(event) => {
                event.preventDefault();
                const payload =
                  action.kind === 'create'
                    ? { name: actionName, parentId: action.id }
                    : action.kind === 'rename'
                      ? { id: action.id, name: actionName }
                      : action.kind === 'delete'
                        ? { id: action.id, destination }
                        : action.kind === 'assign'
                          ? { characterIds: action.ids, parentId: destination || null }
                          : { id: action.id, parentId: destination || null };
                void run(
                  () => command(action.kind, payload),
                  () => {
                    setAction(null);
                    setSelected([]);
                  },
                );
              }}
            >
              <strong>
                {
                  {
                    create: '新建目录',
                    rename: '重命名目录',
                    move: '移动目录到…',
                    delete: '删除目录',
                    assign: `移动 ${action.ids?.length || 0} 个 NPC 到…`,
                  }[action.kind]
                }
              </strong>
              {action.kind === 'create' || action.kind === 'rename' ? (
                <input
                  className="input"
                  autoFocus
                  aria-label="目录名称"
                  maxLength={100}
                  value={actionName}
                  onChange={(e) => setActionName(e.target.value)}
                />
              ) : action.kind === 'delete' ? (
                <>
                  <p>
                    仅删除「{actionFolder?.name}」目录。直接子目录 {childrenOf(action.id).length} 个，直接 NPC{' '}
                    {directory.classifications.filter((row) => row.folderId === action.id).length} 个；不会删除
                    NPC，子目录内部保持不变。
                  </p>
                  <select
                    className="input"
                    aria-label="删除后的去向"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="PARENT">移至上级（根目录的 NPC 归未分类）</option>
                    <option value="ROOT">移至根级（NPC 归未分类）</option>
                  </select>
                </>
              ) : (
                <select
                  className="input"
                  aria-label="移动目标目录"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">{action.kind === 'assign' ? '未分类' : '根级'}</option>
                  {folders
                    .filter((row) => !excluded.has(row.id))
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {folderPath(folders, row.id)}
                      </option>
                    ))}
                </select>
              )}
              <div className="npc-toolbar">
                <button
                  className="btn btn-primary"
                  disabled={busy || ((action.kind === 'create' || action.kind === 'rename') && !actionName.trim())}
                >
                  {busy ? '保存中…' : '确认'}
                </button>
                <button className="btn" type="button" disabled={busy} onClick={() => setAction(null)}>
                  取消
                </button>
              </div>
            </form>
          )}
          <form
            className="npc-create panel"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim())
                void run(
                  () =>
                    mutate('character.create', {
                      name: name.trim(),
                      isNpc: true,
                      visibility: hidden ? 'GM' : 'PUBLIC',
                      npcFolderId: concrete ? current : null,
                    }),
                  () => setName(''),
                );
            }}
          >
            <label>
              新 NPC 名称
              <input
                className="input"
                aria-label="新 NPC 名称"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="npc-toolbar">
              <label>
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />仅 GM 可见
              </label>
              <button className="btn btn-primary" disabled={busy || !name.trim()}>
                创建 NPC
              </button>
            </div>
            <p className="tiny subtle">
              归入：{concrete ? folderPath(folders, current) : '未分类'}。目录不会改变可见范围。
            </p>
          </form>
          <div className="npc-toolbar">
            <input
              className="input npc-search"
              aria-label="搜索NPC名称"
              placeholder="搜索 NPC 名称"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <select
              className="input"
              aria-label="搜索范围"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(0);
              }}
            >
              <option value="current">当前目录</option>
              <option value="all">全部 NPC</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={includeChildren}
                onChange={(e) => {
                  setIncludeChildren(e.target.checked);
                  setPage(0);
                }}
              />
              包含子目录
            </label>
          </div>
          <div className="npc-toolbar tiny">
            <label>
              <input
                type="checkbox"
                aria-label="选择本页NPC"
                checked={list.length > 0 && list.every((c) => liveSelection.includes(c.id))}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...new Set([...liveSelection, ...list.map((c) => c.id)])]
                      : liveSelection.filter((id) => !list.some((c) => c.id === id)),
                  )
                }
              />
              本页全选
            </label>
            <span>
              筛选结果 {filtered.length} 个 · 已选 {liveSelection.length} 个
            </span>
            <button
              className="btn"
              disabled={busy || !liveSelection.length}
              onClick={() => begin('assign', null, liveSelection)}
            >
              批量移动到…
            </button>
          </div>
          <div className="npc-card-grid">
            {list.map((c) => (
              <div className="npc-card" key={c.id}>
                <div className="npc-card-tools">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${c.name}`}
                      checked={liveSelection.includes(c.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? [...liveSelection, c.id] : liveSelection.filter((id) => id !== c.id),
                        )
                      }
                    />
                    选择
                  </label>
                  <button disabled={busy} onClick={() => begin('assign', null, [c.id])}>
                    移动到…
                  </button>
                </div>
                {renderCard(c)}
                <button
                  className="npc-path"
                  title="定位目录"
                  onClick={() => locate(classification.get(c.id) || 'unfiled')}
                >
                  {folderPath(folders, classification.get(c.id) || null)}
                </button>
              </div>
            ))}
          </div>
          {!list.length && (
            <p className="empty-note">
              {search ? '没有匹配的 NPC，可切换搜索范围。' : '此目录暂无 NPC，可创建或移动 NPC 到这里。'}
            </p>
          )}
          <div className="npc-toolbar npc-pagination">
            <button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              第 {currentPage + 1} / {lastPage + 1} 页 · {filtered.length} 个
            </span>
            <button className="btn" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="npc-error">
          {error}
        </p>
      )}
      <p className="tiny subtle">目录仅 GM 可见。拖动 NPC 头像可放置地图棋子，目录不决定角色的公开范围。</p>
    </section>
  );
}
