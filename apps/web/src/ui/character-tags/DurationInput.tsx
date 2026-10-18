export const durationText = (value?: number | null) => (value == null ? '永久 · 手动解除' : `剩余 ${value} 回合`);
export default function DurationInput({
  value,
  onChange,
  label = '剩余回合数',
}: {
  value?: number | null;
  onChange: (value: number | null) => void;
  label?: string;
}) {
  return (
    <fieldset className="tag-form-grid">
      <label>
        <span className="label">持续方式</span>
        <select
          className="input"
          aria-label={`${label}持续方式`}
          value={value == null ? 'permanent' : 'finite'}
          onChange={(e) => onChange(e.target.value === 'permanent' ? null : 3)}
        >
          <option value="permanent">永久状态 / 手动解除</option>
          <option value="finite">有限回合状态</option>
        </select>
      </label>
      {value != null && (
        <label>
          <span className="label">{label}</span>
          <input
            className="input"
            aria-label={label}
            type="number"
            min={1}
            max={1000000}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </label>
      )}
    </fieldset>
  );
}
