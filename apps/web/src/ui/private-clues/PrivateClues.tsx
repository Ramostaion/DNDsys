import { useEffect, useRef, useState } from 'react';
import { createId } from '../../id';
import { Mail, Star, ImagePlus, Send, LockKeyhole, ArrowLeft, Copy } from 'lucide-react';
import { request, post, type Snapshot } from '../../api';
import { useUI } from '../../store';
import ImageViewport from '../presentation/ImageViewport';
import TagMarkdown from '../character-tags/TagMarkdown';
import { cluePath, useClueState, type Clue, type Attachment } from './usePrivateClues';
import { draftKey, emptyDraft, readDraft, writeDraft, type Draft } from './draft';
import type { PresentationAsset } from '../presentation/usePresentation';
import '../../character-tags.css';
import './private-clues.css';

type Props = { snap: Snapshot; me: any; isGM: boolean };
const time = (date: string | null | undefined) =>
  date ? new Date(date).toLocaleString('zh-CN', { hour12: false }) : '未读';
function Failure({ error, retry }: { error: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="clue-error">
      {error}
      <button className="btn" onClick={retry}>
        重试
      </button>
    </div>
  ) : null;
}
function Thumbnail({ attachment }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="clue-thumb-failed">缩略图暂不可用，仍可打开原图。</span>
  ) : (
    <img
      className="private-clue-thumb"
      src={attachment.thumbUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
function RecipientPicker({
  p,
  value,
  onChange,
  exclude,
}: {
  p: Props;
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: string;
}) {
  const [search, setSearch] = useState('');
  const members = p.snap.members.filter((m) => m.userId !== exclude);
  return (
    <fieldset className="clue-recipient-picker">
      <legend className="label">接收人（玩家账号）</legend>
      <input
        className="input"
        aria-label="搜索接收人"
        placeholder="搜索玩家昵称或角色"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="clue-actions">
        <button type="button" className="btn" onClick={() => onChange(members.map((m) => m.userId))}>
          全选成员
        </button>
        <button type="button" className="btn" onClick={() => onChange([])}>
          清空选择
        </button>
      </div>
      <div className="clue-recipient-grid">
        {members
          .filter((m) =>
            `${m.user.username} ${p.snap.characters
              .filter((c) => c.ownerId === m.userId)
              .map((c) => c.name)
              .join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((m) => (
            <label key={m.userId} className={`clue-recipient ${value.includes(m.userId) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={value.includes(m.userId)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, m.userId] : value.filter((id) => id !== m.userId))
                }
              />
              <span className="clue-recipient-avatar">
                {m.user.avatarUrl ? <img src={m.user.avatarUrl} alt="" /> : m.user.username.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <strong>{m.user.username}</strong>
                <small>
                  {p.snap.characters
                    .filter((c) => c.ownerId === m.userId)
                    .map((c) => c.name)
                    .join('、') || (m.role === 'GM' ? 'GM' : '暂无角色')}
                </small>
              </span>
            </label>
          ))}
      </div>
      <p className="clue-confirm-recipients">
        {value.length
          ? `发送给 ${value.length} 人：${members
              .filter((m) => value.includes(m.userId))
              .map((m) => m.user.username)
              .join('、')}`
          : '请选择至少一名接收人'}
      </p>
    </fieldset>
  );
}
export default function PrivateClues({ p, windowId }: { p: Props; windowId: string }) {
  const state = useClueState(),
    [tab, setTab] = useState(p.isGM ? 'compose' : 'inbox');
  useEffect(() => {
    if (state.assetRequest) setTab('compose');
  }, [state.assetRequest]);
  return (
    <div className="private-clues">
      <div className="clue-heading">
        <div>
          <div className="eyebrow">SEALED CLUES</div>
          <h3 className="display-title text-xl">私密线索</h3>
        </div>
        <LockKeyhole size={22} />
      </div>
      <div className="clue-tabs" role="tablist">
        {(p.isGM
          ? [
              ['compose', '私密投递'],
              ['sent', 'GM 发件箱'],
              ['inbox', '我的收件箱'],
            ]
          : [['inbox', '我的收件箱']]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`btn ${tab === key ? 'btn-primary' : ''}`}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'inbox' && state.unreadCount > 0 ? ` (${state.unreadCount})` : ''}
          </button>
        ))}
      </div>
      {/* Keep the composer mounted when switching tabs, including an upload in progress. */}
      {p.isGM && (
        <div hidden={tab !== 'compose'}>
          <Composer p={p} windowId={windowId} />
        </div>
      )}
      {tab === 'sent' && <SentBox p={p} />}
      <div hidden={tab !== 'inbox'}>
        <Inbox p={p} />
      </div>
    </div>
  );
}
type UploadTask = { id: string; file: File; progress: number; error: string; done: boolean };
function Composer({ p, windowId }: { p: Props; windowId: string }) {
  const base = cluePath(p.snap.room.id),
    key = draftKey(p.snap.room.id, p.me.id),
    state = useClueState();
  const [draft, setDraft] = useState<Draft>(() => readDraft(key)),
    [tasks, setTasks] = useState<UploadTask[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false),
    [storageFailed, setStorageFailed] = useState(false);
  const [assets, setAssets] = useState<PresentationAsset[] | null>(null),
    [image, setImage] = useState<Attachment | null>(null),
    [galleryError, setGalleryError] = useState('');
  const pending = useRef(false),
    requests = useRef<Set<XMLHttpRequest>>(new Set()),
    live = useRef(true),
    latest = useRef(draft),
    handledAsset = useRef<string | null>(null);
  latest.current = draft;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const xhr of requests.current) xhr.abort();
    };
  }, []);
  useEffect(() => {
    setStorageFailed(!writeDraft(key, draft));
  }, [key, draft]);
  useEffect(() => {
    useUI.getState().setCloseGuard(windowId, () => {
      if (requests.current.size)
        return confirm('图片仍在上传，关闭将中止上传。文字草稿已保留，重新打开后可选择图片重试。是否关闭？');
      return writeDraft(key, latest.current) || confirm('浏览器无法保存草稿，关闭会丢失输入。请先复制正文。仍然关闭？');
    });
    return () => useUI.getState().setCloseGuard(windowId);
  }, [windowId, key]);
  const locked = busy || !!draft.operationId,
    uploading = tasks.some((t) => !t.error && !t.done);
  function edit(update: Partial<Draft>) {
    setDraft((old) => ({ ...old, ...update }));
    setError('');
    setMessage('');
  }
  async function uploadOne(task: UploadTask) {
    setTasks((old) =>
      old.some((t) => t.id === task.id)
        ? old.map((t) => (t.id === task.id ? { ...task, error: '', progress: 0 } : t))
        : [...old, task],
    );
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest(),
        form = new FormData();
      form.append('file', task.file);
      requests.current.add(xhr);
      xhr.open('POST', `/api${base}/attachments`);
      xhr.withCredentials = true;
      xhr.timeout = 60000;
      const finish = (error: string) => {
        requests.current.delete(xhr);
        if (live.current) setTasks((old) => old.map((t) => (t.id === task.id ? { ...t, error } : t)));
        resolve();
      };
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && live.current)
          setTasks((old) =>
            old.map((t) => (t.id === task.id ? { ...t, progress: Math.round((e.loaded / e.total) * 100) } : t)),
          );
      };
      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 201) {
          // Persist successful uploads even if the user closes the floating window at this point.
          const current = live.current ? latest.current : readDraft(key),
            next = { ...current, attachments: [...current.attachments, data] };
          writeDraft(key, next);
          if (live.current) {
            setDraft((old) => ({ ...old, attachments: [...old.attachments, data] }));
            setTasks((old) => old.map((t) => (t.id === task.id ? { ...t, progress: 100, done: true, error: '' } : t)));
          }
          finish('');
        } else finish(data.error || `上传失败 (${xhr.status})，正文与接收人已保留`);
      };
      xhr.onerror = () => finish('网络中断，正文与接收人已保留');
      xhr.ontimeout = () => finish('上传超时，请重试');
      xhr.onabort = () => finish('上传已中止，请重新选择图片');
      xhr.send(form);
    });
  }
  async function chooseFiles(files: File[]) {
    const remaining = 5 - latest.current.attachments.length - tasks.filter((t) => !t.done).length;
    if (files.length > remaining) {
      setError('每条线索最多 5 张图片，请移除多余附件或失败任务。');
      return;
    }
    for (const file of files) await uploadOne({ id: createId(), file, progress: 0, error: '', done: false });
  }
  async function gallery() {
    setGalleryError('');
    try {
      setAssets(await request(`${base.replace('/private-clues', '/presentation')}/assets`));
    } catch (e) {
      setGalleryError((e as Error).message);
    }
  }
  async function importAsset(asset: PresentationAsset) {
    if (pending.current || draft.attachments.length >= 5) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const attachment = await post<Attachment>(`${base}/attachments/from-presentation`, { assetId: asset.id });
      const current = live.current ? latest.current : readDraft(key),
        next = {
          ...current,
          title: current.title || asset.title,
          bodyMarkdown: current.bodyMarkdown || asset.caption,
          attachments: [...current.attachments, attachment],
        };
      writeDraft(key, next);
      if (live.current) {
        setDraft(next);
        setAssets(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!state.assetRequest) {
      handledAsset.current = null;
      return;
    }
    if (handledAsset.current === state.assetRequest) return;
    handledAsset.current = state.assetRequest;
    if (locked || uploading) {
      setError('请先完成当前上传或待确认投递，再从导演台选择图片。');
      state.selectAsset(null);
      return;
    }
    const assetId = state.assetRequest;
    state.selectAsset(null);
    if (draft.attachments.length >= 5) {
      setError('当前草稿已有 5 张图片，请先移除一张。');
      return;
    }
    void request<PresentationAsset[]>(`${base.replace('/private-clues', '/presentation')}/assets`)
      .then((rows) => {
        const asset = rows.find((a) => a.id === assetId);
        if (asset) void importAsset(asset);
        else setError('剧情素材已不存在。');
      })
      .catch((e) => setError((e as Error).message));
  }, [state.assetRequest]);
  async function send() {
    if (pending.current) return;
    if (
      !draft.title.trim() ||
      (!draft.bodyMarkdown.trim() && !draft.attachments.length) ||
      !draft.recipientUserIds.length
    ) {
      setError('请填写标题、正文或图片，并选择接收人。');
      return;
    }
    const value = { ...draft, operationId: draft.operationId || createId() };
    setDraft(value);
    writeDraft(key, value);
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await post(`${base}/send`, {
        id: value.operationId,
        title: value.title,
        bodyMarkdown: value.bodyMarkdown,
        gmNote: value.gmNote,
        associatedCharacterId: value.associatedCharacterId || undefined,
        allowForward: value.allowForward,
        recipientUserIds: value.recipientUserIds,
        attachmentIds: value.attachments.map((a) => a.id),
      });
      const cleared = emptyDraft();
      writeDraft(key, cleared);
      if (live.current) {
        setDraft(cleared);
        setTasks([]);
        setPreview(false);
        setImage(null);
        setMessage(`已私密发送给 ${value.recipientUserIds.length} 人；离线成员上线后也能收取。`);
      }
      await state.refresh();
    } catch (e) {
      const cause = e as Error & { status?: number };
      if (live.current) {
        if (cause.status && cause.status >= 400 && cause.status < 500) {
          setDraft({ ...value, operationId: null });
          setError(`${cause.message}，草稿已保留。`);
        } else setError(`发送状态待确认：${cause.message}。请点击「确认状态并重试」，将使用同一操作，不会重复投递。`);
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  function clear() {
    if (locked) return;
    if (!confirm('清空当前草稿？已发送线索不会受影响。')) return;
    setDraft(emptyDraft());
    setTasks([]);
    setImage(null);
    setError('');
  }
  return (
    <div className="clue-compose space-y-3">
      <p className="tiny subtle">仅选中的账号能收到。草稿自动保留在此浏览器，关闭窗口后可继续编辑。</p>
      {storageFailed && (
        <p role="alert" className="clue-error">
          浏览器无法保存草稿，请保持窗口打开并复制正文备份。
        </p>
      )}
      <fieldset disabled={locked} className="space-y-3">
        <label className="block">
          <span className="label">线索标题</span>
          <input
            aria-label="线索标题"
            className="input"
            maxLength={100}
            value={draft.title}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">线索正文</span>
          <textarea
            aria-label="线索正文"
            className="input clue-body-input"
            placeholder="可使用换行、列表、**加粗**和引用"
            maxLength={30000}
            value={draft.bodyMarkdown}
            onChange={(e) => edit({ bodyMarkdown: e.target.value })}
          />
        </label>
        <div className="clue-actions">
          <label className={`btn ${uploading ? 'opacity-50' : ''}`}>
            <ImagePlus size={16} />
            上传私密图片
            <input
              hidden
              aria-label="上传私密图片"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploading || locked}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files || []);
                e.currentTarget.value = '';
                void chooseFiles(files);
              }}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={uploading || draft.attachments.length >= 5}
            onClick={() => void gallery()}
          >
            从剧情图库选择
          </button>
        </div>
        <p className="tiny subtle">每条最多 5 张，JPEG / PNG / WebP，单张不超过 10MB。</p>
        <div className="clue-attachments">
          {draft.attachments.map((a) => (
            <div key={a.id} className="clue-attachment">
              <button type="button" aria-label={`预览 ${a.filename}`} onClick={() => setImage(a)}>
                <Thumbnail attachment={a} />
                <span>{a.filename}</span>
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  edit({ attachments: draft.attachments.filter((item) => item.id !== a.id) });
                  if (image?.id === a.id) setImage(null);
                }}
              >
                移除
              </button>
              {a.previouslyPublic && (
                <p className="clue-public-warning">此图片可能已经公开；如需隐藏内容，请使用私密上传版本。</p>
              )}
            </div>
          ))}
        </div>
        {assets && (
          <div className="clue-gallery">
            <div className="clue-actions">
              <strong>选择剧情素材（不会改变当前放映）</strong>
              <button type="button" className="btn" onClick={() => setAssets(null)}>
                收起图库
              </button>
            </div>
            <div className="presentation-asset-list">
              {assets.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  className="presentation-asset"
                  onClick={() => void importAsset(asset)}
                >
                  <img src={asset.thumbUrl} alt="" />
                  <span>{asset.title}</span>
                  {asset.revealedAt && <small>曾公开</small>}
                </button>
              ))}
            </div>
          </div>
        )}
        {galleryError && <Failure error={galleryError} retry={() => void gallery()} />}
        <RecipientPicker
          p={p}
          value={draft.recipientUserIds}
          onChange={(recipientUserIds) => edit({ recipientUserIds })}
          exclude={p.me.id}
        />
        <details className="clue-options">
          <summary>整理与分享选项</summary>
          <label className="block mt-2">
            <span className="label">GM 私有备注（不会发送给玩家）</span>
            <textarea
              aria-label="线索 GM 私有备注"
              className="input"
              maxLength={5000}
              value={draft.gmNote}
              onChange={(e) => edit({ gmNote: e.target.value })}
            />
          </label>
          <label className="block mt-2">
            <span className="label">关联角色（仅作说明）</span>
            <select
              aria-label="线索关联角色"
              className="input"
              value={draft.associatedCharacterId}
              onChange={(e) => edit({ associatedCharacterId: e.target.value })}
            >
              <option value="">不关联</option>
              {p.snap.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex gap-2 items-center mt-2">
            <input
              type="checkbox"
              checked={draft.allowForward}
              onChange={(e) => edit({ allowForward: e.target.checked })}
            />
            允许接收人在本房间分享副本
          </label>
        </details>
      </fieldset>
      {tasks
        .filter((t) => !t.done)
        .map((t) => (
          <div key={t.id} className="clue-upload-task">
            <span>
              {t.file.name} · {t.error || `上传中 ${t.progress}%`}
            </span>
            {t.error ? (
              <>
                <button
                  className="btn"
                  disabled={locked || uploading}
                  onClick={() => void uploadOne({ ...t, error: '' })}
                >
                  重试上传
                </button>
                <button
                  className="btn"
                  disabled={locked}
                  onClick={() => setTasks((old) => old.filter((task) => task.id !== t.id))}
                >
                  移除失败任务
                </button>
              </>
            ) : (
              <progress value={t.progress} max={100} />
            )}
          </div>
        ))}
      {image && (
        <div className="clue-inline-image">
          <button className="btn" onClick={() => setImage(null)}>
            关闭图片预览
          </button>
          <ImageViewport key={image.id} src={image.originalUrl} title={image.filename} />
        </div>
      )}
      <div className="clue-preview-bar">
        <span>
          {draft.recipientUserIds.length} 人 · {draft.attachments.length} 张图片 · {draft.bodyMarkdown.length} 字
        </span>
        <button className="btn" onClick={() => setPreview(!preview)}>
          {preview ? '收起发送预览' : '预览发送内容'}
        </button>
      </div>
      {preview && (
        <div className="clue-preview">
          <h4>{draft.title || '未填写标题'}</h4>
          <TagMarkdown text={draft.bodyMarkdown} />
          <p className="tiny subtle">上方已选图片将一并发送；GM 私有备注不会发送。</p>
        </div>
      )}
      {error && (
        <p role="alert" className="clue-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="clue-success">
          {message}
        </p>
      )}
      <div className="clue-actions">
        <button className="btn" disabled={locked || uploading} onClick={clear}>
          清空草稿
        </button>
        <button
          className="btn btn-primary"
          disabled={
            busy ||
            uploading ||
            tasks.some((t) => !!t.error) ||
            !draft.recipientUserIds.length ||
            !draft.title.trim() ||
            (!draft.bodyMarkdown.trim() && !draft.attachments.length)
          }
          onClick={() => void send()}
        >
          <Send size={16} />
          {busy ? '发送中…' : draft.operationId ? '确认状态并重试' : `私密发送给 ${draft.recipientUserIds.length} 人`}
        </button>
      </div>
    </div>
  );
}
function ClueRow({ item, onOpen, sent = false }: { item: Clue; onOpen: () => void; sent?: boolean }) {
  return (
    <button
      className={`private-clue-row ${!sent && !item.readAt && !item.revokedAt ? 'unread' : ''} ${item.revokedAt ? 'revoked' : ''}`}
      onClick={onOpen}
    >
      {item.attachments[0] ? (
        <span className="clue-row-image">
          <Thumbnail attachment={item.attachments[0]} />
        </span>
      ) : (
        <span className="clue-row-seal">
          <Mail size={24} />
        </span>
      )}
      <span className="clue-row-text">
        <strong>{item.title}</strong>
        <small>
          {item.revokedAt
            ? '已撤回'
            : sent
              ? `${item.recipientCount} 名接收者 · ${item.readCount} 人已读`
              : `${item.sharedByName ? `${item.sharedByName} 分享 · ` : ''}GM ${item.senderName} · ${item.readAt ? '已读' : '未读'}`}
        </small>
        <time>{time(item.createdAt)}</time>
      </span>
      {item.savedAt && <Star size={17} fill="currentColor" />}
      {!sent && !item.readAt && !item.revokedAt && <span className="clue-unread-dot" aria-label="未读" />}
    </button>
  );
}
function Inbox({ p }: { p: Props }) {
  const state = useClueState(),
    open = useUI((s) => s.open),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const items = state.items.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'unread' && !c.readAt && !c.revokedAt) ||
        (filter === 'read' && !!c.readAt) ||
        (filter === 'saved' && !!c.savedAt)),
  );
  return (
    <div className="clue-inbox space-y-3">
      <p className="tiny subtle">这是 {p.me.username} 的私人收件箱；收到通知不会自动标为已读。</p>
      <div className="clue-filters">
        <input
          aria-label="搜索私人线索"
          className="input"
          placeholder="搜索标题"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" aria-label="私人线索筛选" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部</option>
          <option value="unread">未读</option>
          <option value="read">已读</option>
          <option value="saved">收藏</option>
        </select>
        <button className="btn" onClick={() => void state.refresh()}>
          刷新收件箱
        </button>
      </div>
      <Failure error={state.error} retry={() => void state.refresh()} />
      <div className="private-clue-list">
        {items.map((item) => (
          <ClueRow key={item.id} item={item} onOpen={() => open('clue-reader', item.id)} />
        ))}
      </div>
      {!items.length && (
        <div className="empty-note">
          {search || filter !== 'all' ? '没有符合条件的线索。' : '尚未收到私密线索。离线期间的投递也会保存在这里。'}
        </div>
      )}
    </div>
  );
}
function SentBox({ p }: { p: Props }) {
  const state = useClueState(),
    open = useUI((s) => s.open),
    [items, setItems] = useState<Clue[]>([]),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const serial = useRef(0);
  async function refresh() {
    const seq = ++serial.current;
    try {
      const rows = await request<Clue[]>(`${cluePath(p.snap.room.id)}/sent`);
      if (seq === serial.current) {
        setItems(rows);
        setError('');
      }
    } catch (e) {
      if (seq === serial.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [state.revision, p.snap.room.id]);
  return (
    <div className="clue-sent-box space-y-3">
      <div className="clue-filters">
        <input
          aria-label="搜索已发线索"
          className="input"
          placeholder="搜索标题或发送日期"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => void refresh()}>
          刷新发件箱
        </button>
      </div>
      <Failure error={error} retry={() => void refresh()} />
      {items
        .filter((c) => `${c.title} ${time(c.createdAt)}`.toLowerCase().includes(search.toLowerCase()))
        .map((c) => (
          <ClueRow key={c.id} item={c} sent onOpen={() => open('clue-sent', c.id)} />
        ))}
      {!items.length && <div className="empty-note">发送成功的线索及真实阅读回执会保存在这里。</div>}
    </div>
  );
}
export function ClueReader({ p, id, sent = false }: { p: Props; id?: string; sent?: boolean }) {
  const state = useClueState(),
    open = useUI((s) => s.open),
    [clue, setClue] = useState<Clue | null>(null),
    [error, setError] = useState(''),
    [syncError, setSyncError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [share, setShare] = useState(false),
    [recipients, setRecipients] = useState<string[]>([]),
    [shareOperation, setShareOperation] = useState<string | null>(null);
  const serial = useRef(0),
    marked = useRef(false),
    pending = useRef(false),
    retryAction = useRef<() => void>(() => {});
  const base = cluePath(p.snap.room.id),
    url = `${base}/${sent ? 'sent' : 'deliveries'}/${id}`;
  async function load() {
    const seq = ++serial.current;
    try {
      const value = await request<Clue>(url);
      if (seq === serial.current) {
        setClue(value);
        setError('');
      }
    } catch (e) {
      if (seq === serial.current) {
        const cause = e as Error & { status?: number };
        if (cause.status === 403 || cause.status === 404) setClue(null);
        setError(cause.message);
      }
    }
  }
  useEffect(() => {
    marked.current = false;
    setClue(null);
    void load();
    return () => {
      serial.current++;
    };
  }, [url]);
  // Refresh revocations, permission changes and receipts without replacing the reading DOM.
  useEffect(() => {
    if (!sent && state.items.find((item) => item.id === id)?.revokedAt)
      setClue((old) =>
        old
          ? {
              ...old,
              revokedAt: state.items.find((item) => item.id === id)!.revokedAt,
              bodyMarkdown: '',
              attachments: [],
            }
          : old,
      );
    if (clue) void load();
  }, [state.revision]);
  async function reading(update: { read?: boolean; saved?: boolean }) {
    if (pending.current) return;
    retryAction.current = () => void reading(update);
    pending.current = true;
    setBusy(true);
    setSyncError('');
    try {
      const result = await request<{ readAt: string | null; savedAt: string | null }>(url, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      setClue((old) => (old ? { ...old, ...result } : old));
      await state.refresh();
    } catch (e) {
      setSyncError(`阅读状态未同步：${(e as Error).message}。可点击重试。`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!sent && clue && !clue.revokedAt && !marked.current) {
      marked.current = true;
      if (!clue.readAt) void reading({ read: true });
    }
  }, [clue?.id, sent]);
  async function manage(update: { allowForward?: boolean; revoke?: true }) {
    if (pending.current) return;
    retryAction.current = () => void manage(update);
    pending.current = true;
    setBusy(true);
    setSyncError('');
    try {
      await request(url, { method: 'PATCH', body: JSON.stringify(update) });
      await load();
      await state.refresh();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function forward() {
    if (pending.current || !recipients.length) return;
    retryAction.current = () => void forward();
    const operation = shareOperation || createId();
    setShareOperation(operation);
    pending.current = true;
    setBusy(true);
    setSyncError('');
    try {
      await post(`${url}/forward`, { id: operation, recipientUserIds: recipients });
      setShare(false);
      setRecipients([]);
      setShareOperation(null);
      setMessage('分享副本已投递。');
      await state.refresh();
    } catch (e) {
      const cause = e as Error & { status?: number };
      if (cause.status && cause.status >= 400 && cause.status < 500) {
        setShareOperation(null);
        setSyncError(cause.message);
      } else setSyncError(`分享状态待确认：${cause.message}。请使用当前选择重试。`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (error && !clue) return <Failure error={error} retry={() => void load()} />;
  if (!clue) return <div className="empty-note">正在读取私密线索…</div>;
  return (
    <div className="private-clue-reader space-y-3">
      <div className="eyebrow">{sent ? 'GM OUTBOX' : 'PRIVATE CLUE'}</div>
      <h3 className="display-title text-2xl">{clue.title}</h3>
      <p className="tiny subtle">
        GM {clue.senderName}
        {clue.sharedByName ? ` · ${clue.sharedByName} 分享的副本` : ''} · {time(clue.createdAt)}
      </p>
      <Failure error={error} retry={() => void load()} />
      {clue.revokedAt ? (
        <div className="clue-revoked-message">该线索已撤回。正文与附件不再提供。</div>
      ) : (
        <>
          {clue.characterLabel && <p className="badge">关联角色：{clue.characterLabel}</p>}
          <div className="clue-reading-body">
            {clue.bodyMarkdown ? (
              <TagMarkdown text={clue.bodyMarkdown} />
            ) : (
              <p className="tiny subtle">本线索以图片呈现。</p>
            )}
          </div>
          <div className="clue-attachments">
            {clue.attachments.map((a) => (
              <div className="clue-attachment" key={a.id}>
                <button aria-label={`查看原图 ${a.filename}`} onClick={() => open('clue-image', a.id)}>
                  <Thumbnail attachment={a} />
                  <span>{a.filename}</span>
                </button>
              </div>
            ))}
          </div>
          {!sent && (
            <div className="clue-actions">
              <button className="btn" disabled={busy} onClick={() => void reading({ saved: !clue.savedAt })}>
                <Star size={16} fill={clue.savedAt ? 'currentColor' : 'none'} />
                {clue.savedAt ? '取消收藏' : '收藏线索'}
              </button>
              <button className="btn" disabled={busy} onClick={() => void reading({ read: !clue.readAt })}>
                {clue.readAt ? '标记未读' : '标记已读'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(clue.bodyMarkdown || '');
                    setMessage('正文已复制');
                  } catch {
                    setSyncError('复制失败，请直接选择正文复制。');
                  }
                }}
              >
                <Copy size={16} />
                复制正文
              </button>
              {clue.allowForward && (
                <button className="btn" onClick={() => setShare(!share)}>
                  分享副本
                </button>
              )}
            </div>
          )}
          {!sent && !clue.allowForward && <p className="tiny subtle">GM 未允许分享此线索。</p>}
          {!sent && share && clue.allowForward && (
            <div className="clue-share-box">
              <fieldset disabled={busy || !!shareOperation}>
                <RecipientPicker p={p} value={recipients} onChange={setRecipients} exclude={p.me.id} />
              </fieldset>
              <p className="tiny subtle">确认后向上述成员分享本线索副本；不会公开原接收名单或 GM 备注。</p>
              <button className="btn btn-primary" disabled={busy || !recipients.length} onClick={() => void forward()}>
                {busy ? '分享中…' : shareOperation ? '确认状态并重试分享' : `确认向 ${recipients.length} 人分享副本`}
              </button>
            </div>
          )}
        </>
      )}
      {sent && (
        <div className="clue-receipts">
          <h4>投递与阅读回执</h4>
          <p>
            {clue.deliveries?.length || 0} 名接收者，{clue.deliveries?.filter((d) => d.readAt).length || 0} 人已读
          </p>
          {clue.deliveries?.map((d) => (
            <div key={d.id} className="clue-receipt-row">
              <strong>{d.recipientName}</strong>
              <span>{d.readAt ? `已读 · ${time(d.readAt)}` : '未读'}</span>
            </div>
          ))}
          {clue.gmNote && (
            <div className="clue-gm-note">
              <strong>GM 私有备注</strong>
              <p className="whitespace-pre-wrap">{clue.gmNote}</p>
            </div>
          )}
          {!clue.revokedAt && !clue.isForwarded && (
            <div className="clue-actions">
              <button className="btn" disabled={busy} onClick={() => void manage({ allowForward: !clue.allowForward })}>
                {clue.allowForward ? '关闭后续分享' : '允许后续分享'}
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (confirm('撤回本线索及其分享副本？之后不再提供正文与附件，但无法消除已下载或截图的内容。'))
                    void manage({ revoke: true });
                }}
              >
                撤回线索及分享副本
              </button>
              <button
                className="btn"
                onClick={() => {
                  const key = draftKey(p.snap.room.id, p.me.id),
                    current = readDraft(key);
                  if (current.operationId) {
                    setSyncError('投递台有待确认操作，请先完成重试。');
                    return;
                  }
                  if (
                    (current.title || current.bodyMarkdown || current.attachments.length) &&
                    !confirm('用此线索填入投递台，替换当前草稿？')
                  )
                    return;
                  const previous = useUI.getState().windows.find((w) => w.type === 'private-clues');
                  if (previous) {
                    useUI.getState().close(previous.id);
                    if (useUI.getState().windows.some((w) => w.id === previous.id)) return;
                  }
                  if (
                    !writeDraft(key, {
                      ...emptyDraft(),
                      title: clue.title,
                      bodyMarkdown: clue.bodyMarkdown || '',
                      gmNote: clue.gmNote || '',
                      attachments: clue.attachments,
                      allowForward: clue.allowForward,
                    })
                  ) {
                    setSyncError('浏览器无法保存再次投递草稿，请复制正文到投递台。');
                    return;
                  }
                  open('private-clues');
                }}
              >
                再次投递给其他成员
              </button>
            </div>
          )}
        </div>
      )}
      {syncError && <Failure error={syncError} retry={() => retryAction.current()} />}
      {message && (
        <p role="status" className="clue-success">
          {message}
        </p>
      )}
      <button className="btn" onClick={() => open('private-clues')}>
        <ArrowLeft size={16} />
        打开私密线索列表
      </button>
    </div>
  );
}
export function ClueImage({ p, id, windowId }: { p: Props; id?: string; windowId: string }) {
  const state = useClueState();
  const attached = state.items.some((c) => !c.revokedAt && c.attachments.some((a) => a.id === id));
  const close = useUI((s) => s.close);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        useUI
          .getState()
          .windows.filter((w) => !w.minimized)
          .sort((a, b) => b.z - a.z)[0]?.id === windowId
      ) {
        e.preventDefault();
        close(windowId);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [windowId, close]);
  if (!p.isGM && !attached)
    return (
      <div className="private-clue-image">
        <div className="clue-revoked-message">该图片已撤回或当前账号没有阅读权限。</div>
      </div>
    );
  const url = `/api${cluePath(p.snap.room.id)}/attachments/${id}/original`;
  return (
    <div className="private-clue-image">
      <ImageViewport src={url} title="私密线索原图" />
      <p className="tiny subtle">Esc 关闭当前图片窗口；不会影响剧情放映。</p>
    </div>
  );
}
