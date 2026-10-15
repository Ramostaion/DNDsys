import type { ValueBreakdown } from '@dnd/shared';
import HoverInfo from './HoverInfo';

const number = (value: number) => String(Math.round(value * 1e8) / 1e8);
export default function ValueSource({
  name,
  trace,
  base,
  sources = [],
}: {
  name: string;
  trace?: ValueBreakdown;
  base?: unknown;
  sources?: string[];
}) {
  const initial = trace?.base ?? (typeof base === 'number' ? base : undefined);
  return (
    <HoverInfo label={`${name}数值来源`}>
      <span className="block font-semibold mb-1">{name} · 数值来源</span>
      {initial !== undefined && <span className="block text-white">基础数值：{number(initial)}</span>}
      {trace?.changes.map((change, index) => (
        <span key={index} className={`block ${change.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
          {change.name}：{change.amount >= 0 ? '+' : ''}
          {number(change.amount)}
        </span>
      ))}
      {trace && !trace.changes.length && <span className="block subtle">暂无加成或减少</span>}
      {trace &&
        sources
          .filter((source) => source.startsWith('公式'))
          .map((source, index) => (
            <span className="block subtle" key={index}>
              {source}
            </span>
          ))}
      {!trace && <span className="block subtle">{sources.length ? sources.join(' · ') : '详细来源未公开'}</span>}
    </HoverInfo>
  );
}
