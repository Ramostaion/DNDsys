import { useEffect, useRef, useState } from 'react';
import { createId } from '../../id';
import { post, request } from '../../api';
import { presentationPath, type PresentationAsset, type PresentationCurrent } from './usePresentation';
import { useClueState } from '../private-clues/usePrivateClues';
import { useUI } from '../../store';

type Props = { roomId: string; current: PresentationCurrent | null; refresh: () => Promise<void> };
type UploadTask = { file: File; progress: number; error: string; done: boolean };
type Group = { id: string; name: string; sortOrder: number };
type Cue = {
  id: string;
  assetId: string;
  groupId: string | null;
  sortOrder: number;
  transition: string;
  captionOverride: string | null;
  asset: { title: string };
};
type Transition = 'none' | 'fade' | 'black_reveal' | 'slow_zoom';

export default function DirectorConsole({ roomId, current, refresh }: Props) {
  const clues = useClueState();
  const [assets, setAssets] = useState<PresentationAsset[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [tasks, setTasks] = useState<UploadTask[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [allowHistory, setAllowHistory] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]),
    [cues, setCues] = useState<Cue[]>([]),
    [groupId, setGroupId] = useState(''),
    [groupName, setGroupName] = useState(''),
    [search, setSearch] = useState(''),
    [transition, setTransition] = useState<Transition>('none'),
    [mode, setMode] = useState<'floating' | 'cinematic'>('cinematic');
  const [draft, setDraft] = useState({ title: '', caption: '', gmNotes: '', tags: '', sortOrder: 0 });
  const loadSerial = useRef(0);
  const base = presentationPath(roomId);
  async function reload() {
    const serial = ++loadSerial.current;
    try {
      const [images, chapters, entries] = await Promise.all([
        request<PresentationAsset[]>(`${base}/assets`),
        request<Group[]>(`${base}/groups`),
        request<Cue[]>(`${base}/cues`),
      ]);
      if (serial === loadSerial.current) {
        setAssets(images);
        setGroups(chapters);
        setCues(entries);
      }
    } catch (e) {
      if (serial === loadSerial.current) setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
  }, [roomId]);
  const chosen = assets.find((asset) => asset.id === selected) || null;
  useEffect(() => {
    if (chosen)
      setDraft({
        title: chosen.title,
        caption: chosen.caption,
        gmNotes: chosen.gmNotes || '',
        tags: (chosen as PresentationAsset & { tags?: string[] }).tags?.join('、') || '',
        sortOrder: chosen.sortOrder || 0,
      });
  }, [chosen?.id]);
  const shown = assets.filter(
    (asset) =>
      (!groupId || asset.groupId === groupId) &&
      (!search || `${asset.title} ${asset.caption}`.toLowerCase().includes(search.toLowerCase())),
  );
  async function change(path: string, method: 'PATCH' | 'DELETE', body: unknown) {
    try {
      await request(`${base}${path}`, { method, body: JSON.stringify(body) });
      await reload();
      setMessage('已保存');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function createGroup() {
    if (!groupName.trim()) return;
    try {
      const group = await post<Group>(`${base}/groups`, { name: groupName.trim() });
      setGroupId(group.id);
      setGroupName('');
      await reload();
      setMessage('章节已创建');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function createCue() {
    if (!chosen) return;
    try {
      await post(`${base}/cues`, { assetId: chosen.id, groupId: groupId || null, transition });
      await reload();
      setMessage('演出条目已加入');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function uploadOne(file: File) {
    setTasks((old) => [...old, { file, progress: 0, error: '', done: false }]);
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest(),
        form = new FormData();
      form.append('file', file);
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      xhr.open('POST', `/api${base}/assets`);
      xhr.withCredentials = true;
      xhr.timeout = 30_000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          setTasks((old) =>
            old.map((task) =>
              task.file === file ? { ...task, progress: Math.round((event.loaded / event.total) * 100) } : task,
            ),
          );
      };
      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 201) {
          loadSerial.current++;
          setAssets((old) => (old.some((asset) => asset.id === data.id) ? old : [...old, data]));
          setSelected(data.id);
          setTasks((old) =>
            old.map((task) => (task.file === file ? { ...task, progress: 100, done: true, error: '' } : task)),
          );
        } else
          setTasks((old) =>
            old.map((task) =>
              task.file === file ? { ...task, error: data.error || `上传失败 (${xhr.status})` } : task,
            ),
          );
        resolve();
      };
      xhr.onerror = () => {
        setTasks((old) => old.map((task) => (task.file === file ? { ...task, error: '网络中断，请重试' } : task)));
        resolve();
      };
      xhr.ontimeout = () => {
        setTasks((old) => old.map((task) => (task.file === file ? { ...task, error: '上传超时，请重试' } : task)));
        resolve();
      };
      xhr.send(form);
    });
  }
  async function command(type: 'play' | 'blackout' | 'unblackout' | 'end', assetId?: string, cueId?: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await post(`${base}/commands`, {
        id: createId(),
        version: current?.revision ?? 0,
        type,
        assetId,
        cueId,
        allowHistory,
        requestedMode: mode,
        transition,
      });
      await refresh();
      await reload();
      setMessage(
        type === 'play'
          ? '已向全房间放映'
          : type === 'end'
            ? '放映已结束'
            : type === 'blackout'
              ? '已切为黑幕'
              : '已解除黑幕',
      );
    } catch (e) {
      setMessage((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  function step(delta: number) {
    if (cues.length) {
      const index = cues.findIndex((item) => item.id === current?.activeCueId),
        next = cues[(index + delta + cues.length) % cues.length];
      if (next) void command('play', undefined, next.id);
      return;
    }
    if (!assets.length) return;
    const index = assets.findIndex((item) => item.id === current?.asset?.id),
      next = assets[(index + delta + assets.length) % assets.length];
    if (next) void command('play', next.id);
  }
  return (
    <div className="presentation-director space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">SCENE DIRECTOR</div>
          <h3 className="display-title text-xl">剧情导演台</h3>
        </div>
        <span className="badge">
          {current?.status === 'showing' ? '正在放映' : current?.status === 'blackout' ? '黑幕中' : '未放映'}
        </span>
      </div>
      <label className="btn cursor-pointer">
        选择剧情图片
        <input
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.currentTarget.value = '';
            for (const file of files) await uploadOne(file);
          }}
        />
      </label>
      {tasks
        .filter((task) => !task.done)
        .map((task, index) => (
          <div className="tiny grid-card" key={`${task.file.name}-${index}`}>
            {task.file.name} · {task.error || `上传中 ${task.progress}%`}
            {task.error && (
              <button className="btn ml-2" onClick={() => void uploadOne(task.file)}>
                重试
              </button>
            )}
          </div>
        ))}
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="章节筛选" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">全部章节</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <input
          aria-label="搜索剧情图片"
          className="input"
          placeholder="搜索标题或说明"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <input
          aria-label="新章节名称"
          className="input"
          placeholder="新章节名称"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
        />
        <button className="btn" onClick={() => void createGroup()}>
          创建章节
        </button>
      </div>
      <div className="presentation-asset-list">
        {shown.map((asset) => (
          <button
            key={asset.id}
            className={`presentation-asset ${selected === asset.id ? 'selected' : ''}`}
            onClick={() => setSelected(asset.id)}
          >
            <img src={asset.thumbUrl} alt="" />
            <span>{asset.title}</span>
            {current?.asset?.id === asset.id && <span className="badge">放映中</span>}
          </button>
        ))}
      </div>
      {chosen ? (
        <div className="presentation-preview">
          <img src={chosen.screenUrl} alt={chosen.title} />
          <div className="p-3">
            <strong>{chosen.title}</strong>
            {chosen.caption && <p className="tiny subtle mt-1">{chosen.caption}</p>}
            <p className="tiny subtle mt-2">此处仅 GM 可见；点击放映后才通知玩家。</p>
          </div>
        </div>
      ) : (
        <div className="empty-note">上传图片并选择一张，先在这里私下预览。</div>
      )}
      {chosen && (
        <button
          className="btn"
          onClick={() => {
            clues.selectAsset(chosen.id);
            useUI.getState().open('private-clues');
          }}
        >
          发送为私密线索（选择接收人后发送）
        </button>
      )}
      {chosen && (
        <div className="grid-card space-y-2">
          <div className="font-semibold">素材信息</div>
          <input
            aria-label="图片标题"
            className="input"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            aria-label="玩家可见说明"
            className="input"
            placeholder="玩家可见说明"
            value={draft.caption}
            onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
          />
          <textarea
            aria-label="GM 私人备注"
            className="input"
            placeholder="GM 私人备注"
            value={draft.gmNotes}
            onChange={(e) => setDraft({ ...draft, gmNotes: e.target.value })}
          />
          <input
            aria-label="图片标签"
            className="input"
            placeholder="标签，用顿号分隔"
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
          <div className="flex gap-2 items-center">
            <label className="tiny">
              排序
              <input
                aria-label="图片排序"
                className="input"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
              />
            </label>
            <select
              aria-label="素材所属章节"
              className="input"
              value={chosen.groupId || ''}
              onChange={(e) => void change(`/assets/${chosen.id}`, 'PATCH', { groupId: e.target.value || null })}
            >
              <option value="">未分类</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() =>
                void change(`/assets/${chosen.id}`, 'PATCH', {
                  title: draft.title,
                  caption: draft.caption,
                  gmNotes: draft.gmNotes,
                  tags: draft.tags
                    .split(/[、,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  sortOrder: draft.sortOrder,
                })
              }
            >
              保存素材信息
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const count = cues.filter((cue) => cue.assetId === chosen.id).length;
                const active = current?.asset?.id === chosen.id;
                if (
                  !confirm(
                    `删除「${chosen.title}」？${active ? '正在放映的画面会结束。' : ''}${count ? `这张图被 ${count} 个条目引用，关联条目也会删除。` : ''}`,
                  )
                )
                  return;
                try {
                  await request(`${base}/assets/${chosen.id}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ confirm: true }),
                  });
                  setSelected(null);
                  await reload();
                  await refresh();
                  setMessage('素材已删除');
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              删除素材
            </button>
          </div>
        </div>
      )}
      <div className="grid-card space-y-2">
        <div className="font-semibold">演出条目</div>
        <p className="tiny subtle">同一图片可以加入多个条目；删除条目不会删除图片。</p>
        <div className="flex gap-2">
          <select
            aria-label="转场方式"
            className="input"
            value={transition}
            onChange={(e) => setTransition(e.target.value as Transition)}
          >
            <option value="none">立即替换</option>
            <option value="fade">淡入</option>
            <option value="black_reveal">黑幕揭晓</option>
            <option value="slow_zoom">缓慢推近</option>
          </select>
          <button className="btn" disabled={!chosen} onClick={() => void createCue()}>
            加入条目
          </button>
        </div>
        {cues.map((cue) => (
          <div key={cue.id} className="flex gap-2 items-center tiny">
            <span className="flex-1 truncate">
              {cue.asset.title} · {groups.find((group) => group.id === cue.groupId)?.name || '未分类'} ·{' '}
              {cue.transition}
            </span>
            <button className="btn" disabled={busy} onClick={() => void command('play', undefined, cue.id)}>
              放映
            </button>
            <button
              className="btn"
              onClick={() => void change(`/cues/${cue.id}`, 'PATCH', { sortOrder: cue.sortOrder - 1 })}
            >
              ↑
            </button>
            <button
              className="btn btn-danger"
              onClick={() =>
                confirm('只删除这个演出条目？原图片会保留。') && void change(`/cues/${cue.id}`, 'DELETE', {})
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <label className="tiny flex items-center gap-2">
        <input type="checkbox" checked={allowHistory} onChange={(e) => setAllowHistory(e.target.checked)} />
        放映后加入玩家线索图库
      </label>
      <label className="tiny flex items-center gap-2">
        建议观看方式
        <select
          className="input !w-auto"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'floating' | 'cinematic')}
        >
          <option value="floating">普通浮窗</option>
          <option value="cinematic">沉浸大屏（默认）</option>
        </select>
      </label>
      <button className="btn" onClick={() => window.open(`/rooms/${roomId}/presentation`, '_blank', 'noopener')}>
        打开只读观众页
      </button>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy || !assets.length} onClick={() => step(-1)}>
          上一张
        </button>
        <button className="btn btn-primary" disabled={busy || !chosen} onClick={() => void command('play', chosen!.id)}>
          {busy ? '正在提交…' : '向房间展示'}
        </button>
        <button className="btn" disabled={busy || !assets.length} onClick={() => step(1)}>
          下一张
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void command(current?.status === 'blackout' ? 'unblackout' : 'blackout')}
        >
          {current?.status === 'blackout' ? '解除黑幕' : '黑幕'}
        </button>
        <button
          className="btn btn-danger"
          disabled={busy || current?.status === 'idle'}
          onClick={() => void command('end')}
        >
          结束
        </button>
      </div>
      {message && (
        <p role="status" className="tiny text-amber-200">
          {message}
        </p>
      )}
    </div>
  );
}
