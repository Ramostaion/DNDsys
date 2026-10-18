import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ABILITIES, DEFAULT_RULES, xpRequired, roomMemberName } from '@dnd/shared';
import { Dices, Heart, Shield, Backpack, Shirt, Plus, BookOpen } from 'lucide-react';
import type { Snapshot } from '../api';
import { useUI } from '../store';
import ResourceMeter from './ResourceMeter';
import { CharacterTagManageButton } from './character-tags/CharacterTagBadges';
import CharacterAvatar from './CharacterAvatar';
import NpcSearchControl from './NpcSearchControl';
import ValueSource from './ValueSource';
import CharacterSkills from './CharacterSkills';
import { useSyncedText } from './useSyncedText';
import { canEditCharacter, canEditBasics, canCapability, canViewInventory } from '../permissions';
import ConfigurableSheet, { ShieldSection } from './ConfigurableSheet';
import { useDiceCountdown } from './dice/useRoomDice';

type Props = {
  snap: Snapshot;
  me: any;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<unknown>;
};
const sign = (value: number) => (value >= 0 ? `+${value}` : String(value));

function AbilityRollButton({
  ability,
  busy,
  onRoll,
  children,
}: {
  ability: string;
  busy: boolean;
  onRoll: () => void;
  children: ReactNode;
}) {
  const { remainingMs } = useDiceCountdown();
  return (
    <button
      className="ability-roll"
      disabled={busy || remainingMs > 0}
      title={remainingMs > 0 ? `${(remainingMs / 1000).toFixed(1)} 秒后可掷骰` : `掷 ${ability}检定`}
      onClick={onRoll}
    >
      {children}
    </button>
  );
}

export default function CharacterSheet({ p, id }: { p: Props; id?: string }) {
  const c = p.snap.characters.find((x) => x.id === id);
  const open = useUI((s) => s.open);
  const [name, setName] = useSyncedText(c?.name || '', c?.id || '');
  const [description, setDescription] = useSyncedText(c?.description || '', c?.id || '');
  const [xpAmount, setXpAmount] = useState('100');
  const [hpAmount, setHpAmount] = useState('1');
  const [fieldName, setFieldName] = useState('');
  const [fieldValue, setFieldValue] = useState('0');
  const [error, setError] = useState('');
  const abilityInFlight = useRef(false);
  const [abilityBusy, setAbilityBusy] = useState(false);
  useEffect(() => {
    setError('');
  }, [c?.id]);
  if (!c) return <p>角色不存在。</p>;
  if (p.snap.room.sheetMode) return <ConfigurableSheet p={p} c={c} />;
  const controls = canEditCharacter(p.snap, p.me.id, c),
    can = controls && canCapability(p.snap, p.me.id, 'characterValues'),
    basics = canEditBasics(p.snap, p.me.id, c),
    inventoryVisible = canViewInventory(p.snap, p.me.id, c);
  const rules = p.snap.room.rules || DEFAULT_RULES;
  const values = c.derived?.values || {};
  const maxHp = Math.max(1, Number(values.血量上限) || 1);
  async function patch(value: Record<string, unknown>) {
    try {
      setError('');
      await p.mutate('character.update', { id: c.id, version: c.version, patch: value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function adjustHp(kind: 'DAMAGE' | 'HEAL') {
    const amount = Math.max(1, Math.floor(Number(hpAmount) || 1));
    if (p.snap.encounter) await p.mutate('combat.hp', { targetId: c.id, amount, kind });
    else await patch({ currentHp: Math.max(0, c.currentHp + (kind === 'HEAL' ? amount : -amount)) });
  }
  async function rollAbility(key: string) {
    if (abilityInFlight.current) return;
    abilityInFlight.current = true;
    setAbilityBusy(true);
    try {
      setError('');
      await p.mutate('dice.roll', {
        expression: `1d20+${key === '敏捷' && c.derived?.agility ? '敏捷属性加值' : `${key}加值`}`,
        reason: `${c.name} · ${key}检定`,
        characterId: c.id,
        visibility: 'PUBLIC',
      });
      open('dice');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      abilityInFlight.current = false;
      setAbilityBusy(false);
    }
  }
  return (
    <div className="character-sheet sheet-legacy space-y-5">
      <div className="sheet-hero">
        <CharacterAvatar p={p} character={c} />
        <div className="flex-1 min-w-0 sheet-identity">
          <div className="eyebrow">LEVEL {c.level} · ADVENTURER DOSSIER</div>
          <input
            className="sheet-name"
            aria-label="角色名称"
            value={name}
            disabled={!basics}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== c.name && void patch({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="tiny subtle">
            {roomMemberName(
              p.snap.members.find((m) => m.userId === c.ownerId),
              '未分配玩家',
            )}{' '}
            的角色
          </div>
        </div>
      </div>
      <ShieldSection p={p} c={c} />
      <div className="sheet-vitals">
        <div className="sheet-vital is-health">
          <div className="sheet-vital-label">
            <Heart size={16} /> 生命
          </div>
          <div className="sheet-vital-value">
            {c.currentHp} {p.isGM && <small>/ {maxHp}</small>}
          </div>
          <ResourceMeter value={c.currentHp} maximum={maxHp} identity={`${c.id}:health`} showMaximum={p.isGM} />
          {p.isGM && (
            <div className="flex items-center gap-1 mt-2">
              <input
                className="input !w-16 !p-1 text-xs"
                aria-label="调整血量点数"
                type="number"
                min="1"
                value={hpAmount}
                onChange={(e) => setHpAmount(e.target.value)}
              />
              <button className="tiny text-red-300" onClick={() => void adjustHp('DAMAGE')}>
                伤害
              </button>
              <button className="tiny text-emerald-300" onClick={() => void adjustHp('HEAL')}>
                治疗
              </button>
            </div>
          )}
        </div>
        <div className="sheet-vital is-defense">
          <div className="sheet-vital-label">
            <Shield size={16} /> 防御
          </div>
          <div className="sheet-vital-value">{values.防御 ?? 0}</div>
          <div className="tiny subtle mt-2 line-clamp-2">
            {(c.derived?.sources?.防御 || []).join(' · ') || '基础防御'}
          </div>
        </div>
        <div className="sheet-vital is-experience">
          <div className="sheet-vital-label">
            <BookOpen size={16} /> 经验
          </div>
          <div className="sheet-vital-value">
            {c.xp} <small>/ {xpRequired(c.level)}</small>
          </div>
          <div className="sheet-progress xp">
            <div style={{ width: `${Math.min(100, (c.xp / xpRequired(c.level)) * 100)}%` }} />
          </div>
          {controls && canCapability(p.snap, p.me.id, 'experience') && (
            <div className="flex gap-1 mt-2">
              <input
                className="input !w-16 !p-1 text-xs"
                aria-label="增加经验值"
                type="number"
                min="0"
                value={xpAmount}
                onChange={(e) => setXpAmount(e.target.value)}
              />
              <button
                className="tiny text-amber-300"
                onClick={() => void patch({ xpGain: Math.max(0, Number(xpAmount) || 0) })}
              >
                增加
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sheet-actions">
        <button className="btn" onClick={() => open('templates', c.id)}>
          <BookOpen size={15} />
          技能
        </button>
        <CharacterTagManageButton characterId={c.id} isGM={p.isGM} />
        {p.isGM && (
          <button className="btn" onClick={() => open('sheet')}>
            编辑人物卡
          </button>
        )}
        {inventoryVisible && (
          <>
            <button className="btn" onClick={() => open('inventory', c.id)}>
              <Backpack size={15} />
              背包
            </button>
            <button className="btn" onClick={() => open('equipment', c.id)}>
              <Shirt size={15} />
              装备
            </button>
          </>
        )}
      </div>
      <NpcSearchControl character={c} isGM={p.isGM} mutate={p.mutate} />
      <section>
        <div className="sheet-section-heading">
          <h3>六维属性</h3>
          <span>点击属性掷 1d20 检定</span>
        </div>
        <div className="ability-grid">
          {ABILITIES.map((key) => (
            <div key={key} className="ability-card">
              <AbilityRollButton busy={abilityBusy} ability={key} onRoll={() => void rollAbility(key)}>
                <div className="eyebrow">{key}</div>
                <div className="ability-mod">
                  {sign(
                    Number(
                      key === '敏捷' && c.derived?.agility ? c.derived.agility.bonus : (values[`${key}加值`] ?? 0),
                    ),
                  )}
                </div>
                {key === '敏捷' && c.derived?.agility && (
                  <span className="tiny text-sky-200">当前有效敏捷 {c.derived.agility.effective}</span>
                )}
                <div className="tiny flex items-center justify-center gap-1 text-amber-300">
                  <Dices size={12} /> 掷检定
                </div>
              </AbilityRollButton>
              <input
                key={`${c.version}-${key}`}
                aria-label={`${key}属性值`}
                className="ability-score"
                type="number"
                disabled={!can}
                defaultValue={c.attributes?.[key] ?? 10}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 0 && next !== Number(c.attributes?.[key] ?? 10))
                    void patch({ attributes: { [key]: next } });
                }}
              />
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="sheet-section-heading">
          <h3>角色故事</h3>
        </div>
        <textarea
          className="input min-h-24"
          aria-label="角色描述"
          placeholder="写下角色的来历、性格和目标…"
          disabled={!p.isGM}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== c.description && void patch({ description })}
        />
      </section>
      <section>
        <div className="sheet-section-heading">
          <h3>自定义数值</h3>
        </div>
        <div className="space-y-2">
          {Object.entries(c.attributes || {})
            .filter(([key]) => !(ABILITIES as readonly string[]).includes(key))
            .map(([key, value]) => (
              <label key={key} className="field-row">
                <span className="tiny w-24 truncate">{key}</span>
                <strong className="text-amber-300">{values[key] ?? value}</strong>
                <ValueSource
                  name={key}
                  base={value}
                  trace={c.derived?.breakdown?.[key]}
                  sources={c.derived?.sources?.[key] || []}
                />
                <input
                  aria-label={`${key}原始值`}
                  className="input !py-1"
                  type="number"
                  disabled={!can}
                  defaultValue={String(value)}
                  onBlur={(e) =>
                    Number(e.target.value) !== Number(value) &&
                    void patch({ attributes: { [key]: Number(e.target.value) } })
                  }
                />
              </label>
            ))}
        </div>
        {can && (
          <div className="flex gap-2 mt-2">
            <input
              className="input"
              placeholder="属性名称"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
            />
            <input
              className="input !w-24"
              type="number"
              value={fieldValue}
              onChange={(e) => setFieldValue(e.target.value)}
            />
            <button
              className="btn"
              disabled={!fieldName.trim()}
              onClick={async () => {
                await patch({ attributes: { [fieldName.trim()]: Number(fieldValue) } });
                setFieldName('');
                setFieldValue('0');
              }}
            >
              <Plus size={15} />
            </button>
          </div>
        )}
      </section>

      <CharacterSkills p={p} character={c} />
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <div className="tiny subtle">
        经验溢出：{rules.retainExcessXp ? '保留' : '升级后归零'}。战斗中的血量由战斗操作结算。
      </div>
    </div>
  );
}
