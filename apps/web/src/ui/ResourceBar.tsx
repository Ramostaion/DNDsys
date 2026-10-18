import { Heart, Shield } from 'lucide-react';
import type { resourceSummary } from '@dnd/shared';
import ResourceMeter from './ResourceMeter';

export default function ResourceBar({
  resource,
  kind,
  compact = false,
  identity = kind,
}: {
  resource: NonNullable<ReturnType<typeof resourceSummary>>;
  kind: 'health' | 'shield';
  compact?: boolean;
  identity?: string;
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
      <ResourceMeter value={resource.current} maximum={resource.maximum} identity={identity} kind={kind} />
    </section>
  );
}
