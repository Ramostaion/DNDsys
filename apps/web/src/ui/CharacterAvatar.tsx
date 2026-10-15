import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { Snapshot } from '../api';
import { canEditBasics } from '../permissions';
import CharacterTagBadges from './character-tags/CharacterTagBadges';

type Props = {
  snap: Snapshot;
  me: any;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<unknown>;
};
export default function CharacterAvatar({ p, character }: { p: Props; character: any }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const can = canEditBasics(p.snap, p.me.id, character);
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('version', String(character.version));
      const response = await fetch(`/api/rooms/${p.snap.room.id}/characters/${character.id}/avatar`, {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '头像上传失败');
      await p.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="character-portrait">
      <CharacterTagBadges snap={p.snap} characterId={character.id}>
        <div className="sheet-avatar">
          {character.avatarUrl ? (
            <img src={character.avatarUrl} alt={`${character.name}头像`} />
          ) : (
            <span>{character.name.slice(0, 1)}</span>
          )}
        </div>
      </CharacterTagBadges>
      {can && (
        <label className={`btn character-avatar-action ${busy ? 'opacity-50' : ''}`}>
          <Upload size={12} />
          {busy ? '上传中…' : '更换头像'}
          <input
            hidden
            aria-label="上传角色头像"
            disabled={busy}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="tiny text-red-300 max-w-40">
          {error}
        </p>
      )}
    </div>
  );
}
