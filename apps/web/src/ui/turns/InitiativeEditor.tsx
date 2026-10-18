import {
  initiativeWeightErrors,
  normalizeInitiativeWeights,
  type InitiativeCalculation,
  type InitiativeWeight,
  type SheetField,
} from '@dnd/shared';

export function InitiativeDetails({ calculation }: { calculation: InitiativeCalculation }) {
  return (
    <details className="initiative-calculation">
      <summary>
        {calculation.source === 'CUSTOM' ? '个体权重' : '全局模板'} ·{' '}
        {calculation.valid ? `先手 ${calculation.score}` : '尚未就绪'}
      </summary>
      {calculation.errors.map((error, i) => (
        <p className="text-red-300 tiny" key={i}>
          {error}
        </p>
      ))}
      <div className="turn-table-scroll">
        <table>
          <thead>
            <tr>
              <th>属性</th>
              <th>原值 / 量表</th>
              <th>标准值</th>
              <th>权重</th>
              <th>贡献</th>
            </tr>
          </thead>
          <tbody>
            {calculation.contributions.map((row) => (
              <tr key={row.fieldId}>
                <td>
                  {row.name}
                  {row.missing ? '（缺省）' : ''}
                </td>
                <td>
                  {row.raw ?? '缺失'} / {row.min}–{row.max}
                </td>
                <td>{row.normalized.toFixed(2)}</td>
                <td>{row.weight}%</td>
                <td>{row.contribution.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny subtle">
        额外修正 {calculation.bonus >= 0 ? '+' : ''}
        {calculation.bonus} · S = Σ(标准值 × 权重) + 修正
      </p>
      {calculation.warnings.map((warning, i) => (
        <p className="tiny subtle" key={i}>
          {warning}
        </p>
      ))}
    </details>
  );
}

export default function InitiativeEditor({
  weights,
  onChange,
  fields,
  disabled = false,
}: {
  weights: InitiativeWeight[];
  onChange: (weights: InitiativeWeight[]) => void;
  fields: SheetField[];
  disabled?: boolean;
}) {
  const errors = initiativeWeightErrors(weights),
    sum = weights.reduce((s, w) => s + w.weight, 0);
  function update(index: number, patch: Partial<InitiativeWeight>) {
    onChange(weights.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }
  return (
    <fieldset disabled={disabled} className="initiative-editor space-y-3">
      <p className="tiny subtle">
        将各属性按指定量表映射到
        0–100，再按百分比加权。请确认每项量表上下限；超出量表会限制到边界。缺失属性不会重分配权重。
      </p>
      {weights.map((w, i) => (
        <div className="initiative-weight-row" key={i}>
          <label className="initiative-field">
            <span className="label">数值属性</span>
            <select
              className="input"
              aria-label={`属性 ${i + 1}`}
              value={w.fieldId}
              onChange={(e) => {
                const f = fields.find((f) => f.fieldId === e.target.value);
                update(i, { fieldId: e.target.value, min: f?.min ?? 0, max: f?.max ?? 100 });
              }}
            >
              {!fields.some((f) => f.fieldId === w.fieldId) && (
                <option value={w.fieldId}>{w.fieldId || '选择属性'}</option>
              )}
              {fields
                .filter((f) => f.fieldId === w.fieldId || !weights.some((row) => row.fieldId === f.fieldId))
                .map((f) => (
                  <option key={f.fieldId} value={f.fieldId}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="label">权重 %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              aria-label={`权重 ${i + 1}`}
              value={w.weight}
              onChange={(e) => update(i, { weight: Number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label">量表下限</span>
            <input
              className="input"
              type="number"
              aria-label={`量表下限 ${i + 1}`}
              value={w.min}
              onChange={(e) => update(i, { min: Number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label">量表上限</span>
            <input
              className="input"
              type="number"
              aria-label={`量表上限 ${i + 1}`}
              value={w.max}
              onChange={(e) => update(i, { max: Number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label">缺失策略</span>
            <select
              className="input"
              aria-label={`缺失策略 ${i + 1}`}
              value={w.missing}
              onChange={(e) =>
                update(i, {
                  missing: e.target.value as InitiativeWeight['missing'],
                  ...(e.target.value === 'FIXED' ? { fallback: w.fallback ?? 0 } : {}),
                })
              }
            >
              <option value="BLOCK">阻止计算</option>
              <option value="ZERO">贡献为 0</option>
              <option value="FIXED">指定原值</option>
            </select>
          </label>
          {w.missing === 'FIXED' && (
            <label>
              <span className="label">缺省原值</span>
              <input
                className="input"
                type="number"
                aria-label={`缺省原值 ${i + 1}`}
                value={w.fallback ?? 0}
                onChange={(e) => update(i, { fallback: Number(e.target.value) })}
              />
            </label>
          )}
          <button
            className="btn tiny"
            aria-label={`移除属性 ${i + 1}`}
            onClick={() => onChange(weights.filter((_, at) => at !== i))}
          >
            移除
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          className="btn"
          disabled={weights.length >= 50 || !fields.some((f) => !weights.some((w) => w.fieldId === f.fieldId))}
          onClick={() => {
            const f = fields.find((f) => !weights.some((w) => w.fieldId === f.fieldId));
            if (f)
              onChange([
                ...weights,
                {
                  fieldId: f.fieldId,
                  weight: weights.length ? 0 : 100,
                  min: f.min ?? 0,
                  max: f.max ?? 100,
                  missing: 'BLOCK',
                },
              ]);
          }}
        >
          添加属性
        </button>
        <button
          className="btn"
          disabled={!weights.some((w) => w.weight > 0)}
          onClick={() => onChange(normalizeInitiativeWeights(weights))}
        >
          权重自动归一化
        </button>
        <strong className={errors.length ? 'text-red-300' : 'text-amber-200'}>总权重 {sum.toFixed(2)}%</strong>
      </div>
      {errors.map((error) => (
        <p key={error} className="tiny text-red-300">
          {error}
        </p>
      ))}
      {!fields.length && <p className="empty-note">人物卡中尚无可用的数值属性，请先添加数值词条。</p>}
    </fieldset>
  );
}
