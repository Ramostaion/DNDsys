import { describe, expect, it } from 'vitest';
import { shareRoomSnapshot } from './snapshot-order';
import type { Snapshot } from '../api';
const snapshot = (version: number, id = 'session', room = 'room') =>
  ({
    room: { id: room },
    turnSession: { id, version, round: 2, currentCharacterId: 'b', participants: [] },
  }) as unknown as Snapshot;
describe('回合快照版本与原子显示', () => {
  it('GM旧目录快照不能覆盖新分类，撤销GM时可去除目录数据', () => {
    const current = { ...snapshot(8), npcDirectory: { revision: 4, folders: [], classifications: [] } };
    const stale = { ...snapshot(8), npcDirectory: { revision: 3, folders: [], classifications: [] } };
    expect(shareRoomSnapshot(current, stale)).toBe(current);
    expect(shareRoomSnapshot(current, snapshot(8)).npcDirectory).toBeUndefined();
  });
  it('低版本整份响应不能覆盖新的队列/指针/轮次', () => {
    const current = snapshot(8),
      stale = snapshot(7);
    expect(shareRoomSnapshot(current, stale)).toBe(current);
  });
  it('相同版本不忽略权限或实时属性变化，未变化部分复用引用', () => {
    const current = snapshot(8),
      next = { ...snapshot(8), characterTags: [] } as Snapshot;
    const result = shareRoomSnapshot(current, next);
    expect(result.characterTags).toEqual([]);
    expect(result.turnSession).toBe(current.turnSession);
    expect(shareRoomSnapshot(current, snapshot(8))).toBe(current);
  });
  it('允许更高版本、新会话、另一个房间及会话结束', () => {
    const current = snapshot(8);
    expect(shareRoomSnapshot(current, snapshot(9)).turnSession!.version).toBe(9);
    expect(shareRoomSnapshot(current, snapshot(0, 'new')).turnSession!.id).toBe('new');
    expect(shareRoomSnapshot(current, snapshot(0, 'session', 'other')).room.id).toBe('other');
    expect(shareRoomSnapshot(current, { ...current, turnSession: null }).turnSession).toBeNull();
  });
});
