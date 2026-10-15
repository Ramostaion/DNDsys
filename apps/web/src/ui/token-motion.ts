import type { TokenMoveEvent } from '@dnd/shared';

type Listener = { move: (event: TokenMoveEvent) => void; reset: () => void };

/** No replay buffer: late mounts and reconnects obtain positions from the snapshot. */
export class TokenMovementChannel {
  private seen = new Set<string>();
  private local = new Set<string>();
  private listeners = new Set<Listener>();
  constructor(private roomId: string | undefined) {}
  markLocal(id: string) {
    this.local.add(id);
    if (this.local.size > 128) this.local.delete(this.local.values().next().value!);
  }
  receive = (event: TokenMoveEvent) => {
    if (event.roomId !== this.roomId || !event.eventId || this.seen.has(event.eventId)) return;
    if (
      !Number.isSafeInteger(event.version) ||
      event.version < 1 ||
      ![event.from?.x, event.from?.y, event.to?.x, event.to?.y, event.completedAt, event.serverNow].every(
        Number.isFinite,
      ) ||
      event.serverNow - event.completedAt > 3000
    )
      return;
    this.seen.add(event.eventId);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    if (this.local.has(event.eventId)) return;
    for (const listener of this.listeners) listener.move(event);
  };
  reset = () => {
    for (const listener of this.listeners) listener.reset();
  };
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function motionDuration(distance: number) {
  return 120 + Math.min(500, 300 + Math.max(0, distance) * 0.18) + 180;
}

/** Only a straight A → B interpolation; deliberately does not invent a drag path. */
export function motionFrame(from: { x: number; y: number }, to: { x: number; y: number }, elapsed: number) {
  const duration = motionDuration(Math.hypot(to.x - from.x, to.y - from.y));
  const travel = duration - 300;
  const progress = Math.max(0, Math.min(1, (elapsed - 120) / travel));
  const eased = progress * progress * (3 - 2 * progress);
  const landing = Math.max(0, Math.min(1, (elapsed - 120 - travel) / 180));
  const lift = elapsed < 120 ? Math.sin(((Math.max(0, elapsed) / 120) * Math.PI) / 2) : 1 - landing;
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    scale: landing > 0 ? 1 + Math.sin(landing * Math.PI * 2) * 0.018 * (1 - landing) : 1 + lift * 0.045,
    lift,
    landing,
    progress,
    done: elapsed >= duration,
  };
}
