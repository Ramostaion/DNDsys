import { useState } from 'react';
import { DEFAULT_RULES, permissionDefaults, roomMemberName } from '@dnd/shared';
import { post } from '../../api';
import type { RoomPanelProps as Props } from './types';
import { useNavigate } from 'react-router-dom';
import RoomDeleteButton from './RoomDeleteButton';
import { useUI } from '../../store';
import RoomProfileSettings from './RoomProfileSettings';

function Field({
  label,
  value,
  onSave,
  type = 'text',
}: {
  label: string;
  value: any;
  onSave: (v: string) => void;
  type?: string;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input
        className="input"
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== String(value ?? '')) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function Action({
  children,
  onClick,
  disabled = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => unknown;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button disabled={disabled} className={`btn ${className}`} onClick={() => void onClick()}>
      {children}
    </button>
  );
}
function PasswordChange() {
  const [oldPassword, setOld] = useState(''),
    [newPassword, setNew] = useState(''),
    [message, setMessage] = useState('');
  return (
    <div className="border-t border-[#34465b] pt-4">
      <h3 className="font-semibold mb-2">修改密码</h3>
      <div className="flex gap-2">
        <input
          className="input"
          type="password"
          placeholder="当前密码"
          value={oldPassword}
          onChange={(e) => setOld(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="新密码（至少 8 位）"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
      </div>
      <Action
        className="mt-2"
        onClick={async () => {
          try {
            await post('/auth/password', { oldPassword, newPassword });
            setOld('');
            setNew('');
            setMessage('密码已更新');
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        保存新密码
      </Action>
      {message && <div className="tiny mt-2">{message}</div>}
    </div>
  );
}
const permissionLabels = [
  ['characterBasics', '编辑人物卡基础信息'],
  ['characterValues', '编辑普通人物数值'],
  ['inventoryAdd', '从物品库加入背包'],
  ['experience', '经验与等级'],
  ['templateInstall', '能力与 Buff'],
  ['trade', '玩家交易'],
  ['viewOtherInventories', '查看其他角色的背包与装备'],
] as const;
function PermissionSettings({ p }: { p: Props }) {
  const room = p.snap.room,
    initialMode = (room.permissionMode || 'MIXED') as keyof typeof permissionDefaults;
  const [mode, setMode] = useState<keyof typeof permissionDefaults>(initialMode),
    [settings, setSettings] = useState<Record<string, boolean>>(room.permissionSettings || {}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  if (!p.isGM) return null;
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      await post(`/rooms/${room.id}/permission-mode`, { version: room.version, mode, settings });
      await p.refresh();
      setMessage('权限模式已保存');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function memberOverride(member: any, key: string, value: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const permissions = { ...member.permissions };
      if (key === 'publicItems') delete permissions.editItems;
      if (value === 'inherit') delete permissions[key];
      else permissions[key] = value === 'allow';
      await post(`/rooms/${room.id}/members/${member.userId}/permissions`, permissions);
      await p.refresh();
      setMessage('成员权限已更新');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel p-3 rounded-lg space-y-3 mt-4">
      <h3 className="font-semibold">房间操作权限</h3>
      <p className="tiny subtle">
        人物卡基础信息、普通数值和物品库加入背包默认关闭。生命、护盾、资源上限、故事与特殊机制始终由 GM
        修改。可全房间授权，也可下方单独授权成员。
      </p>
      <label>
        <span className="label">权限模式</span>
        <select
          className="input"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as keyof typeof permissionDefaults);
            setSettings({});
          }}
        >
          <option value="FREE">自由：模板与交易开放，人物卡需授权</option>
          <option value="MIXED">混合：人物卡默认由 GM 维护</option>
          <option value="CONTROLLED">受控：GM 维护数值与物品</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {permissionLabels.map(([key, label]) => (
          <label key={key} className="flex gap-2 items-center tiny">
            <input
              type="checkbox"
              checked={settings[key] ?? permissionDefaults[mode][key]}
              onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? '保存中…' : '保存权限模式'}
      </button>
      <div className="border-t border-[#34465b] pt-3">
        <div className="font-semibold text-sm mb-2">成员例外</div>
        {p.snap.members
          .filter((member) => member.role !== 'GM')
          .map((member) => (
            <div key={member.userId} className="grid-card mb-2">
              <strong className="text-sm" title={`账号：${member.user.username}`}>
                {roomMemberName(member)}
              </strong>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {permissionLabels.map(([key, label]) => (
                  <label key={key} className="tiny">
                    <span>{label}</span>
                    <select
                      disabled={busy}
                      aria-label={`${roomMemberName(member)} · ${label}`}
                      className="input !p-1 text-xs"
                      value={
                        member.permissions?.[key] === true
                          ? 'allow'
                          : member.permissions?.[key] === false
                            ? 'deny'
                            : 'inherit'
                      }
                      onChange={(e) => void memberOverride(member, key, e.target.value)}
                    >
                      <option value="inherit">跟随房间</option>
                      <option value="allow">允许</option>
                      <option value="deny">禁止</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>
      {message && <p className="tiny">{message}</p>}
    </div>
  );
}
function EquipmentSlotsSettings({ p }: { p: Props }) {
  const room = p.snap.room,
    [value, setValue] = useState((p.snap.room.equipmentSlots || []).join('、')),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  if (!p.isGM) return null;
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const slots = value
        .split(/[、,，\n]/)
        .map((slot: string) => slot.trim())
        .filter(Boolean);
      await post(`/rooms/${room.id}/equipment-slots`, { version: room.version, slots });
      await p.refresh();
      setMessage('装备部位已保存');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel p-3 rounded-lg space-y-2 mt-4">
      <h3 className="font-semibold">装备部位</h3>
      <p className="tiny subtle">用顿号或逗号分隔。已装有物品的部位须先卸下才能删除。</p>
      <textarea className="input min-h-20" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? '保存中…' : '保存部位'}
      </button>
      {message && <p className="tiny">{message}</p>}
    </div>
  );
}
function Settings({ p }: { p: Props }) {
  const room = p.snap.room;
  const rules = { ...DEFAULT_RULES, ...room.rules };
  const [max, setMax] = useState(String(rules.maximumPlayers));
  const [min, setMin] = useState(String(rules.minimumPlayers));
  const [retain, setRetain] = useState(rules.retainExcessXp);
  const [seven, setSeven] = useState(String(rules.abilityRanges.find((x: any) => x.min === 7)?.bonus ?? -1));
  return (
    <div className="space-y-4">
      <div>
        <div className="label">邀请码</div>
        <div className="font-mono text-xl">{room.inviteCode}</div>
      </div>
      {p.isGM && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="最少玩家" value={min} type="number" onSave={setMin} />
            <Field label="最多玩家（上限 8）" value={max} type="number" onSave={setMax} />
          </div>
          {!room.sheetMode && (
            <>
              <label className="flex gap-2 items-center">
                <input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} />
                保留溢出经验
              </label>
              <Field label="属性值 7 的判定加值（临时默认 -1）" value={seven} type="number" onSave={setSeven} />
            </>
          )}
          <Action
            className="btn-primary"
            onClick={async () => {
              const abilityRanges = rules.abilityRanges.map((r: any) =>
                r.min === 7 ? { ...r, bonus: Number(seven) } : r,
              );
              await post(`/rooms/${room.id}/rules`, {
                ...rules,
                minimumPlayers: Number(min),
                maximumPlayers: Number(max),
                retainExcessXp: retain,
                abilityRanges,
              });
              await p.refresh();
            }}
          >
            保存规则
          </Action>
          <div className="border-t border-[#34465b] pt-3">
            <h3 className="font-semibold mb-2">玩家权限</h3>
            {p.snap.members
              .filter((m) => m.role !== 'GM')
              .map((m) => (
                <div key={m.userId} className="grid-card mb-2">
                  <div title={`账号：${m.user.username}`}>{roomMemberName(m)}</div>
                  <div className="flex flex-wrap gap-3 tiny mt-2">
                    {[
                      ['draw', '绘画'],
                      ['editAllCharacters', '编辑其他玩家角色（NPC 除外）'],
                      ['upload', '上传图片'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={m.permissions?.[key] === true}
                          onChange={async (e) => {
                            await post(`/rooms/${room.id}/members/${m.userId}/permissions`, {
                              ...m.permissions,
                              [key]: e.target.checked,
                            });
                            await p.refresh();
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <button
                    className="tiny text-red-300 mt-2"
                    onClick={async () => {
                      if (confirm(`踢出 ${roomMemberName(m)}？`)) {
                        await post(`/rooms/${room.id}/kick`, { userId: m.userId });
                        await p.refresh();
                      }
                    }}
                  >
                    踢出房间
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
      <div className="tiny subtle">服务器保存各房间独立规则，并在修改后重新计算角色派生属性。</div>
    </div>
  );
}

export default function RoomSettings({ p }: { p: Props }) {
  const navigate = useNavigate();
  return (
    <>
      <RoomProfileSettings p={p} />
      <Settings p={p} />
      <PermissionSettings p={p} />
      <EquipmentSlotsSettings p={p} />
      <PasswordChange />
      {p.isGM && p.snap.room.ownerId === p.me.id && (
        <div className="border-t border-red-900/50 pt-4 space-y-2">
          <h3 className="font-semibold">删除房间</h3>
          <p className="tiny subtle">永久删除该房间及其内容，仅房间创建者可操作。</p>
          <RoomDeleteButton
            room={p.snap.room}
            userId={p.me.id}
            onDeleted={(result) => {
              useUI.setState({ windows: [], closeGuards: {} });
              navigate('/rooms', { replace: true, state: { message: result.warning } });
            }}
          />
        </div>
      )}
    </>
  );
}
