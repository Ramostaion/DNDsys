import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { Snapshot } from '../api';
import { canCapability, canEditCharacter, canViewInventory } from '../permissions';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
export default function TradePanel({
  p,
  characterId,
  offer,
}: {
  p: Props;
  characterId?: string;
  offer?: { entryId: string; request: number };
}) {
  const character = p.snap.characters.find((c) => c.id === characterId);
  const [entryId, setEntryId] = useState(''),
    [targetId, setTargetId] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!offer) return;
    setEntryId(offer.entryId);
    setQuantity('1');
    setError('');
    section.current?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    section.current?.querySelector<HTMLSelectElement>('[aria-label="交易接收角色"]')?.focus({ preventScroll: true });
  }, [offer]);
  if (!character || !canViewInventory(p.snap, p.me.id, character)) return null;
  const canOffer =
    (p.isGM || !character.inventoryLootable) &&
    canCapability(p.snap, p.me.id, 'trade') &&
    canEditCharacter(p.snap, p.me.id, character);
  const targets = p.snap.characters.filter(
    (c) => c.id !== character.id && c.visibility !== 'GM' && !c.isNpc && c.ownerId && c.ownerId !== p.me.id,
  );
  const entry = character.inventory.find((item: any) => item.id === entryId);
  const trades = (p.snap.trades || []).filter(
    (t) => t.sourceCharacterId === character.id || t.targetCharacterId === character.id,
  );
  async function run(type: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await p.mutate(type, payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={section} aria-label="玩家间交易" className="border-t border-amber-800/40 pt-4 mt-5 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRightLeft size={16} />
        <h3 className="font-semibold">玩家间交易</h3>
      </div>
      <p className="tiny subtle">提出请求后，由接收方确认；物品只在确认成功时转移。</p>
      {canOffer && (
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="交易物品" className="input" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
            <option value="">选择背包物品</option>
            {character.inventory
              .filter((item: any) => !item.equipped?.length)
              .map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.item.name} ×{item.quantity}
                </option>
              ))}
          </select>
          <select
            aria-label="交易接收角色"
            className="input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">选择接收角色</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            min="1"
            max={entry?.quantity || 1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label="交易数量"
          />
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !entry ||
              !targetId ||
              !Number.isInteger(Number(quantity)) ||
              Number(quantity) < 1 ||
              Number(quantity) > entry.quantity
            }
            onClick={() =>
              void run('trade.offer', {
                entryId,
                version: entry.version,
                targetCharacterId: targetId,
                quantity: Number(quantity),
              })
            }
          >
            提出交易
          </button>
        </div>
      )}
      <div className="space-y-2">
        {trades.map((trade) => (
          <div key={trade.id} className="grid-card text-sm">
            <div className="flex justify-between">
              <strong>
                {p.snap.items.find((item) => item.id === trade.itemId)?.name || '物品'} ×{trade.quantity}
              </strong>
              <span className="badge">
                {trade.status === 'PENDING'
                  ? '待确认'
                  : trade.status === 'ACCEPTED'
                    ? '已接收'
                    : trade.status === 'DECLINED'
                      ? '已拒绝'
                      : '已取消'}
              </span>
            </div>
            <div className="tiny subtle mt-1">
              {p.snap.characters.find((c) => c.id === trade.sourceCharacterId)?.name || '原角色'} →{' '}
              {p.snap.characters.find((c) => c.id === trade.targetCharacterId)?.name || '目标角色'}
            </div>
            {trade.status === 'PENDING' && (
              <div className="flex gap-2 mt-2">
                {(p.isGM || trade.recipientId === p.me.id) && (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void run('trade.accept', { id: trade.id })}
                    >
                      确认接收
                    </button>
                    <button className="btn" disabled={busy} onClick={() => void run('trade.decline', { id: trade.id })}>
                      拒绝
                    </button>
                  </>
                )}
                {(p.isGM || trade.senderId === p.me.id) && (
                  <button className="btn" disabled={busy} onClick={() => void run('trade.cancel', { id: trade.id })}>
                    撤销请求
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="tiny text-red-300">{error}</p>}
    </section>
  );
}
