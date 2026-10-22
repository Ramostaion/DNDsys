import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import { roomAudioPosition } from '@dnd/shared';
import { roomAudioPath, useRoomAudioState } from './useRoomAudio';
import { request } from '../../api';
import './room-audio.css';
import { useAudioFade } from './useAudioFade';

export default function RoomAudioPlayer({
  userId,
  connected,
  presentationActive = false,
  roomId,
  isGM,
}: {
  userId: string;
  connected: boolean;
  presentationActive?: boolean;
  roomId: string;
  isGM: boolean;
}) {
  const state = useRoomAudioState();
  const element = useRef<HTMLAudioElement>(null),
    blockedRef = useRef(false),
    attempt = useRef(0);
  const reported = useRef(new Set<string>());
  const key = `dnd-background-audio:${userId}`;
  const [preferences, setPreferences] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem(key) || '{}');
      return {
        volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : 0.7,
        muted: p.muted === true,
      };
    } catch {
      return { volume: 0.7, muted: false };
    }
  });
  const [blocked, setBlocked] = useState(false),
    [error, setError] = useState(''),
    [ended, setEnded] = useState(false);
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [portalTarget, setPortalTarget] = useState<Element>(() => document.fullscreenElement || document.body);
  const slot = useRef<HTMLDivElement>(null),
    controls = useRef<HTMLElement>(null);
  const detached = small || presentationActive || portalTarget !== document.body;
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!detached || small) return;
    const placeholder = slot.current,
      panel = controls.current;
    if (!placeholder || !panel) return;
    const update = () => {
      const rect = placeholder.getBoundingClientRect();
      if (!rect.width) return;
      const next = { top: rect.top, left: rect.left, width: rect.width, height: panel.getBoundingClientRect().height };
      setAnchor((previous) =>
        previous &&
        Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next])
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(placeholder);
    observer.observe(panel);
    if (placeholder.parentElement) observer.observe(placeholder.parentElement);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [detached, small, portalTarget]);
  const latest = useRef({ state, connected });
  latest.current = { state, connected };
  const fader = useAudioFade(element, (state?.current?.volume ?? 0.5) * preferences.volume, preferences.muted);
  const transitioning = useRef(false),
    fadeIn = useRef(0),
    seenRevision = useRef<number | null>(null);
  useEffect(() => {
    const fullscreen = () => setPortalTarget(document.fullscreenElement || document.body);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => document.removeEventListener('fullscreenchange', fullscreen);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)'),
      change = () => setSmall(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {}
  }, [preferences, key, state?.current?.volume]);
  function sync(force = false, seekImmediately = false) {
    const audio = element.current,
      { state: currentState, connected: online } = latest.current,
      current = currentState?.current;
    if (!audio) return;
    if (transitioning.current) return;
    if (!online || !current?.track) {
      audio.pause();
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : current.track.duration;
    const target = roomAudioPosition(current, currentState?.now() ?? current.serverNow, duration);
    if (audio.readyState >= 1 && (seekImmediately || Math.abs(audio.currentTime - target) > 0.8)) {
      try {
        audio.currentTime = target;
      } catch {}
    }
    if (current.status !== 'playing') {
      audio.pause();
      return;
    }
    if (!current.loop && duration && target >= duration) {
      audio.pause();
      setEnded(true);
      if (current.track.duration) void currentState?.refresh();
      return;
    }
    if (audio.paused && (!blockedRef.current || force)) {
      const id = attempt.current;
      void audio
        .play()
        .then(() => {
          if (id === attempt.current) {
            blockedRef.current = false;
            setBlocked(false);
            setError('');
            setEnded(false);
            if (fader.gain.current < 1) fader.fade(1, fadeIn.current);
          }
        })
        .catch((cause: DOMException) => {
          if (id !== attempt.current || cause.name === 'AbortError') return;
          if (cause.name === 'NotAllowedError') {
            blockedRef.current = true;
            setBlocked(true);
          } else setError('音频暂时无法播放，请重试或让 GM 更换格式');
        });
    }
  }
  useEffect(() => {
    const timer = setInterval(() => sync(), 5000);
    const audio = element.current,
      current = state?.current;
    const fresh = current && current.revision !== seenRevision.current;
    const remaining = current
      ? Math.max(
          0,
          Math.min(
            current.fadeMs || 0,
            (current.changedAt || 0) + (current.fadeMs || 0) - (state?.now() ?? current.serverNow),
          ),
        )
      : 0;
    const duration = connected && fresh ? remaining : 0;
    if (current && !fresh && connected) {
      sync();
      return () => clearInterval(timer);
    }
    attempt.current++;
    setError('');
    setEnded(false);
    seenRevision.current = current?.revision ?? null;
    fader.cancel();
    transitioning.current = false;
    const apply = () => {
      transitioning.current = false;
      if (!audio) return;
      const url = connected && current?.status !== 'stopped' ? current?.track?.url : undefined;
      if (url && audio.getAttribute('src') !== url) {
        audio.src = url;
        audio.load();
      } else if (!url) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      fadeIn.current = duration / 2;
      fader.set(current?.status === 'playing' && duration ? 0 : 1);
      sync(false, true);
    };
    if (audio && !audio.paused && duration) {
      transitioning.current = true;
      fader.fade(0, duration / 2, apply);
    } else apply();
    return () => {
      clearInterval(timer);
    };
  }, [state?.current, connected]);
  useEffect(() => {
    const retryOnInteraction = (event: Event) => {
      if (!event.isTrusted || !blockedRef.current) return;
      // Run play synchronously inside the browser's trusted user gesture.
      // Keep the current room timeline; this never restarts the track from zero.
      blockedRef.current = false;
      sync(true, true);
    };
    document.addEventListener('click', retryOnInteraction, true);
    document.addEventListener('keydown', retryOnInteraction, true);
    return () => {
      document.removeEventListener('click', retryOnInteraction, true);
      document.removeEventListener('keydown', retryOnInteraction, true);
    };
  }, []);
  useEffect(
    () => () => {
      attempt.current++;
      element.current?.pause();
    },
    [],
  );
  const current = state?.current;
  function reportDuration() {
    const track = latest.current.state?.current?.track,
      duration = element.current?.duration;
    if (
      !isGM ||
      !track ||
      track.duration ||
      !duration ||
      !Number.isFinite(duration) ||
      duration > 86400 ||
      reported.current.has(track.id)
    )
      return;
    reported.current.add(track.id);
    void request(`${roomAudioPath(roomId)}/tracks/${track.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ duration }),
    }).catch(() => reported.current.delete(track.id));
  }
  const control = (
    <section
      ref={controls}
      className="room-audio-player"
      aria-label="剧情背景音"
      data-track-id={current?.track?.id}
      data-status={current?.status ?? 'stopped'}
    >
      <div className="room-audio-title">
        <Music2 size={15} />
        <strong title={current?.track?.title}>{current?.track?.title || '剧情背景音'}</strong>
        <small>
          {!connected
            ? '连接中'
            : !current?.track || current.status === 'stopped'
              ? '未播放'
              : ended
                ? '已结束'
                : current.status === 'paused'
                  ? '已暂停'
                  : '背景音'}
        </small>
      </div>
      {blocked && current?.status === 'playing' && (
        <p className="audio-autoplay-hint" role="status">
          浏览器限制自动播放，点击页面后自动接入背景音
        </p>
      )}
      {error && current?.track && current.status !== 'stopped' && (
        <button
          className="audio-retry"
          onClick={() => {
            element.current?.load();
            blockedRef.current = false;
            sync(true);
            void state?.refresh();
          }}
        >
          {error} · 重试
        </button>
      )}
      <div className="room-audio-personal">
        <button
          aria-label={preferences.muted ? '取消背景音静音' : '背景音静音'}
          title="只影响自己听到的声音"
          onClick={() => setPreferences((p) => ({ ...p, muted: !p.muted }))}
        >
          {preferences.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          aria-label="我的背景音音量"
          value={Math.round(preferences.volume * 100)}
          onChange={(e) => setPreferences((p) => ({ ...p, volume: Number(e.target.value) / 100 }))}
        />
        <span>{Math.round(preferences.volume * 100)}%</span>
      </div>
    </section>
  );
  return (
    <div ref={slot} className="room-audio-slot" style={detached && !small ? { height: anchor?.height } : undefined}>
      <audio
        ref={element}
        data-testid="room-background-audio"
        loop={current?.loop}
        preload="auto"
        onLoadedMetadata={() => {
          sync();
          reportDuration();
        }}
        onCanPlay={() => sync()}
        onEnded={() => {
          setEnded(true);
          reportDuration();
          if (state?.current?.track?.duration) void state.refresh();
        }}
        onError={() => {
          if (current?.track && current.status !== 'stopped') setError('音频读取失败，请重试');
        }}
      />
      {detached
        ? createPortal(
            <div
              className={`room-audio-floating ${presentationActive || portalTarget !== document.body ? 'is-presentation' : ''}`}
              style={
                small
                  ? undefined
                  : anchor
                    ? { top: anchor.top, left: anchor.left, right: 'auto', width: anchor.width }
                    : { visibility: 'hidden' }
              }
            >
              {control}
            </div>,
            portalTarget,
          )
        : control}
    </div>
  );
}
