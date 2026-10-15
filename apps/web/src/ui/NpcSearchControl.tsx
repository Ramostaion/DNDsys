import { useState } from 'react';
import HoverInfo from './HoverInfo';

export default function NpcSearchControl({
  character,
  isGM,
  mutate,
}: {
  character: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!character.isNpc) return null;
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      await mutate('character.update', {
        id: character.id,
        version: character.version,
        patch: { allowSearch: character.allowSearch === false },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 npc-search-control">
      <span className="tiny subtle">NPC 搜索</span>
      {isGM ? (
        <button
          className="btn"
          aria-label="允许搜索"
          aria-pressed={character.allowSearch !== false}
          disabled={busy}
          onClick={() => void toggle()}
        >
          允许搜索：{character.allowSearch === false ? '关' : '开'}
        </button>
      ) : (
        <span className="tiny subtle">{character.inventoryVisible ? '可以查看背包与装备' : '暂时无法搜索'}</span>
      )}
      <HoverInfo label="NPC 搜索说明">
        公开 NPC 的生命归零且 GM
        开启“允许搜索”时，玩家可以查看其背包和装备。恢复生命或关闭许可后再次隐藏。没有设置血条的 NPC 无法搜索；隐藏 NPC
        始终仅 GM 可见。搜索只开放查看，取走物品仍由 GM 操作。
      </HoverInfo>
      {error && (
        <p role="alert" className="tiny text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
