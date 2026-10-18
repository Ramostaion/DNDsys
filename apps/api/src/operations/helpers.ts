import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { validateSheetDefinitions, withShieldFields, canControlCharacter, type SheetField } from '@dnd/shared';
import { object } from '../data.js';
import { memberCan } from '../permissions.js';
import { fail as bad } from '../http.js';
export const json = (v: unknown) => v as Prisma.InputJsonValue;
export const str = (v: unknown) => String(v ?? '').trim();
export const num = (v: unknown) => Number(v);
export const required = (v: unknown, name: string) => {
  const s = str(v);
  if (!s) bad(400, `${name}不能为空`);
  return s;
};
type Tx = Prisma.TransactionClient;
export async function characterIn(tx: Tx, roomId: string, id: string) {
  const c = await tx.character.findFirst({
    where: { id, roomId },
    include: {
      inventory: { include: { item: true, equipped: true } },
      equipment: { include: { entry: { include: { item: true } } } },
    },
  });
  if (!c) bad(404, '角色不存在');
  return c!;
}
export async function mapIn(tx: Tx, roomId: string, id: string) {
  const m = await tx.map.findFirst({ where: { id, roomId } });
  if (!m) bad(404, '地图不存在');
  return m!;
}
export function editable(
  member: { role: string; permissions: unknown },
  character: { ownerId: string | null; visibility: string; isNpc: boolean },
  userId: string,
) {
  if (!canControlCharacter(member, character, userId))
    bad(403, character.isNpc ? 'NPC 仅 GM 可控制' : '没有角色编辑权限');
}
export function gm(member: { role: string }) {
  if (member.role !== 'GM') bad(403, '仅主持人可以执行此操作');
}
export function canEditItems(
  room: { permissionMode: string; permissionSettings: unknown },
  member: { role: string; permissions: unknown },
) {
  gm(member);
  if (!memberCan(room, member, 'publicItems')) bad(403, '没有编辑公共物品的权限');
}
export function version(current: number, expected: unknown) {
  if (expected !== undefined && current !== num(expected)) bad(409, '数据已被其他人修改，请刷新后重试');
}
export function requestId(v: unknown) {
  const id = str(v);
  if (!/^[\w-]{8,100}$/.test(id)) bad(400, '操作 ID 无效');
  return id;
}
export const sheetFieldSchema = z.object({
  fieldId: z.string(),
  name: z.string(),
  type: z.enum(['number', 'text', 'boolean', 'select']),
  group: z.string().max(80).optional(),
  sort: z.number().int().optional(),
  defaultValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  formula: z.string().max(256).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  options: z.array(z.string().max(100)).max(100).optional(),
  visibility: z.enum(['ALL', 'GM', 'OWNER']).optional(),
  editableBy: z.enum(['GM', 'OWNER']).optional(),
  isResource: z.boolean().optional(),
  resourceKind: z.enum(['health', 'shield']).optional(),
  maxFieldId: z.string().optional(),
});
export function sheetFields(value: unknown): SheetField[] {
  const fields = withShieldFields(z.array(sheetFieldSchema).max(200).parse(value));
  validateSheetDefinitions(fields);
  return fields;
}
export function modifierData(value: unknown, room: { sheetSchema: unknown; sheetMode: boolean }) {
  const data = object(value);
  if ('modifierRows' in data) {
    const rows = z
      .array(
        z.object({
          targetFieldId: z.string(),
          operation: z.enum(['ADD', 'MULTIPLY', 'OVERRIDE']),
          value: z.number().finite().min(-1e9).max(1e9),
          priority: z.number().int().min(-1000).max(1000).optional(),
        }),
      )
      .max(50)
      .parse(data.modifierRows);
    if (room.sheetMode) {
      const numeric = new Set(
        sheetFields(room.sheetSchema)
          .filter((f) => f.type === 'number')
          .map((f) => f.fieldId),
      );
      for (const row of rows) if (!numeric.has(row.targetFieldId)) bad(400, `修正目标字段不存在：${row.targetFieldId}`);
    }
    data.modifierRows = rows;
  }
  if ('modifiers' in data)
    for (const [key, amount] of Object.entries(object(data.modifiers)))
      if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e9)
        bad(400, `修正值无效：${key}`);
  return data;
}
export function itemData(value: unknown, room: { sheetSchema: unknown; sheetMode: boolean }) {
  const data = modifierData(value, room);
  if ('customFields' in data) {
    const fields = z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          value: z.union([z.string().max(5000), z.number().finite()]),
        }),
      )
      .max(50)
      .parse(data.customFields);
    if (new Set(fields.map((field) => field.name)).size !== fields.length) bad(400, '自定义项目名称不能重复');
    data.customFields = fields;
  }
  if ('notes' in data) data.notes = z.string().max(5000).parse(data.notes);
  return data;
}

export function backpackData(kind: string, value: unknown, room: { sheetSchema: unknown; sheetMode: boolean }) {
  const data = itemData(value, room);
  if (kind === '背包') {
    const fields = Array.isArray(data.customFields) ? (data.customFields as { name: string; value: unknown }[]) : [];
    const slots = fields.find((field) => field.name === '格数');
    if (
      slots &&
      (typeof slots.value !== 'number' ||
        !Number.isSafeInteger(slots.value) ||
        slots.value < 0 ||
        slots.value > 2147483647)
    )
      bad(400, '背包格数必须是非负整数，请将词条类型设为数值');
    data.customFields = slots ? fields : [{ name: '格数', value: 0 }, ...fields];
  }
  return data;
}
