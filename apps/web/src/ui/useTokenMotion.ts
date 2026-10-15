import { useLayoutEffect, useRef } from 'react';
import type Konva from 'konva';
import type { TokenMoveEvent } from '@dnd/shared';
import { createId } from '../id';
import { motionDuration, motionFrame, type TokenMovementChannel } from './token-motion';
import { drawMovementGuide } from './draw-movement-guide';

type Position = { x: number; y: number; version: number };
type TokenPosition = Position & { id: string; mapId: string };
export function useTokenMotion(
  token: TokenPosition,
  channel: TokenMovementChannel,
  commit: (x: number, y: number, version: number, id: string) => Promise<any>,
  scale: number,
) {
  const group = useRef<Konva.Group>(null),
    avatar = useRef<Konva.Group>(null),
    shadow = useRef<Konva.Circle>(null),
    effects = useRef<Konva.Group>(null),
    guide = useRef<Konva.Group>(null),
    ghosts = useRef<(Konva.Group | null)[]>([]),
    ring = useRef<Konva.Circle>(null);
  const initial = useRef({ x: token.x, y: token.y });
  const state = useRef({
    confirmed: { x: token.x, y: token.y, version: token.version },
    animation: null as (TokenMoveEvent & { start: number; origin: { x: number; y: number } }) | null,
    frame: 0,
    endTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    dragging: false,
    pending: false,
    dragVersion: token.version,
  });
  const latest = useRef({ token, commit, scale });
  latest.current = { token, commit, scale };
  const clearEffects = () => {
    avatar.current?.scale({ x: 1, y: 1 });
    shadow.current?.shadowOpacity(0);
    ghosts.current.forEach((ghost) => ghost?.opacity(0));
    ring.current?.opacity(0);
    guide.current?.opacity(0);
    guide.current?.destroyChildren();
    effects.current?.hide();
  };
  const stop = () => {
    cancelAnimationFrame(state.current.frame);
    clearTimeout(state.current.endTimer);
    state.current.animation = null;
    clearEffects();
  };
  const settle = () => {
    stop();
    if (!state.current.dragging && !state.current.pending) group.current?.position(state.current.confirmed);
  };
  useLayoutEffect(() => {
    // All afterimages stay below tokens, names, resource bars and tags, and never receive input.
    effects.current?.moveToBottom();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const unsubscribe = channel.subscribe({
      move(event) {
        const current = state.current,
          t = latest.current.token;
        if (event.tokenId !== t.id || event.mapId !== t.mapId || event.version <= current.confirmed.version) return;
        const previous = current.confirmed;
        current.confirmed = { ...event.to, version: event.version };
        if (current.dragging || current.pending) return;
        const origin = group.current?.position() || event.from;
        stop();
        // Missed versions, background tabs and reduced motion favor authoritative state.
        if (
          event.version !== previous.version + 1 ||
          media.matches ||
          document.hidden ||
          Math.hypot(event.to.x - origin.x, event.to.y - origin.y) < 1
        ) {
          group.current?.position(event.to);
          return;
        }
        current.animation = { ...event, origin, start: performance.now() };
        drawMovementGuide(guide.current, [origin, event.to], latest.current.scale);
        // Some occluded windows suspend RAF without reporting document.hidden.
        // A small fallback keeps the confirmed endpoint authoritative in that case.
        current.endTimer = setTimeout(
          settle,
          motionDuration(Math.hypot(event.to.x - origin.x, event.to.y - origin.y)) + 80,
        );
        effects.current?.show();
        const tick = (now: number) => {
          const animation = current.animation;
          if (!animation || !group.current) return;
          const elapsed = now - animation.start;
          const pose = motionFrame(animation.origin, animation.to, elapsed);
          guide.current?.opacity(Math.min(1, Math.max(0, elapsed / 120)) * (1 - pose.landing));
          group.current.position({ x: pose.x, y: pose.y });
          avatar.current?.scale({ x: pose.scale, y: pose.scale });
          shadow.current?.setAttrs({
            shadowOpacity: pose.lift * 0.35,
            shadowBlur: 9 + pose.lift * 7,
            shadowOffsetY: 3,
          });
          ghosts.current.forEach((ghost, index) => {
            if (!ghost) return;
            const behind = motionFrame(animation.origin, animation.to, Math.max(0, elapsed - (index + 1) * 65));
            ghost.position({ x: behind.x, y: behind.y });
            ghost.opacity((0.14 - index * 0.025) * (1 - pose.landing) * Math.min(1, elapsed / 120));
          });
          ring.current?.setAttrs({
            x: animation.to.x,
            y: animation.to.y,
            radius: 29 + pose.landing * 22,
            opacity: Math.sin(pose.landing * Math.PI) * 0.32,
          });
          if (pose.done) settle();
          else current.frame = requestAnimationFrame(tick);
        };
        current.frame = requestAnimationFrame(tick);
      },
      reset: settle,
    });
    const onVisibility = () => {
      if (document.hidden) settle();
    };
    const onPreference = () => {
      if (media.matches) settle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onPreference);
    return () => {
      unsubscribe();
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onPreference);
    };
  }, [channel, token.id, token.mapId]);
  useLayoutEffect(() => {
    const current = state.current;
    if (token.version < current.confirmed.version) return;
    current.confirmed = { x: token.x, y: token.y, version: token.version };
    if (current.animation && token.version <= current.animation.version) return;
    settle();
  }, [token.version, token.x, token.y]);
  useLayoutEffect(() => {
    const animation = state.current.animation;
    if (animation) drawMovementGuide(guide.current, [animation.origin, animation.to], scale);
  }, [scale]);
  return {
    group,
    avatar,
    shadow,
    effects,
    guide,
    ghosts,
    ring,
    initial: initial.current,
    dragStart() {
      if (state.current.pending) return false;
      stop();
      state.current.dragging = true;
      state.current.dragVersion = state.current.confirmed.version;
      return true;
    },
    async dragEnd(x: number, y: number) {
      const current = state.current;
      if (!current.dragging) return;
      current.dragging = false;
      current.pending = true;
      const id = createId();
      channel.markLocal(id);
      try {
        const result = await latest.current.commit(x, y, current.dragVersion, id);
        if (result && result.version >= current.confirmed.version)
          current.confirmed = { x: result.x, y: result.y, version: result.version };
      } catch {
        /* Shared mutation handler reports the error and refreshes authoritative state. */
      } finally {
        current.pending = false;
        settle();
      }
    },
  };
}
