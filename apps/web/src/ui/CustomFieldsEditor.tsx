import type { ItemField } from './item-fields';

export default function CustomFieldsEditor({
  fields,
  onChange,
  disabled = false,
  hint,
}: {
  fields: ItemField[];
  onChange: (fields: ItemField[]) => void;
  disabled?: boolean;
  hint: string;
}) {
  const update = (index: number, patch: Partial<ItemField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  return (
    <section className="space-y-2 custom-fields-editor">
      <h3 className="font-semibold text-sm">自定义词条</h3>
      <p className="tiny subtle">{hint}</p>
      {fields.map((field, index) => (
        <div className="item-field-row" key={index}>
          <input
            className="input"
            aria-label={`词条名称 ${index + 1}`}
            maxLength={80}
            disabled={disabled}
            value={field.name}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <select
            className="input"
            aria-label={`词条类型 ${index + 1}`}
            disabled={disabled}
            value={typeof field.value}
            onChange={(e) =>
              update(index, { value: e.target.value === 'number' ? Number(field.value) || 0 : String(field.value) })
            }
          >
            <option value="string">文字</option>
            <option value="number">数值</option>
          </select>
          <input
            className="input"
            aria-label={`词条内容 ${index + 1}`}
            disabled={disabled}
            type={typeof field.value === 'number' ? 'number' : 'text'}
            value={Number.isNaN(field.value) ? '' : field.value}
            onChange={(e) =>
              update(index, { value: typeof field.value === 'number' ? e.target.valueAsNumber : e.target.value })
            }
          />
          <button
            className="icon-button"
            aria-label={`删除词条 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(fields.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn"
        disabled={disabled || fields.length >= 50}
        onClick={() => onChange([...fields, { name: '', value: '' }])}
      >
        添加自定义词条
      </button>
    </section>
  );
}

export function CustomFieldsDetails({ fields = [] }: { fields?: ItemField[] }) {
  return fields.length ? (
    <dl className="grid grid-cols-2 gap-2 text-sm custom-fields-details">
      {fields.map((field) => (
        <div key={field.name}>
          <dt className="tiny subtle">{field.name}</dt>
          <dd className="whitespace-pre-wrap break-words">{String(field.value)}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}
