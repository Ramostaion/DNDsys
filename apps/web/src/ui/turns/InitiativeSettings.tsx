import { useEffect, useState } from 'react';
import { initiativeFields, initiativeWeightErrors, type InitiativeWeight } from '@dnd/shared';
import type { RoomPanelProps } from '../room/types';
import InitiativeEditor from './InitiativeEditor';
import { useDraftProtection } from '../character-tags/useDraftProtection';
import './turns.css';

export default function InitiativeSettings({ p, windowId }: { p: RoomPanelProps; windowId: string }) {
  const presets = p.snap.initiativePresets || [],
    [selected, setSelected] = useState(p.snap.room.initiativePresetId || ''),
    preset = presets.find((row) => row.id === selected);
  const [draft, setDraft] = useState({
      name: preset?.name || '',
      weights: preset?.weights || ([] as InitiativeWeight[]),
    }),
    [base, setBase] = useState(draft),
    [version, setVersion] = useState(preset?.version ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useDraftProtection(windowId, dirty);
  const conflict = !!selected && (!preset || preset.version !== version);
  useEffect(() => {
    if (!dirty && preset && preset.version !== version) {
      const next = { name: preset.name, weights: preset.weights };
      setDraft(next);
      setBase(next);
      setVersion(preset.version);
    }
  }, [preset, dirty, version]);
  function choose(id: string) {
    if (dirty && !confirm('放弃未保存的先手配置？')) return;
    const row = presets.find((p) => p.id === id),
      next = { name: row?.name || '', weights: row?.weights || [] };
    setSelected(id);
    setDraft(next);
    setBase(next);
    setVersion(row?.version ?? 0);
    setError('');
    setMessage('');
  }
  async function action(type: string, payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await p.mutate(type, payload);
      if (type === 'initiative.preset.save') {
        setSelected(result.id);
        setVersion(result.version);
        setBase(draft);
        setMessage('模板已保存；可将它设为全局模板。');
      }
      if (type === 'initiative.preset.delete') {
        setSelected('');
        const next = { name: '', weights: [] };
        setDraft(next);
        setBase(next);
      }
      if (type === 'initiative.preset.select') setMessage('已设为全局模板，当前回合顺序保持不变。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="turn-panel space-y-4">
      <header>
        <div className="eyebrow">INITIATIVE · GM</div>
        <h2 className="display-title text-xl">先手权重配置</h2>
        <p className="tiny subtle">确定性综合先手，与战斗窗口的 D20 对抗判定独立。</p>
      </header>
      <label>
        <span className="label">配置模板</span>
        <select
          className="input"
          aria-label="先手配置模板"
          value={selected}
          disabled={busy}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">新建模板</option>
          {presets.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {row.id === p.snap.room.initiativePresetId ? ' · 当前全局' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">模板名称</span>
        <input
          className="input"
          aria-label="先手模板名称"
          maxLength={80}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <InitiativeEditor
        weights={draft.weights}
        onChange={(weights) => setDraft({ ...draft, weights })}
        fields={initiativeFields(p.snap.room, p.snap.characters)}
        disabled={busy}
      />
      {conflict && <p className="tag-conflict">模板已被修改或删除，请重新选择以加载最新版本。当前草稿已保留。</p>}
      {error && (
        <p role="alert" className="text-red-300 tiny">
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
          disabled={busy || conflict || !draft.name.trim() || initiativeWeightErrors(draft.weights).length > 0}
          onClick={() =>
            void action('initiative.preset.save', { ...draft, ...(selected ? { id: selected, version } : {}) })
          }
        >
          保存先手模板
        </button>
        <button
          className="btn"
          disabled={busy || !preset || dirty || conflict || preset.id === p.snap.room.initiativePresetId}
          onClick={() => void action('initiative.preset.select', { id: selected, version: p.snap.room.version })}
        >
          设为全局模板
        </button>
        {preset && (
          <button
            className="btn btn-danger"
            disabled={busy || conflict}
            onClick={() => {
              if (confirm('删除此先手模板？个体配置与已开启回合的顺序会保留。'))
                void action('initiative.preset.delete', { id: selected, version });
            }}
          >
            删除模板
          </button>
        )}
      </div>
    </div>
  );
}
