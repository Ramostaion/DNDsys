import type { SheetField } from './sheet.js';

export type RoomCapability =
  | 'characterBasics'
  | 'characterValues'
  | 'inventoryAdd'
  | 'experience'
  | 'templateInstall'
  | 'publicItems'
  | 'trade'
  | 'viewOtherInventories';
export type PermissionMode = 'FREE' | 'MIXED' | 'CONTROLLED';
export const capabilityKeys: RoomCapability[] = [
  'characterBasics',
  'characterValues',
  'inventoryAdd',
  'experience',
  'templateInstall',
  'publicItems',
  'trade',
  'viewOtherInventories',
];
export const permissionDefaults: Record<PermissionMode, Record<RoomCapability, boolean>> = {
  FREE: {
    characterBasics: false,
    characterValues: false,
    inventoryAdd: false,
    experience: true,
    templateInstall: true,
    publicItems: true,
    trade: true,
    viewOtherInventories: false,
  },
  MIXED: {
    characterBasics: false,
    characterValues: false,
    inventoryAdd: false,
    experience: false,
    templateInstall: false,
    publicItems: false,
    trade: true,
    viewOtherInventories: false,
  },
  CONTROLLED: {
    characterBasics: false,
    characterValues: false,
    inventoryAdd: false,
    experience: false,
    templateInstall: false,
    publicItems: false,
    trade: false,
    viewOtherInventories: false,
  },
};
type RoomPolicy = { permissionMode?: string; permissionSettings?: unknown };
type MemberPolicy = { role: string; permissions?: unknown };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export function permissionMode(value: unknown): PermissionMode {
  return value === 'FREE' || value === 'CONTROLLED' ? value : 'MIXED';
}
export function roomPolicy(room: RoomPolicy) {
  const preset = permissionDefaults[permissionMode(room.permissionMode)],
    settings = record(room.permissionSettings);
  return Object.fromEntries(
    capabilityKeys.map((key) => [key, typeof settings[key] === 'boolean' ? settings[key] : preset[key]]),
  ) as Record<RoomCapability, boolean>;
}
export function memberCan(room: RoomPolicy, member: MemberPolicy | undefined, capability: RoomCapability) {
  if (!member) return false;
  if (member.role === 'GM') return true;
  const permissions = record(member.permissions),
    override = permissions[capability] ?? (capability === 'publicItems' ? permissions.editItems : undefined);
  return typeof override === 'boolean' ? override : roomPolicy(room)[capability];
}
export function gmManagedField(field: SheetField, fields: SheetField[]) {
  const healthNames =
    /^(当前)?(生命|生命值|血量|血量值|HP)(上限|最大值|最大)?$|^(生命上限|最大生命|最大生命值|最大血量|血量上限|max_hp|hp_max|hp)$/i;
  return (
    (field.isResource === true && !!field.maxFieldId) ||
    fields.some((candidate) => candidate.isResource && candidate.maxFieldId === field.fieldId) ||
    healthNames.test(field.name) ||
    healthNames.test(field.fieldId) ||
    /护盾|shield|故事|背景|特殊机制/i.test(`${field.name} ${field.fieldId} ${field.group || ''}`)
  );
}
export function sheetFieldCapability(field: SheetField): RoomCapability {
  return /基础信息|基本信息|基础资料/.test(field.group || '') || /^(姓名|名称|年龄|性别|种族|职业)$/.test(field.name)
    ? 'characterBasics'
    : 'characterValues';
}
export function canEditSheetField(
  _room: RoomPolicy,
  member: MemberPolicy | undefined,
  _character: { ownerId: string | null; visibility?: string; isNpc?: boolean },
  _userId: string,
  field: SheetField,
  _fields: SheetField[],
) {
  return member?.role === 'GM' && !field.formula;
}
