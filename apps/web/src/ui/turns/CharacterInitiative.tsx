import { useEffect, useState } from 'react';
import { calculateInitiative, initiativeFields, initiativeWeightErrors, type InitiativeConfig } from '@dnd/shared';
import type { Snapshot } from '../../api';
import InitiativeEditor, { InitiativeDetails } from './InitiativeEditor';
import './turns.css';

export default function CharacterInitiative({
  p,
  character,
}: {
  p: { snap: Snapshot; mutate: (type: string, payload: Record<string, unknown>) => Promise<any> };
  character: any;
}) {
  const initial = character.initiativeConfig || {},
    [draft, setDraft] = useState<InitiativeConfig>(initial),
    [base, setBase] = useState(initial),
    [version, setVersion] = useState(character.version),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base),
    preset = p.snap.initiativePresets?.find((row) => row.id === p.snap.room.initiativePresetId),
    fields = initiativeFields(p.snap.room, p.snap.characters);
  useEffect(() => {
    if (!dirty && version !== character.version) {
      setDraft(character.initiativeConfig || {});
      setBase(character.initiativeConfig || {});
      setVersion(character.version);
    }
  }, [character.initiativeConfig, character.version, dirty, version]);
  const calculation = calculateInitiative(
    p.snap.room,
    { ...character, initiativeConfig: draft },
    preset?.weights,
    fields,
  );
  async function save(config: InitiativeConfig) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await p.mutate('initiative.character', { characterId: character.id, version, config });
      setDraft(config);
      setBase(config);
      setVersion(result.version);
      setMessage('先手配置已保存，当前会话顺序保持不变。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="character-initiative mt-4">
      <summary>
        先手属性权重{' '}
        <span className="tiny subtle">
          · {draft.weights ? '个体自定义' : '继承全局模板'} · {calculation.valid ? calculation.score : '未就绪'}
        </span>
      </summary>
      <div className="space-y-3 mt-3">
        <p className="tiny subtle">仅 GM 可管理。预估值跟随当前属性；已经开启的回合需主动重新计算才会改变排序。</p>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={!!draft.weights}
            disabled={busy}
            onChange={(e) =>
              setDraft({ ...draft, weights: e.target.checked ? structuredClone(preset?.weights || []) : undefined })
            }
          />
          为此人物使用个体权重
        </label>
        {draft.weights && (
          <InitiativeEditor
            fields={fields}
            weights={draft.weights}
            onChange={(weights) => setDraft({ ...draft, weights })}
            disabled={busy}
          />
        )}
        <label>
          <span className="label">额外先手修正</span>
          <input
            className="input"
            aria-label="额外先手修正"
            type="number"
            min={-1000000}
            max={1000000}
            value={draft.bonus ?? 0}
            onChange={(e) => setDraft({ ...draft, bonus: Number(e.target.value) })}
          />
        </label>
        <InitiativeDetails calculation={calculation} />
        {version !== character.version && dirty && <p className="tag-conflict">人物已被更新，请重新加载后保存。</p>}
        {error && (
          <p role="alert" className="tiny text-red-300">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="tiny text-emerald-300">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !dirty ||
              version !== character.version ||
              (!!draft.weights && initiativeWeightErrors(draft.weights).length > 0)
            }
            onClick={() => void save(draft)}
          >
            保存人物先手
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setDraft(character.initiativeConfig || {});
              setBase(character.initiativeConfig || {});
              setVersion(character.version);
              setError('');
            }}
          >
            重新加载
          </button>
          <button
            className="btn"
            disabled={busy || version !== character.version}
            onClick={() => void save({ bonus: draft.bonus ?? 0 })}
          >
            恢复全局模板
          </button>
        </div>
      </div>
    </details>
  );
}
