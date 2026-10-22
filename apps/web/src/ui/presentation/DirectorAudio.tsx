import { useEffect, useRef, useState } from 'react';
import { Music2, Upload, Play, Pause, Square, Trash2 } from 'lucide-react';
import { roomAudioPosition, type RoomAudioTrack } from '@dnd/shared';
import { post, request } from '../../api';
import { createId } from '../../id';
import { roomAudioPath, useRoomAudioState } from './useRoomAudio';
import './room-audio.css';

const time = (seconds: number) => {
  const n = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
function durationOf(file: File) {
  return new Promise<number | null>((resolve) => {
    const audio = new Audio(),
      url = URL.createObjectURL(file);
    const done = () => {
      const value = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(done, 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = done;
    audio.onerror = done;
    audio.src = url;
  });
}
export default function DirectorAudio({
  roomId,
  compact = false,
  onTracks,
}: {
  roomId: string;
  compact?: boolean;
  onTracks?: (tracks: RoomAudioTrack[]) => void;
}) {
  const audio = useRoomAudioState();
  const [tracks, setTracks] = useState<RoomAudioTrack[]>([]),
    [selected, setSelected] = useState(''),
    [title, setTitle] = useState('');
  const [message, setMessage] = useState(''),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false);
  const [loop, setLoop] = useState(true),
    [smooth, setSmooth] = useState(true),
    [volume, setVolume] = useState(50),
    [seek, setSeek] = useState<number | null>(null),
    [, tick] = useState(0);
  const xhr = useRef<XMLHttpRequest | null>(null),
    pending = useRef(false),
    active = useRef(true),
    serial = useRef(0);
  const current = audio?.current,
    base = roomAudioPath(roomId),
    chosen = tracks.find((t) => t.id === selected);
  async function reload() {
    const version = ++serial.current;
    try {
      const rows = await request<RoomAudioTrack[]>(`${base}/tracks`);
      if (active.current && serial.current === version) {
        setTracks(rows);
        onTracks?.(rows);
        setSelected((old) => (rows.some((r) => r.id === old) ? old : rows[0]?.id || ''));
      }
    } catch (cause) {
      if (active.current) setMessage((cause as Error).message);
    }
  }
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      serial.current++;
      xhr.current?.abort();
    };
  }, [roomId]);
  useEffect(() => {
    void reload();
  }, [audio?.libraryEpoch]);
  useEffect(() => {
    setTitle(chosen?.title || '');
  }, [chosen?.id, chosen?.title]);
  useEffect(() => {
    if (current) {
      setLoop(current.loop);
      setVolume(Math.round(current.volume * 100));
    }
  }, [current?.revision]);
  useEffect(() => {
    if (current?.status !== 'playing') return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [current?.status]);
  async function command(type: string, extra: Record<string, unknown> = {}) {
    if (!audio || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await post(`${base}/commands`, {
        id: createId(),
        version: current?.revision ?? 0,
        type,
        fadeMs: smooth ? 1000 : 0,
        ...extra,
      });
      await audio.refresh();
    } catch (cause) {
      setMessage((cause as Error).message);
      await audio.refresh();
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function upload(file: File) {
    if (uploading) return;
    if (file.size > 100 * 1024 * 1024) {
      setMessage('音频不能超过 100MB');
      return;
    }
    setUploading(true);
    setProgress(0);
    setMessage('');
    const duration = await durationOf(file);
    if (!active.current) return;
    const form = new FormData();
    form.append('file', file);
    form.append('title', file.name.replace(/\.[^.]+$/, '').slice(0, 100));
    if (duration) form.append('duration', String(duration));
    const task = new XMLHttpRequest();
    xhr.current = task;
    task.open('POST', `/api${base}/tracks`);
    task.withCredentials = true;
    task.timeout = 300000;
    task.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    const fail = (text: string) => {
      if (active.current) {
        setMessage(text);
        setUploading(false);
      }
    };
    task.onerror = () => fail('网络中断，音频未上传，请重试');
    task.ontimeout = () => fail('音频上传超时，请重试');
    task.onabort = () => fail('上传已取消');
    task.onload = () => {
      if (!active.current) return;
      let data: RoomAudioTrack & { error?: string };
      try {
        data = JSON.parse(task.responseText);
      } catch {
        fail('服务器未返回有效上传结果');
        return;
      }
      if (task.status !== 201) {
        fail(data.error || '音频上传失败');
        return;
      }
      setUploading(false);
      setSelected(data.id);
      setMessage('音频已保存，点击“向全员播放”开始');
      void reload();
    };
    task.send(form);
  }
  async function edit(remove: boolean) {
    if (!chosen || pending.current) return;
    if (remove && !confirm(`删除背景音“${chosen.title}”？正在播放时会同时停止全员播放。`)) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await request(`${base}/tracks/${chosen.id}`, {
        method: remove ? 'DELETE' : 'PATCH',
        ...(!remove ? { body: JSON.stringify({ title }) } : {}),
      });
      await reload();
      await audio?.refresh();
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const position = current ? roomAudioPosition(current, audio?.now() || current.serverNow, current.track?.duration) : 0;
  const duration = current?.track?.duration || 0;
  if (!audio) return null;
  return (
    <section className={`director-audio ${compact ? 'is-compact' : ''}`} aria-label="剧情背景音控制">
      <details className="director-audio-library-details">
        <summary>配乐库与独立播放控制</summary>
        <header>
          <div>
            <h3>
              <Music2 size={19} />
              剧情背景音
            </h3>
            <p>切图和黑幕不会打断背景音，停止音乐请使用下方控制。</p>
          </div>
          <label className={`btn audio-upload ${uploading ? 'is-disabled' : ''}`}>
            <Upload size={15} />
            {uploading ? `上传中 ${progress}%` : '上传音频'}
            <input
              aria-label="上传背景音"
              type="file"
              accept=".mp3,.wav,.ogg,.m4a,.webm"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
        </header>
        <div className="director-audio-library">
          <label>
            背景音曲目
            <select
              className="input"
              aria-label="背景音曲目"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{tracks.length ? '请选择音频' : '还没有音频，请先上传'}</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {t.duration ? ` · ${time(t.duration)}` : ''}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <div className="audio-title-edit">
              <input
                className="input"
                aria-label="音频名称"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                className="btn"
                disabled={busy || !title.trim() || title.trim() === chosen.title}
                onClick={() => void edit(false)}
              >
                重命名
              </button>
              <button className="btn" aria-label="删除所选音频" disabled={busy} onClick={() => void edit(true)}>
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      </details>
      <div className="audio-room-controls">
        <button
          className="btn btn-primary"
          disabled={busy || !chosen}
          onClick={() => void command('play', { trackId: selected, loop, volume: volume / 100 })}
        >
          <Play size={15} />
          向全员播放
        </button>
        <button
          className="btn"
          disabled={busy || !current?.track || current.status === 'stopped'}
          onClick={() => void command(current?.status === 'playing' ? 'pause' : 'resume')}
        >
          {current?.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
          {current?.status === 'paused' ? '继续播放' : '暂停全员'}
        </button>
        <button
          className="btn"
          disabled={busy || !current?.track || current.status === 'stopped'}
          onClick={() => void command('stop')}
        >
          <Square size={14} />
          停止背景音
        </button>
        <label className="audio-loop">
          <input
            type="checkbox"
            checked={loop}
            disabled={busy}
            onChange={(e) => {
              setLoop(e.target.checked);
              if (current?.track) void command('settings', { loop: e.target.checked });
            }}
          />
          循环播放
        </label>
        <label className="audio-loop">
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
          柔和过渡
        </label>
      </div>
      <div className="audio-now-playing">
        <span>
          {current?.track
            ? `${current.status === 'playing' ? '正在播放' : current.status === 'paused' ? '已暂停' : '已停止'} · ${current.track.title}`
            : '尚未播放背景音'}
        </span>
        <strong>
          {time(seek ?? position)} / {duration ? time(duration) : '--:--'}
        </strong>
      </div>
      <input
        className="audio-seek"
        aria-label="背景音播放位置"
        type="range"
        min="0"
        max={duration || 1}
        step="0.1"
        disabled={busy || !duration || current?.status === 'stopped'}
        value={seek ?? Math.min(position, duration || 1)}
        onChange={(e) => setSeek(Number(e.target.value))}
        onPointerUp={() => {
          if (seek !== null) {
            void command('seek', { position: seek });
            setSeek(null);
          }
        }}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && seek !== null) {
            void command('seek', { position: seek });
            setSeek(null);
          }
        }}
      />
      <div className="audio-master-volume">
        <label htmlFor={`audio-master-${roomId}`}>房间音量</label>
        <input
          id={`audio-master-${roomId}`}
          aria-label="房间背景音音量"
          type="range"
          min="0"
          max="100"
          value={volume}
          disabled={busy}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => {
            if (current?.track && volume !== Math.round(current.volume * 100))
              void command('settings', { volume: volume / 100 });
          }}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && current?.track)
              void command('settings', { volume: volume / 100 });
          }}
        />
        <span>{volume}%</span>
      </div>
      <p className="tiny subtle director-audio-help">
        推荐 MP3，单个文件最多 100MB。玩家默认自动播放；若浏览器拦截，点击页面后自动接入。个人静音和音量不会影响其他人。
      </p>
      {(message || audio.error) && (
        <p className="audio-message" role="status">
          {message || audio.error}
        </p>
      )}
    </section>
  );
}
