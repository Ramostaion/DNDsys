import { useState } from 'react';
export default function MapEditor({
  map,
  onSave,
  onClose,
}: {
  map: any;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
      name: map.name,
      width: String(map.width),
      height: String(map.height),
      scalePixels: String(map.scalePixels),
      scaleUnits: String(map.scaleUnits),
    })),
    [version, setVersion] = useState(map.version),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const patch = {
      name: draft.name.trim(),
      width: Number(draft.width),
      height: Number(draft.height),
      scalePixels: Number(draft.scalePixels),
      scaleUnits: Number(draft.scaleUnits),
    };
    if (!patch.name) {
      setError('请输入地图名称');
      return;
    }
    if (![patch.width, patch.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
      setError('地图宽度与高度应为正整数');
      return;
    }
    if (![patch.scalePixels, patch.scaleUnits].every((value) => Number.isFinite(value) && value > 0)) {
      setError('比例尺的像素与距离应大于 0');
      return;
    }
    setBusy(true);
    try {
      await onSave({ id: map.id, version, patch });
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="map-editor panel rounded-lg p-3 space-y-3" onSubmit={(event) => void save(event)}>
      <h3 className="font-semibold">编辑地图</h3>
      <label className="block">
        <span className="label">地图名称</span>
        <input
          className="input"
          value={draft.name}
          maxLength={100}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['width', '宽度（像素）'],
            ['height', '高度（像素）'],
            ['scalePixels', '比例尺像素'],
            ['scaleUnits', '对应距离（尺）'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <span className="label">{label}</span>
            <input
              className="input"
              type="number"
              min={key === 'width' || key === 'height' ? 1 : 0}
              step={key === 'width' || key === 'height' ? 1 : 'any'}
              value={draft[key]}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              required
            />
          </label>
        ))}
      </div>
      <p className="tiny subtle">修改名称和尺寸会保留原地图的图片、入口、棋子与子地图。图片可通过“上传图片”替换。</p>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? '保存中…' : '保存地图'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          取消
        </button>
        {error && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setDraft({
                name: map.name,
                width: String(map.width),
                height: String(map.height),
                scalePixels: String(map.scalePixels),
                scaleUnits: String(map.scaleUnits),
              });
              setVersion(map.version);
              setError('');
            }}
          >
            重新载入（清空本次修改）
          </button>
        )}
      </div>
    </form>
  );
}
