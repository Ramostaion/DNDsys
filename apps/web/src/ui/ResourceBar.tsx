import { Heart, Shield } from 'lucide-react';
import type { resourceSummary } from '@dnd/shared';

export default function ResourceBar({
  resource,
  kind,
  compact = false,
}: {
  resource: NonNullable<ReturnType<typeof resourceSummary>>;
  kind: 'health' | 'shield';
  compact?: boolean;
}) {
  const label = kind === 'shield' ? '护盾' : '生命';
  const Icon = kind === 'shield' ? Shield : Heart;
  return (
    <section aria-label={`${label}详情`} className="space-y-1">
      <div className={`flex justify-between gap-2 ${compact ? 'tiny' : 'text-sm'}`}>
        <span className={`flex items-center gap-1 ${kind === 'shield' ? 'text-sky-200' : 'text-amber-100/70'}`}>
          <Icon size={compact ? 11 : 14} /> {label}
        </span>
        <strong>
          {resource.current} / {resource.maximum}
        </strong>
      </div>
      <div
        className={`sheet-progress ${kind === 'shield' ? 'shield' : ''}`}
        role="progressbar"
        aria-label={`${label}条`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, resource.maximum)}
        aria-valuenow={resource.current}
      >
        <div style={{ width: `${resource.percent}%` }} />
      </div>
    </section>
  );
}
