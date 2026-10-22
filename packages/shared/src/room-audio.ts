export type RoomAudioState = {
  trackId: string | null;
  status: 'stopped' | 'playing' | 'paused';
  position: number;
  startedAt: number | null;
  loop: boolean;
  volume: number;
  fadeMs?: number;
  changedAt?: number;
};
export type RoomAudioTrack = { id: string; title: string; duration: number | null; bytes: number; url: string };
export type RoomAudioCurrent = RoomAudioState & { revision: number; track: RoomAudioTrack | null; serverNow: number };
export const emptyRoomAudio = (): RoomAudioState => ({
  trackId: null,
  status: 'stopped',
  position: 0,
  startedAt: null,
  loop: true,
  volume: 0.5,
});
export function roomAudioPosition(state: RoomAudioState, serverNow: number, duration?: number | null) {
  const raw = Math.max(
    0,
    state.position +
      (state.status === 'playing' && state.startedAt !== null ? Math.max(0, serverNow - state.startedAt) / 1000 : 0),
  );
  return duration && Number.isFinite(duration) && duration > 0
    ? state.loop
      ? raw % duration
      : Math.min(raw, duration)
    : raw;
}
