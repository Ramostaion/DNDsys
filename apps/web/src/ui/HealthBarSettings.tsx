import { useState } from 'react';
import { resourceField, type SheetField } from '@dnd/shared';
import type { Snapshot } from '../api';
export default function HealthBarSettings({
  snap,
  mutate,
}: {
  snap: Snapshot;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
}) {
  const fields = (snap.room.sheetSchema || []) as SheetField[],
    existing = resourceField(fields, 'health'),
    shield = resourceField(fields, 'shield'),
    numeric = fields.filter(
      (field) =>
        field.type === 'number' &&
        !field.formula &&
        field.fieldId !== shield?.fieldId &&
        field.fieldId !== shield?.maxFieldId,
    );
  const [current, setCurrent] = useState(existing?.fieldId || ''),
    [maximum, setMaximum] = useState(existing?.maxFieldId || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function configure(create: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await mutate('sheet.health.configure', {
        version: snap.room.version,
        create,
        currentFieldId: current,
        maxFieldId: maximum,
      });
      setCurrent(result.currentFieldId);
      setMaximum(result.maxFieldId);
      setMessage('血条已设置。打开人物卡，在“生命”分组中设定当前值和上限。');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-3 rounded-lg space-y-3 health-bar-settings">
      <h3 className="font-semibold">设置人物血条</h3>
      <p className="tiny subtle">血条显示“当前生命 / 生命上限”。已有角色数值保留，生命与生命上限仅由 GM 调整。</p>
      {!snap.room.sheetMode ? (
        <p className="tiny subtle">旧版人物卡已有生命血条，上限沿用原规则。此设置用于自定义人物卡。</p>
      ) : (
        <>
          <button className="btn btn-primary" disabled={busy || !!existing} onClick={() => void configure(true)}>
            {existing ? '已有血条字段' : '一键添加生命血条（默认 20 / 20）'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">当前生命字段</span>
              <select className="input" disabled={busy} value={current} onChange={(e) => setCurrent(e.target.value)}>
                <option value="">选择数值字段</option>
                {numeric.map((field) => (
                  <option key={field.fieldId} value={field.fieldId}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">生命上限字段</span>
              <select className="input" disabled={busy} value={maximum} onChange={(e) => setMaximum(e.target.value)}>
                <option value="">选择数值字段</option>
                {numeric
                  .filter((field) => field.fieldId !== current)
                  .map((field) => (
                    <option key={field.fieldId} value={field.fieldId}>
                      {field.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            className="btn"
            disabled={busy || !current || !maximum || current === maximum}
            onClick={() => void configure(false)}
          >
            使用所选字段显示血条
          </button>
        </>
      )}
      {message && (
        <p role="status" className="tiny text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
