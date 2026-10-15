import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import './hover-info.css';

export default function HoverInfo({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="hover-info">
      <button type="button" className="template-info-button" aria-label={label} aria-describedby={id}>
        <Info size={14} />
      </button>
      <span id={id} role="tooltip" className="hover-info-text">
        {children}
      </span>
    </span>
  );
}
