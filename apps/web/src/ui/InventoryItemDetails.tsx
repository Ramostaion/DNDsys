import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Backpack, ArrowRightLeft, Trash2 } from 'lucide-react';
import { isWearable, normalizeEquipmentSlots } from '@dnd/shared';
import { itemFields } from './item-fields';
import './inventory-items.css';
import HoverCard, { useHoverPreview } from './HoverCard';

export function InventoryItemDetails({ entry }: { entry: any }) {
  const item = entry.item,
    data = item.data || {},
    instance = entry.data || {};
  const slots = normalizeEquipmentSlots(item.compatibleSlots);
  return (
    <div className="inventory-item-details">
      <header className="flex items-start gap-3">
        <div className="inventory-detail-icon">
          {item.imageUrl ? <img src={item.imageUrl} alt="" draggable={false} /> : <Backpack size={26} />}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">{instance.name || item.name}</h3>
          <span className="badge">{item.kind}</span>
        </div>
      </header>
      {instance.name && instance.name !== item.name && <p className="tiny subtle">原物品：{item.name}</p>}
      <p className="tiny whitespace-pre-wrap">{item.description || '暂无说明'}</p>
      {instance.description && instance.description !== item.description && (
        <p className="tiny whitespace-pre-wrap">物品备注：{instance.description}</p>
      )}
      <dl className="item-detail-fields">
        {typeof (instance.防御 ?? data.防御) === 'number' && (
          <div>
            <dt>防御</dt>
            <dd>{instance.防御 ?? data.防御}</dd>
          </div>
        )}
        {itemFields(data).map((field, index) => (
          <div key={index}>
            <dt>{field.name}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {data.notes && <p className="tiny whitespace-pre-wrap">备注：{data.notes}</p>}
      {isWearable(item.kind) && (
        <p className="tiny subtle">
          可装备部位：{item.kind === '双手武器' ? '主手和副手（同时占用）' : slots.length ? slots.join('、') : '未限定'}
        </p>
      )}
      <p className="tiny subtle">背包数量：{entry.backpackQuantity ?? entry.quantity}</p>
    </div>
  );
}

export function useInventoryHover() {
  const hover = useHoverPreview();
  return { ...hover, preview: hover.preview ? { entryId: hover.preview.id, anchor: hover.preview.anchor } : null };
}

export function InventoryItemTooltip({
  entry,
  anchor,
  keep,
  leave,
  close,
}: {
  entry: any;
  anchor: HTMLElement;
  keep: () => void;
  leave: () => void;
  close: () => void;
}) {
  return (
    <HoverCard
      anchor={anchor}
      keep={keep}
      leave={leave}
      close={close}
      label="物品详情"
      className="inventory-item-tooltip"
    >
      <InventoryItemDetails entry={entry} />
    </HoverCard>
  );
}

export function InventoryItemMenu({
  x,
  y,
  anchor,
  canTrade,
  canDelete,
  close,
  trade,
  remove,
}: {
  x: number;
  y: number;
  anchor: HTMLElement;
  canTrade: boolean;
  canDelete: boolean;
  close: () => void;
  trade: () => void;
  remove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    const scroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [close]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="背包物品操作"
      className="inventory-item-menu"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          anchor.focus();
        }
        if (event.key === 'Tab') close();
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if (!buttons.length) return;
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus();
        }
      }}
    >
      <button role="menuitem" disabled={!canTrade} onClick={trade}>
        <ArrowRightLeft size={15} />
        交易物品
      </button>
      <button role="menuitem" disabled={!canDelete} onClick={remove}>
        <Trash2 size={15} />
        删除物品
      </button>
    </div>,
    document.body,
  );
}
