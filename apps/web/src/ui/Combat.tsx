import { useState } from 'react';
import { createId } from '../id';
import { DEFAULT_ATTACK_PROFILE } from '@dnd/shared';
import type { Snapshot } from '../api';

type Mutate = (type: string, payload: Record<string, unknown>) => Promise<any>;
/** Legacy attack profiles remain editable as reference cards; they never resolve an attack. */
export function AttackProfiles({
  snap,
  id,
  isGM,
  mutate,
}: {
  snap: Snapshot;
  id?: string;
  isGM: boolean;
  mutate: Mutate;
}) {
  const c = snap.characters.find((x) => x.id === id);
  const [name, setName] = useState(''),
    [attack, setAttack] = useState('1d20'),
    [damage, setDamage] = useState('1d6'),
    [error, setError] = useState('');
  if (!c) return null;
  const profiles = c.attackProfiles?.length ? c.attackProfiles : [DEFAULT_ATTACK_PROFILE];
  async function save() {
    try {
      setError('');
      await mutate('character.update', {
        id: c.id,
        version: c.version,
        patch: { attackProfiles: [...profiles, { id: createId(), name, attack, damage, damageType: '普通' }] },
      });
      setName('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="border-t border-[#34465b] mt-5 pt-4">
      <h3 className="font-semibold mb-2">旧版攻击资料</h3>
      <p className="tiny subtle mb-2">这些表达式仅作参考。命中、伤害与血量由玩家和 GM 自行裁定、掷骰并记录。</p>
      <div className="space-y-2">
        {profiles.map((profile: any) => (
          <div key={profile.id} className="grid-card flex justify-between gap-2">
            <div>
              <strong>{profile.name}</strong>
              <div className="tiny subtle">
                命中参考 {profile.attack} · 伤害参考 {profile.damage}
              </div>
            </div>
            {isGM && (
              <button
                className="text-red-300 tiny"
                onClick={() =>
                  void mutate('character.update', {
                    id: c.id,
                    version: c.version,
                    patch: { attackProfiles: profiles.filter((x: any) => x.id !== profile.id) },
                  })
                }
              >
                移除
              </button>
            )}
          </div>
        ))}
      </div>
      {isGM && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <input className="input" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input"
            placeholder="命中骰参考"
            value={attack}
            onChange={(e) => setAttack(e.target.value)}
          />
          <input
            className="input"
            placeholder="伤害骰参考"
            value={damage}
            onChange={(e) => setDamage(e.target.value)}
          />
          <button className="btn col-span-3" disabled={!name.trim()} onClick={() => void save()}>
            添加参考卡
          </button>
        </div>
      )}
      {error && <p className="tiny text-red-300">{error}</p>}
    </section>
  );
}
