import { useState, type DragEvent } from 'react';
import { DEFAULT_EQUIPMENT_SLOTS, isWearable, equipmentFitsSlot } from '@dnd/shared';
import { itemFields } from './item-fields';
import { Backpack, Shirt, Plus, Minus, ArrowRightLeft, Shield, GripVertical } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import { canEditCharacter, canCapability, canViewInventory, canTransferInventory } from '../permissions';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
const slots = DEFAULT_EQUIPMENT_SLOTS;

function dragEntry(event: DragEvent, p: Props, c: any, entry: any, sourceSlot?: string) {
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
      ? { targetSlot, targetEquipmentId: target.equipment.find((e: any) => e.slot === targetSlot)?.id || null }
      : {}),
  };
}

function TransferControls({ p, c, entry, sourceSlot }: { p: Props; c: any; entry: any; sourceSlot?: string }) {
  const [chosen, setChosen] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [targetSlot, setTargetSlot] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const targets = p.snap.characters.filter(
    (other) => other.id !== c.id && canTransferInventory(p.snap, p.me.id, c, other),
  );
  const target = chosen ? targets.find((other) => other.id === chosen) : targets[0];
  const slotNames = p.snap.room.equipmentSlots?.length ? p.snap.room.equipmentSlots : slots;
  async function send() {
    if (!target || busy) return;
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
            .filter((slot: string) => equipmentFitsSlot(entry.item.compatibleSlots, slot))
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
            (!sourceSlot &&
              !targetSlot &&
              (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > entry.quantity))
          }
          onClick={() => void send()}
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

function InstanceEditor({ p, entry }: { p: Props; entry: any }) {
  const saved = entry.data || {};
  const [name, setName] = useState(saved.name || '');
  const [description, setDescription] = useState(saved.description || '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await p.mutate('inventory.instance.update', {
        id: entry.id,
        version: entry.version,
        data: { ...saved, name: name.trim(), description },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel p-3 rounded-lg space-y-2 mt-3">
      <div className="font-semibold text-sm">编辑这一件物品</div>
      <p className="tiny subtle">只影响这件物品；留空名称时沿用物品库名称。</p>
      <label>
        <span className="label">实例名称</span>
        <input
          className="input"
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={entry.item.name}
        />
      </label>
      <label>
        <span className="label">实例备注</span>
        <textarea
          aria-label="实例备注"
          className="input min-h-16"
          disabled={busy}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="磨损、附魔、剧情备注…"
        />
      </label>
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? '保存中…' : '保存实例'}
      </button>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function Inventory({ p, id }: { p: Props; id?: string }) {
  const c = p.snap.characters.find((x) => x.id === id),
    open = useUI((s) => s.open),
    [itemId, setItemId] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [dropping, setDropping] = useState(false),
    [dropActive, setDropActive] = useState(false);
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
    entry = backpack.find((e: any) => e.id === selected);
  async function action(type: string, payload: Record<string, unknown>) {
    try {
      setError('');
      await p.mutate(type, payload);
    } catch (e) {
      setError((e as Error).message);
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
    if ((!can && !lootable) || dropping) return;
    try {
      if (event.dataTransfer.types.includes('application/x-dnd-entry')) {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-dnd-entry'));
        const source = p.snap.characters.find((other) => other.id === payload.characterId);
        if (!source || !canTransferInventory(p.snap, p.me.id, source, c))
          throw new Error('没有在这两个角色之间转移物品的权限');
        setDropping(true);
        if (source.id === c!.id && !payload.sourceSlot) {
          if (position === undefined) return;
          const targetEntry = c!.inventory.find((entry: any) => entry.position === position);
          await action('inventory.move', {
            id: payload.entryId,
            version: payload.version,
            position,
            targetEntryId: targetEntry?.id || null,
            targetVersion: targetEntry?.version,
          });
        } else
          await action('inventory.transfer', {
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
        await action('inventory.add', {
          characterId: c!.id,
          itemId: payload.itemId,
          quantity: 1,
          ...(position === undefined || occupied ? {} : { position }),
        });
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDropping(false);
    }
  }
  return (
    <div className="space-y-4 inventory-panel">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">INVENTORY</div>
          <h2 className="display-title text-xl mt-1">{c.name} 的背包</h2>
        </div>
        <div className="badge">
          {backpack.length} / {c.inventorySlots} 格
        </div>
      </div>
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
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
        }}
        onDrop={(event) => void dropItem(event)}
      >
        {Array.from({ length: c.inventorySlots }, (_, pos) => {
          const item = backpack.find((e: any) => e.position === pos);
          return (
            <button
              key={pos}
              aria-label={`背包格 ${pos + 1}：${item ? item.data?.name || item.item.name : '空'}`}
              className={`inventory-slot ${item ? 'filled' : ''} ${selected === item?.id ? 'selected' : ''}`}
              onDragOver={dragOver}
              onDrop={(event) => {
                void dropItem(event, pos);
              }}
              draggable={(can || lootable) && !dropping && Boolean(item)}
              onDragStart={(event) => {
                if (item) dragEntry(event, p, c, item);
              }}
              onClick={() => setSelected(item?.id || null)}
            >
              <span className="inventory-pos">{pos + 1}</span>
              {item ? (
                <>
                  <div className="inventory-icon">
                    {item.item.imageUrl ? <img src={item.item.imageUrl} alt="" /> : <Backpack size={25} />}
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
      {entry && (
        <div className="inventory-detail">
          <div className="flex gap-3 items-start">
            <div className="inventory-detail-icon">
              {entry.item.imageUrl ? <img src={entry.item.imageUrl} alt="" /> : <Backpack size={26} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {entry.data?.name || entry.item.name} <span className="badge">{entry.item.kind}</span>
              </div>
              <p className="tiny subtle mt-1">{entry.data?.description || entry.item.description || '暂无说明'}</p>
            </div>
            <button className="tiny text-amber-300" onClick={() => open('item', entry.item.id)}>
              查看物品卡
            </button>
          </div>
          <dl className="item-detail-fields">
            {itemFields(entry.item.data).map((field, index) => (
              <div key={index}>
                <dt>{field.name}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          {entry.item.data?.notes && <p className="tiny whitespace-pre-wrap mt-2">备注：{entry.item.data.notes}</p>}
          {can && (
            <>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  className="btn"
                  onClick={() =>
                    void action('inventory.update', {
                      id: entry.id,
                      version: entry.version,
                      quantity: entry.quantity - 1,
                    })
                  }
                >
                  <Minus size={14} />
                </button>
                <span className="tiny">背包数量 {entry.backpackQuantity}</span>
                <button
                  className="btn"
                  disabled={!canIncrease}
                  title={canIncrease ? '增加数量' : '增加数量需要 GM 授权'}
                  onClick={() =>
                    void action('inventory.update', {
                      id: entry.id,
                      version: entry.version,
                      quantity: entry.quantity + 1,
                    })
                  }
                >
                  <Plus size={14} />
                </button>
                {isWearable(entry.item.kind) && (
                  <button className="btn shrink-0 whitespace-nowrap" onClick={() => open('equipment', c.id)}>
                    <GripVertical size={14} /> 拖到装备栏
                  </button>
                )}
              </div>
              <InstanceEditor key={`${entry.id}:${entry.version}`} p={p} entry={entry} />
            </>
          )}
          {(can || lootable) && (
            <TransferControls key={entry.id} p={p} c={c} entry={{ ...entry, quantity: entry.backpackQuantity }} />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      {(can || lootable) && (
        <p className="tiny subtle">
          同一背包内拖动可整理或交换格子；跨角色每次拖动 1
          件，数量可用转移按钮指定。装备可拖入另一背包或装备部位，自动卸下。
        </p>
      )}
    </div>
  );
}

export function Equipment({ p, id }: { p: Props; id?: string }) {
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
    slotNames = p.snap.room.equipmentSlots?.length ? p.snap.room.equipmentSlots : slots;
  async function equip(slot: string, entryId: string | null) {
    try {
      setError('');
      if (lootable) {
        const old = c!.equipment.find((e: any) => e.slot === slot),
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
        targetEquipmentId: c!.equipment.find((e: any) => e.slot === slot)?.id || null,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="space-y-4 equipment-panel">
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
        {slotNames.map((slot: string) => {
          const equipped = c.equipment.find((e: any) => e.slot === slot),
            entry = c.inventory.find((e: any) => e.id === equipped?.entryId),
            compatible = c.inventory.filter(
              (e: any) =>
                isWearable(e.item.kind) &&
                equipmentFitsSlot(e.item.compatibleSlots, slot) &&
                (e.id === equipped?.entryId ||
                  e.quantity > c.equipment.filter((worn: any) => worn.entryId === e.id).length),
            );
          return (
            <div
              key={slot}
              className={`equip-slot ${entry ? 'occupied' : ''}`}
              aria-label={`装备部位 ${slot}`}
              onDragOver={(event) => {
                if (canArrange && event.dataTransfer.types.includes('application/x-dnd-entry')) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!canArrange) return;
                void dropEquip(event, slot);
              }}
            >
              <div className="eyebrow">{slot}</div>
              {entry ? (
                <div
                  className="flex items-center gap-2 mt-2"
                  aria-label={`装备物品 ${slot}：${entry.data?.name || entry.item.name}`}
                  draggable={canArrange}
                  onDragStart={(event) => dragEntry(event, p, c, entry, slot)}
                >
                  <div className="equip-icon">
                    {entry.item.imageUrl ? <img src={entry.item.imageUrl} alt="" /> : <Shirt size={18} />}
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
              {entry && !p.snap.room.sheetMode && (
                <div className="tiny text-amber-300 mt-1">防御 +{entry.data?.防御 ?? entry.item.data?.防御 ?? 0}</div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-red-300 tiny">
          {error}
        </p>
      )}
      <p className="tiny subtle">
        装备或饰品的数值项目与人物卡字段名称一致时，穿戴后自动加成，脱下后恢复。数量不会自动放大加成，每个穿戴部位按一件计算。
      </p>
    </div>
  );
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
          <select className="input" value={current.id} onChange={(event) => setChosen(event.target.value)}>
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
