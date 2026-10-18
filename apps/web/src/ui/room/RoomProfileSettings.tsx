import { useState } from 'react';
import { ROOM_DISPLAY_NAME_MAX_LENGTH, roomMemberName } from '@dnd/shared';
import { post } from '../../api';
import { useSyncedText } from '../useSyncedText';
import type { RoomPanelProps } from './types';
import { useActionFeedback } from '../ActionFeedback';

export default function RoomProfileSettings({ p }: { p: RoomPanelProps }) {
  const { run } = useActionFeedback();
  const member = p.snap.members.find((candidate) => candidate.userId === p.me.id);
  const saved = member?.displayName || '';
  const [draft, setDraft] = useSyncedText(saved, `${p.snap.room.id}:${p.me.id}`);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function save(value: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await run(() =>
        post<{ displayName: string | null }>(`/rooms/${p.snap.room.id}/members/me/profile`, {
          displayName: value,
        }),
      );
      setDraft(result.displayName || '');
      await p.refresh();
      setMessage(result.displayName ? '房间内名称已保存' : '已恢复使用账号名称');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="panel p-3 rounded-lg space-y-3 mb-4"
      aria-label="我的房间内名称"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <h3 className="font-semibold">我在这个房间的名称</h3>
      <p className="tiny subtle">仅在当前房间使用，其他房间和登录账号保持不变。留空则使用账号名称。</p>
      <label className="block">
        <span className="label">房间内名称</span>
        <input
          className="input"
          value={draft}
          placeholder={p.me.username}
          maxLength={ROOM_DISPLAY_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage('');
            setError('');
          }}
        />
      </label>
      <p className="tiny subtle">
        当前显示：{roomMemberName(member, p.me.username)} · 登录账号：{p.me.username}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="submit" disabled={busy || draft.trim() === saved}>
          {busy ? '保存中…' : '保存房间内名称'}
        </button>
        <button className="btn" type="button" disabled={busy || (!saved && !draft)} onClick={() => void save('')}>
          使用账号名称
        </button>
      </div>
      {message && (
        <p className="tiny" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="tiny text-red-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
