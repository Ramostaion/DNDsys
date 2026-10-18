import { TAG_ROMAN_NUMERALS, type TagRomanNumeral } from '@dnd/shared';
import './state-roman.css';

export default function StateName({ name, numeral }: { name: string; numeral?: string | null }) {
  const visible = numeral && (TAG_ROMAN_NUMERALS as readonly string[]).includes(numeral);
  return (
    <>
      {name}
      {visible && (
        <>
          {' '}
          <span className="state-roman">{numeral}</span>
        </>
      )}
    </>
  );
}
export function RomanNumeralSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: TagRomanNumeral) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="label">罗马数字</span>
      <select
        className="input"
        aria-label="罗马数字"
        value={(TAG_ROMAN_NUMERALS as readonly string[]).includes(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TagRomanNumeral)}
      >
        {TAG_ROMAN_NUMERALS.map((numeral) => (
          <option value={numeral} key={numeral}>
            {numeral || '无'}
          </option>
        ))}
      </select>
    </label>
  );
}
