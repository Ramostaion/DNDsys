import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { DEFAULT_EQUIPMENT_SLOTS, isWearable, equipmentFitsSlot, equipmentAtSlot, withBackpackSlot } from '@dnd/shared';
import {
  InventoryItemDetails,
  InventoryItemTooltip,
  InventoryItemMenu,
  useInventoryHover,
} from './InventoryItemDetails';
import TradePanel from './TradePanel';
import { Backpack, Shirt, Plus, ArrowRightLeft, Shield, Trash2 } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import { createId } from '../id';
import { canEditCharacter, canCapability, canViewInventory, canTransferInventory } from '../permissions';
import { inventoryDropHint, useInventoryDrag } from './inventory-drag-feedback';
import { useDropFeedback } from './useDropFeedback';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>, operationId?: string) => Promise<any>;
};
const slots = DEFAULT_EQUIPMENT_SLOTS;

function dragEntry(event: DragEvent, p: Props, c: any, entry: any, sourceSlot?: string) {
  useInventoryDrag.getState().set({ roomId: p.snap.room.id, characterId: c.id, entryId: entry.id, sourceSlot });
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(
    'application/x-dnd-entry',
    JSON.stringify({
      roomId: p.snap.room.id,
      characterId: c.id,
      entryId: entry.id,
      version: entry.version,
      ...(sourceSlot ? { sourceSlot } : {}),
    }),
  );
}

function transferPayload(entry: any, target: any, quantity: number, sourceSlot?: string, targetSlot?: string) {
  return {
    id: entry.id,
    version: entry.version,
    targetCharacterId: target.id,
    quantity,
    ...(sourceSlot ? { sourceSlot } : {}),
    ...(targetSlot
      ? { targetSlot, targetEquipmentId: equipmentAtSlot(target.equipment, target.inventory, targetSlot)?.id || null }
      : {}),
  };
}

function TransferControls({ p, c, entry, sourceSlot }: { p: Props; c: any; entry: any; sourceSlot?: string }) {
  const [chosen, setChosen] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [targetSlot, setTargetSlot] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const targets = p.snap.characters.filter((other) => canTransferInventory(p.snap, p.me.id, c, other));
  const target = chosen
    ? targets.find((other) => other.id === chosen)
    : targets.find((other) => other.id === c.id) || targets[0];
  const slotNames = withBackpackSlot(p.snap.room.equipmentSlots?.length ? p.snap.room.equipmentSlots : slots);
  const alreadyInBackpack = !sourceSlot && !targetSlot && target?.id === c.id;
  async function send() {
    if (!target || busy || alreadyInBackpack) return;
    setBusy(true);
    setError('');
    try {
      await p.mutate(
        'inventory.transfer',
        transferPayload(entry, target, sourceSlot || targetSlot ? 1 : Number(quantity), sourceSlot, targetSlot),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 mt-3">
      <label className="tiny block">
        转移给角色
        <select
          aria-label="转移目标角色"
          className="input mt-1"
          disabled={busy}
          value={target?.id || ''}
          onChange={(e) => {
            setChosen(e.target.value);
            setTargetSlot('');
          }}
        >
          {!targets.length && <option value="">没有可转移的角色</option>}
          {targets.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
              {other.id === c.id ? '（当前角色背包）' : ''}
            </option>
          ))}
        </select>
      </label>
      {isWearable(entry.item.kind) && (
        <select
          className="input"
          aria-label="转移目标位置"
          disabled={busy}
          value={targetSlot}
          onChange={(e) => setTargetSlot(e.target.value)}
        >
          <option value="">背包</option>
          {slotNames
            .filter((slot: string) => equipmentFitsSlot(entry.item.compatibleSlots, slot, entry.item.kind))
            .map((slot: string) => (
              <option key={slot} value={slot}>
                装备 · {slot}
              </option>
            ))}
        </select>
      )}
      <div className="flex gap-2">
        {!sourceSlot && !targetSlot && (
          <input
            className="input !w-20"
            aria-label="转移数量"
            type="number"
            min="1"
            max={entry.quantity}
            disabled={busy}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        )}
        <button
          className="btn"
          disabled={
            busy ||
            !target ||
            alreadyInBackpack ||
            (!sourceSlot &&
              !targetSlot &&
              (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > entry.quantity))
          }
          onClick={() => void send()}
          title={alreadyInBackpack ? '物品已在此背包，可选择其他角色或装备部位' : undefined}
        >
          <ArrowRightLeft size={14} />
          {busy ? '转移中…' : '转移物品'}
        </button>
      </div>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function Inventory({ p, id }: { p: Props; id?: string }) {
  const drag = useInventoryDrag((state) => state.current),
    feedback = useDropFeedback();
  const c = p.snap.characters.find((x) => x.id === id),
    open = useUI((s) => s.open),
    [itemId, setItemId] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [dropping, setDropping] = useState(false),
    [page, setPage] = useState(0),
    [dropActive, setDropActive] = useState(false),
    [menu, setMenu] = useState<{ id: string; x: number; y: number; anchor: HTMLElement } | null>(null),
    [deleting, setDeleting] = useState<{
      id: string;
      version: number;
      quantity: number;
      name: string;
      operationId: string;
    } | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false),
    [offer, setOffer] = useState<{ entryId: string; request: number } | undefined>();
  const preview = useInventoryHover(),
    deleteLock = useRef(false),
    deleteDialog = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!deleting) return;
    deleteDialog.current?.scrollIntoView({ block: 'nearest' });
    deleteDialog.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [deleting]);
  if (!c) return <p>角色不存在。</p>;
  if (!canViewInventory(p.snap, p.me.id, c))
    return (
      <p className="empty-note">
        {c.isNpc
          ? 'NPC 生命归零且 GM 允许搜索后，才能查看背包和装备。'
          : c.ownerId === p.me.id
            ? '生命归零后不能打开自己的背包和装备。'
            : 'GM 已隐藏该角色的背包和装备。'}
      </p>
    );
  const lootable = !p.isGM && c.inventoryLootable === true;
  const can = canEditCharacter(p.snap, p.me.id, c) && !lootable,
    canIncrease = can && canCapability(p.snap, p.me.id, 'inventoryAdd'),
    canAdd = p.isGM && canIncrease,
    backpack = c.inventory
      .map((e: any) => ({
        ...e,
        backpackQuantity: e.quantity - c.equipment.filter((slot: any) => slot.entryId === e.id).length,
      }))
      .filter((e: any) => e.backpackQuantity > 0),
    entry = backpack.find((e: any) => e.id === selected),
    overflow = backpack.filter((item: any) => item.position < 0 || item.position >= c.inventorySlots),
    pageCount = Math.max(1, Math.ceil(c.inventorySlots / 96)),
    currentPage = Math.min(page, pageCount - 1),
    firstCell = currentPage * 96;
  const hovered = backpack.find((item: any) => item.id === preview.preview?.entryId);
  const menuEntry = backpack.find((item: any) => item.id === menu?.id);
  const canTrade = (item: any) =>
    can &&
    canCapability(p.snap, p.me.id, 'trade') &&
    !c.equipment.some((e: any) => e.entryId === item.id) &&
    p.snap.characters.some(
      (other) =>
        other.id !== c.id && other.visibility !== 'GM' && !other.isNpc && other.ownerId && other.ownerId !== p.me.id,
    );
  function tradeItem(item: any) {
    closeMenu();
    preview.close();
    setSelected(item.id);
    setOffer((old) => ({ entryId: item.id, request: (old?.request || 0) + 1 }));
  }
  function requestDelete(item: any) {
    closeMenu();
    preview.close();
    setSelected(item.id);
    setDeleting({
      operationId: createId(),
      id: item.id,
      version: item.version,
      quantity: item.backpackQuantity,
      name: item.data?.name || item.item.name,
    });
  }
  function contextMenu(event: MouseEvent<HTMLButtonElement>, item: any) {
    event.preventDefault();
    preview.close();
    if (!item || !can) return closeMenu();
    const box = event.currentTarget.getBoundingClientRect();
    setSelected(item.id);
    setMenu({
      id: item.id,
      x: event.clientX || box.left + 12,
      y: event.clientY || box.top + 12,
      anchor: event.currentTarget,
    });
  }
  async function confirmDelete() {
    if (!deleting || deleteLock.current) return;
    deleteLock.current = true;
    setDeleteBusy(true);
    try {
      if (
        await action(
          'inventory.delete',
          { id: deleting.id, version: deleting.version, quantity: deleting.quantity },
          deleting.operationId,
        )
      ) {
        setDeleting(null);
        setSelected(null);
      }
    } finally {
      deleteLock.current = false;
      setDeleteBusy(false);
    }
  }
  async function action(type: string, payload: Record<string, unknown>, operationId?: string) {
    try {
      setError('');
      await p.mutate(type, payload, operationId);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  function dragOver(event: DragEvent) {
    const types = event.dataTransfer.types;
    if (
      ((can || lootable) && types.includes('application/x-dnd-entry')) ||
      (canAdd && types.includes('application/x-dnd-item'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes('application/x-dnd-entry') ? 'move' : 'copy';
      setDropActive(true);
    }
  }
  async function dropItem(event: DragEvent, position?: number) {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    feedback.setHover(null);
    if ((!can && !lootable) || dropping) return;
    try {
      setError('');
      const hint = inventoryDropHint(p.snap, p.me.id, c, useInventoryDrag.getState().current, position);
      if (hint && !hint.allowed) throw new Error(hint.label);
      if (event.dataTransfer.types.includes('application/x-dnd-entry')) {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-dnd-entry'));
        const source = p.snap.characters.find((other) => other.id === payload.characterId);
        if (!source || !canTransferInventory(p.snap, p.me.id, source, c))
          throw new Error('没有在这两个角色之间转移物品的权限');
        setDropping(true);
        if (source.id === c!.id && !payload.sourceSlot) {
          if (position === undefined) return;
          const targetEntry = c!.inventory.find((entry: any) => entry.position === position);
          await p.mutate('inventory.move', {
            id: payload.entryId,
            version: payload.version,
            position,
            targetEntryId: targetEntry?.id || null,
            targetVersion: targetEntry?.version,
          });
        } else
          await p.mutate('inventory.transfer', {
            id: payload.entryId,
            version: payload.version,
            targetCharacterId: c!.id,
            quantity: 1,
            sourceSlot: payload.sourceSlot,
            ...(position === undefined ? {} : { position }),
          });
      } else {
        if (!canAdd) throw new Error('GM 尚未授权从物品库加入背包');
        const payload = JSON.parse(event.dataTransfer.getData('application/x-dnd-item'));
        if (payload.roomId !== p.snap.room.id || !p.snap.items.some((item) => item.id === payload.itemId))
          throw new Error('请拖入当前房间物品库中的物品');
        setDropping(true);
        const occupied = c!.inventory.some((entry: any) => entry.position === position);
        await p.mutate('inventory.add', {
          characterId: c!.id,
          itemId: payload.itemId,
          quantity: 1,
          ...(position === undefined || occupied ? {} : { position }),
        });
      }
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      setDropping(false);
    }
  }
  return (
    <div
      className={`space-y-4 inventory-panel ${drag ? 'is-dragging' : ''} ${dropActive ? 'drop-active' : ''}`}
      onDragOver={dragOver}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void feedback.run('backpack', () => dropItem(event)).catch(() => {});
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
      }}
      onDragStartCapture={() => {
        preview.close();
        closeMenu();
      }}
      onDragEnd={() => {
        useInventoryDrag.getState().set(null);
        setDropActive(false);
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">INVENTORY</div>
          <h2 className="display-title text-xl mt-1">{c.name} 的背包</h2>
        </div>
        <div className="badge" aria-label="背包容量">
          {backpack.length} / {c.inventorySlots} 格
        </div>
      </div>
      <p className="tiny subtle">有力量词条时，以15点力量对应24格，每高或低1点增减2格，最低0格。</p>
      {dropActive && drag?.sourceSlot && (
        <p className="tiny text-amber-200" role="status">
          松开以卸下并放入背包；也可选择一个空格。
        </p>
      )}
      {overflow.length > 0 && (
        <p className="tiny text-amber-200 border border-amber-300/30 rounded-lg p-3" role="status">
          容量已缩减，{overflow.length} 件物品位于容量之外，已保留在下方。可整理到空格、穿戴或转移给其他角色。
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn shrink-0 whitespace-nowrap" onClick={() => open('equipment', c.id)}>
          <Shirt size={15} /> 查看装备
        </button>
        {canAdd && (
          <div className="flex flex-1 min-w-0 gap-2">
            <select
              className="input min-w-0"
              aria-label="选择物品"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">从物品库选择…</option>
              {p.snap.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary shrink-0 whitespace-nowrap"
              disabled={!itemId || dropping}
              onClick={() => void action('inventory.add', { characterId: c.id, itemId, quantity: 1 })}
            >
              <Plus size={15} /> 放入
            </button>
          </div>
        )}
      </div>
      {lootable && (
        <p className="tiny text-amber-200">该角色生命归零。可与自己的角色双向取放物品，拖入装备部位可直接穿戴。</p>
      )}
      {!p.isGM && can && <p className="tiny subtle">物品由 GM 发放，你可整理背包内已有的物品。</p>}
      <div
        className={`inventory-grid inventory-drop-zone ${dropActive ? 'drop-active' : ''}`}
        aria-label="背包物品格"
        aria-busy={dropping}
        onDragOver={dragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropActive(false);
            feedback.setHover(null);
          }
        }}
        onDrop={(event) => void dropItem(event).catch(() => {})}
      >
        {Array.from({ length: Math.min(96, c.inventorySlots - firstCell) }, (_, index) => {
          const pos = firstCell + index;
          const item = backpack.find((e: any) => e.position === pos);
          const hint = inventoryDropHint(p.snap, p.me.id, c, drag, pos),
            target = String(pos);
          return (
            <button
              key={pos}
              aria-label={`背包格 ${pos + 1}：${item ? item.data?.name || item.item.name : '空'}`}
              className={`inventory-slot ${item ? 'filled' : ''} ${selected === item?.id ? 'selected' : ''} ${drag && feedback.hover === target && hint ? (hint.allowed ? 'is-drop-target' : 'is-drop-blocked') : ''} ${feedback.pending === target ? 'is-drop-pending' : ''} ${feedback.landed === target ? 'is-drop-landed' : ''}`}
              onDragOver={(event) => {
                dragOver(event);
                feedback.setHover(target);
                if (hint && !hint.allowed) event.dataTransfer.dropEffect = 'none';
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void feedback
                  .run(target, async () => {
                    await dropItem(event, pos);
                  })
                  .catch(() => {});
              }}
              draggable={(can || lootable) && !dropping && Boolean(item)}
              onDragStart={(event) => {
                if (item) dragEntry(event, p, c, item);
              }}
              onPointerEnter={(event) => {
                if (item && !drag) preview.show(item.id, event.currentTarget);
              }}
              onPointerLeave={preview.leave}
              onFocus={(event) => {
                if (item && !drag) preview.show(item.id, event.currentTarget);
              }}
              onBlur={preview.leave}
              onContextMenu={(event) => contextMenu(event, item)}
              onClick={() => {
                closeMenu();
                setSelected(item?.id || null);
              }}
            >
              <span className="inventory-pos">{pos + 1}</span>
              {drag && feedback.hover === target && hint && <span className="drop-hint">{hint.label}</span>}
              {item ? (
                <>
                  <div className="inventory-icon">
                    {item.item.imageUrl ? (
                      <img src={item.item.imageUrl} alt="" draggable={false} />
                    ) : (
                      <Backpack size={25} />
                    )}
                  </div>
                  <strong className="truncate w-full">{item.data?.name || item.item.name}</strong>
                  <span className="tiny subtle">×{item.backpackQuantity}</span>
                </>
              ) : (
                <span className="inventory-empty">◇</span>
              )}
            </button>
          );
        })}
      </div>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-2 tiny" aria-label="背包翻页">
          <button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            上一页
          </button>
          <span>
            第 {currentPage + 1} / {pageCount} 页
          </span>
          <button className="btn" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>
            下一页
          </button>
        </div>
      )}
      {overflow.length > 0 && (
        <section aria-label="超出容量的物品" className="space-y-2">
          <h3 className="tiny text-amber-200">待整理物品 · {overflow.length} 件</h3>
          <div className="inventory-grid">
            {overflow.map((item: any) => (
              <button
                key={item.id}
                className={`inventory-slot filled ${selected === item.id ? 'selected' : ''}`}
                aria-label={`超出容量物品：${item.data?.name || item.item.name}`}
                draggable={(can || lootable) && !dropping}
                onDragStart={(event) => dragEntry(event, p, c, item)}
                onPointerEnter={(event) => {
                  if (!drag) preview.show(item.id, event.currentTarget);
                }}
                onPointerLeave={preview.leave}
                onFocus={(event) => {
                  if (!drag) preview.show(item.id, event.currentTarget);
                }}
                onBlur={preview.leave}
                onContextMenu={(event) => contextMenu(event, item)}
                onClick={() => {
                  closeMenu();
                  setSelected(item.id);
                }}
              >
                <span className="tiny text-amber-200">待整理</span>
                <div className="inventory-icon">
                  {item.item.imageUrl ? (
                    <img src={item.item.imageUrl} alt="" draggable={false} />
                  ) : (
                    <Backpack size={25} />
                  )}
                </div>
                <strong className="truncate w-full">{item.data?.name || item.item.name}</strong>
                <span className="tiny subtle">×{item.backpackQuantity}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {entry && (
        <div className="inventory-detail">
          <InventoryItemDetails entry={entry} />
          {can && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                className="btn"
                disabled={!canTrade(entry)}
                onClick={() => tradeItem(entry)}
                title={
                  c.equipment.some((e: any) => e.entryId === entry.id) ? '请先卸下该物品的装备副本再交易' : undefined
                }
              >
                <ArrowRightLeft size={14} />
                交易物品
              </button>
              <button className="btn" disabled={deleteBusy} onClick={() => requestDelete(entry)}>
                <Trash2 size={14} />
                删除物品
              </button>
            </div>
          )}
          {(can || lootable) && (
            <TransferControls key={entry.id} p={p} c={c} entry={{ ...entry, quantity: entry.backpackQuantity }} />
          )}
        </div>
      )}
      {deleting && (
        <div ref={deleteDialog} role="dialog" aria-label="删除背包物品" className="inventory-delete-confirm space-y-3">
          <p>
            删除背包中的「{deleting.name}」×{deleting.quantity}？已穿戴的副本会保留。
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={deleteBusy || !can} onClick={() => void confirmDelete()}>
              {deleteBusy ? '删除中…' : '确认删除'}
            </button>
            <button className="btn" disabled={deleteBusy} onClick={() => setDeleting(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      {hovered && preview.preview && !drag && !menuEntry && (
        <InventoryItemTooltip
          entry={hovered}
          anchor={preview.preview.anchor}
          keep={preview.keep}
          leave={preview.leave}
          close={preview.close}
        />
      )}
      {menu && menuEntry && (
        <InventoryItemMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          canTrade={Boolean(canTrade(menuEntry))}
          canDelete={can && !deleteBusy}
          close={closeMenu}
          trade={() => tradeItem(menuEntry)}
          remove={() => requestDelete(menuEntry)}
        />
      )}
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      <TradePanel p={p} characterId={c.id} offer={offer} />
      {(can || lootable) && (
        <p className="tiny subtle">
          同一背包内拖动可整理或交换格子；跨角色每次拖动 1
          件，数量可用转移按钮指定。装备可拖回当前背包或其他获准的背包，自动卸下。悬停查看详情，右键可交易或删除物品。
        </p>
      )}
    </div>
  );
}

export function Equipment({ p, id }: { p: Props; id?: string }) {
  const drag = useInventoryDrag((state) => state.current),
    feedback = useDropFeedback();
  const c = p.snap.characters.find((x) => x.id === id),
    open = useUI((s) => s.open),
    [error, setError] = useState('');
  if (!c) return <p>角色不存在。</p>;
  if (!canViewInventory(p.snap, p.me.id, c))
    return (
      <p className="empty-note">
        {c.isNpc
          ? 'NPC 生命归零且 GM 允许搜索后，才能查看背包和装备。'
          : c.ownerId === p.me.id
            ? '生命归零后不能打开自己的背包和装备。'
            : 'GM 已隐藏该角色的背包和装备。'}
      </p>
    );
  const lootable = !p.isGM && c.inventoryLootable === true;
  const can = canEditCharacter(p.snap, p.me.id, c) && !lootable,
    canArrange = can || lootable,
    slotNames = withBackpackSlot(p.snap.room.equipmentSlots?.length ? p.snap.room.equipmentSlots : slots);
  async function equip(slot: string, entryId: string | null) {
    try {
      setError('');
      if (lootable) {
        const old = equipmentAtSlot(c!.equipment, c!.inventory, slot),
          entry = c!.inventory.find((e: any) => e.id === (entryId || old?.entryId));
        if (!entry) return;
        await p.mutate(
          'inventory.transfer',
          transferPayload(entry, c, 1, entryId ? undefined : slot, entryId ? slot : undefined),
        );
      } else await p.mutate('equipment.set', { characterId: c!.id, slot, entryId });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function dropEquip(event: DragEvent, slot: string) {
    try {
      setError('');
      const payload = JSON.parse(event.dataTransfer.getData('application/x-dnd-entry'));
      const source = p.snap.characters.find((other) => other.id === payload.characterId);
      if (!source || !canTransferInventory(p.snap, p.me.id, source, c))
        throw new Error('没有在这两个角色之间转移装备的权限');
      await p.mutate('inventory.transfer', {
        id: payload.entryId,
        version: payload.version,
        targetCharacterId: c!.id,
        quantity: 1,
        sourceSlot: payload.sourceSlot,
        targetSlot: slot,
        targetEquipmentId: equipmentAtSlot(c!.equipment, c!.inventory, slot)?.id || null,
      });
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  return (
    <div
      className={`space-y-4 equipment-panel ${drag ? 'is-dragging' : ''}`}
      onDragEnd={() => useInventoryDrag.getState().set(null)}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">EQUIPMENT</div>
          <h2 className="display-title text-xl mt-1">{c.name} 的装备</h2>
        </div>
        <div className="equip-defense">
          <Shield size={16} />
          {p.snap.room.sheetMode ? `已装备 ${c.equipment.length} 件` : `防御 ${c.derived?.values?.防御 ?? 0}`}
        </div>
      </div>
      <button className="btn" onClick={() => open('inventory', c.id)}>
        <Backpack size={15} /> 打开背包
      </button>
      <div className="equip-grid">
        {slotNames
          .filter((slot: string) => slot !== '背包' || !slotNames.includes('胸部'))
          .map((slot: string) =>
            slot === '胸部' ? (
              <section className="equip-chest-group" key="chest">
                <header>
                  <Shirt size={16} />
                  <strong>胸部</strong>
                  <span>护甲与背包可同时装备</span>
                </header>
                <div className="equip-chest-pair">
                  {renderSlot('胸部')}
                  {renderSlot('背包')}
                </div>
              </section>
            ) : (
              renderSlot(slot)
            ),
          )}
      </div>
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      <p className="tiny subtle">
        装备数值词条与人物卡同名字段联动；双手武器按一件计算。背包装备在胸部第二位置，“格数”增加容量，卸下后撤销。
      </p>
    </div>
  );
  function renderSlot(slot: string) {
    const hint = inventoryDropHint(p.snap, p.me.id, c, drag, undefined, slot);
    const equipped = equipmentAtSlot(c.equipment, c.inventory, slot),
      entry = c.inventory.find((e: any) => e.id === equipped?.entryId),
      compatible = c.inventory.filter(
        (e: any) =>
          isWearable(e.item.kind) &&
          equipmentFitsSlot(e.item.compatibleSlots, slot, e.item.kind) &&
          (e.id === equipped?.entryId || e.quantity > c.equipment.filter((worn: any) => worn.entryId === e.id).length),
      );
    return (
      <div
        key={slot}
        className={`equip-slot ${slot === '背包' ? 'equip-backpack-slot' : ''} ${entry ? 'occupied' : ''} ${drag && feedback.hover === slot && hint ? (hint.allowed ? 'is-drop-target' : 'is-drop-blocked') : ''} ${feedback.pending === slot ? 'is-drop-pending' : ''} ${feedback.landed === slot ? 'is-drop-landed' : ''}`}
        aria-label={`装备部位 ${slot}`}
        onDragOver={(event) => {
          if (canArrange && event.dataTransfer.types.includes('application/x-dnd-entry')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            feedback.setHover(slot);
            if (hint && !hint.allowed) event.dataTransfer.dropEffect = 'none';
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) feedback.setHover(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!canArrange) return;
          if (hint && !hint.allowed) {
            setError(hint.label);
            feedback.setHover(null);
            return;
          }
          void feedback.run(slot, () => dropEquip(event, slot)).catch(() => {});
        }}
      >
        <div className="eyebrow">
          {slot === '胸部' ? '护甲' : slot === '背包' ? '背包 · 扩容' : slot}
          {slot === '背包' && entry && (
            <span className="ml-2">
              +{entry.item.data?.customFields?.find((field: any) => field.name === '格数')?.value ?? 0} 格
            </span>
          )}
        </div>
        {drag && feedback.hover === slot && hint && <span className="drop-hint">{hint.label}</span>}
        {entry ? (
          <div
            className="flex items-center gap-2 mt-2"
            aria-label={`装备物品 ${slot}：${entry.data?.name || entry.item.name}`}
            draggable={canArrange}
            onDragStart={(event) => dragEntry(event, p, c, entry, slot)}
          >
            <div className="equip-icon">
              {entry.item.imageUrl ? (
                <img src={entry.item.imageUrl} alt="" draggable={false} />
              ) : slot === '背包' ? (
                <Backpack size={18} />
              ) : (
                <Shirt size={18} />
              )}
            </div>
            <div className="equip-item-name min-w-0 flex-1">{entry.data?.name || entry.item.name}</div>
          </div>
        ) : (
          <div className="equip-empty">{can ? '拖入装备' : '未装备'}</div>
        )}
        {canArrange && (
          <div className="flex gap-1 mt-2">
            <select
              aria-label={`${slot}装备`}
              className="input equip-select"
              value={equipped?.entryId || ''}
              onChange={(event) => void equip(slot, event.target.value || null)}
            >
              <option value="">空</option>
              {compatible.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {entry && canArrange && (
          <TransferControls key={`${slot}:${entry.id}`} p={p} c={c} entry={entry} sourceSlot={slot} />
        )}{' '}
        {slot === '背包' && entry && (
          <div className="tiny text-amber-300 mt-1">
            容量 +{entry.item.data?.customFields?.find((field: any) => field.name === '格数')?.value ?? 0} 格
          </div>
        )}
        {entry && !p.snap.room.sheetMode && (
          <div className="tiny text-amber-300 mt-1">防御 +{entry.data?.防御 ?? entry.item.data?.防御 ?? 0}</div>
        )}
      </div>
    );
  }
}

export function PlayerBackpacks({ p }: { p: Props }) {
  const [chosen, setChosen] = useState(''),
    characters = p.snap.characters.filter(
      (character) => character.ownerId === p.me.id && !character.isNpc && canViewInventory(p.snap, p.me.id, character),
    );
  const current = characters.find((character) => character.id === chosen) || characters[0];
  if (!current) return <p className="empty-note">没有可打开的角色背包；生命归零时无法打开自己的背包和装备。</p>;
  return (
    <div className="space-y-3">
      {characters.length > 1 && (
        <label>
          <span className="label">选择角色背包</span>
          <select
            aria-label="选择角色背包"
            className="input"
            value={current.id}
            onChange={(event) => setChosen(event.target.value)}
          >
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Inventory key={current.id} p={p} id={current.id} />
    </div>
  );
}
