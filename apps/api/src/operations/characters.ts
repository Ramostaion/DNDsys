import {
  ABILITIES,
  DEFAULT_ATTACK_PROFILE,
  gainXp,
  rollDice,
  validateSheetDefinitions,
  canControlCharacter,
  gmManagedField,
  resourceField,
} from '@dnd/shared';
import { array, object } from '../data.js';
import { refreshCharacter } from '../character-values.js';
import { memberCan } from '../permissions.js';
import { fail as bad } from '../http.js';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadDir } from '../upload.js';
import {
  json,
  str,
  num,
  required,
  characterIn,
  editable,
  gm,
  version,
  sheetFieldSchema,
  sheetFields,
} from './helpers.js';
import type { OperationContext } from './context.js';

export async function characterOperation(context: OperationContext) {
  const { tx, room, member, rules, roomId, userId, type, p, createdFiles, opId } = context;
  let data: any;
  switch (context.type) {
    case 'character.create': {
      gm(member!);
      const attributes = room.sheetMode ? {} : Object.fromEntries(ABILITIES.map((k) => [k, 10]));
      const isNpc = p.isNpc === true,
        ownerId = isNpc ? null : p.ownerId || null;
      if (ownerId && !(await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId: ownerId } } })))
        bad(400, '角色控制者必须是本房间成员');
      const c = await tx.character.create({
        data: {
          roomId,
          name: required(p.name, '角色名'),
          isNpc,
          visibility: p.visibility === 'GM' ? 'GM' : 'PUBLIC',
          ownerId,
          attributes: json(attributes),
          currentHp: room.sheetMode ? 0 : 10,
          attackProfiles: json(room.sheetMode ? [] : [DEFAULT_ATTACK_PROFILE]),
        },
      });
      await refreshCharacter(tx, c.id, rules);
      data = await tx.character.findUniqueOrThrow({ where: { id: c.id } });
      break;
    }
    case 'sheet.health.configure': {
      gm(member!);
      if (!room.sheetMode) bad(400, '此设置用于自定义人物卡');
      if (p.version === undefined) bad(400, '缺少房间版本号');
      version(room.version, p.version);
      const fields = sheetFields(room.sheetSchema);
      let currentFieldId = str(p.currentFieldId),
        maxFieldId = str(p.maxFieldId);
      if (p.create === true) {
        const existing = resourceField(fields, 'health');
        if (existing) bad(409, '已有血条字段，请使用现有字段设置');
        const unique = (base: string) => {
          let id = base,
            n = 2;
          while (fields.some((field) => field.fieldId === id)) id = `${base}_${n++}`;
          return id;
        };
        maxFieldId = unique('hp_max');
        fields.push({
          fieldId: maxFieldId,
          name: '生命上限',
          type: 'number',
          defaultValue: 20,
          min: 0,
          group: '生命',
          visibility: 'ALL',
          editableBy: 'GM',
          sort: -20,
        });
        currentFieldId = unique('hp');
        fields.push({
          fieldId: currentFieldId,
          name: '当前生命',
          type: 'number',
          defaultValue: 20,
          min: 0,
          group: '生命',
          visibility: 'ALL',
          editableBy: 'GM',
          sort: -19,
        });
      }
      if (!currentFieldId || !maxFieldId || currentFieldId === maxFieldId) bad(400, '请选择两个不同的数值字段');
      for (const id of [currentFieldId, maxFieldId]) {
        const field = fields.find((candidate) => candidate.fieldId === id);
        if (!field || field.type !== 'number' || field.formula) bad(400, '血条需要可手动编辑的数值字段');
        const shield = resourceField(fields, 'shield');
        if (id === shield?.fieldId || id === shield?.maxFieldId) bad(400, '护盾字段不能用作生命血条');
      }
      const next = fields.map((field) =>
        field.fieldId === currentFieldId
          ? { ...field, isResource: true, resourceKind: 'health' as const, maxFieldId, editableBy: 'GM' as const }
          : field.fieldId === maxFieldId
            ? { ...field, editableBy: 'GM' as const }
            : field,
      );
      validateSheetDefinitions(next);
      const updated = await tx.room.updateMany({
        where: { id: roomId, version: room.version },
        data: { sheetSchema: json(next), version: { increment: 1 } },
      });
      if (!updated.count) bad(409, '人物卡字段已修改，请刷新后重试');
      for (const c of await tx.character.findMany({ where: { roomId }, select: { id: true } }))
        await refreshCharacter(tx, c.id, rules);
      data = { currentFieldId, maxFieldId, roomVersion: room.version + 1 };
      break;
    }
    case 'sheet.field.upsert': {
      gm(member!);
      if (p.version === undefined) bad(400, '缺少房间版本号');
      version(room.version, p.version);
      const field = sheetFieldSchema.parse(p.field);
      field.editableBy = 'GM';
      const current = sheetFields(room.sheetSchema);
      const index = current.findIndex((f) => f.fieldId === field.fieldId);
      const shield = resourceField(current, 'shield');
      if (field.fieldId === shield?.fieldId || field.fieldId === shield?.maxFieldId) {
        if (
          field.type !== 'number' ||
          field.formula ||
          (field.defaultValue !== undefined && (typeof field.defaultValue !== 'number' || field.defaultValue < 0))
        )
          bad(400, '护盾需要非负的可手动编辑数值字段');
        field.editableBy = 'GM';
        field.min = Math.max(0, field.min ?? 0);
        if (field.fieldId === shield?.fieldId) {
          field.isResource = true;
          field.resourceKind = 'shield';
          field.maxFieldId = shield.maxFieldId;
        }
      }
      if (index >= 0 && current[index].type !== field.type) {
        const chars = await tx.character.findMany({ where: { roomId }, select: { fieldValues: true } });
        if (chars.some((c) => Object.hasOwn(object(c.fieldValues), field.fieldId)))
          bad(409, '已有角色保存了此字段的数值，请先备份并迁移类型');
      }
      const next = index >= 0 ? current.map((f, i) => (i === index ? field : f)) : [...current, field];
      try {
        validateSheetDefinitions(next);
      } catch (e) {
        bad(400, (e as Error).message);
      }
      const updated = await tx.room.updateMany({
        where: { id: roomId, version: room.version },
        data: { sheetSchema: json(next), version: { increment: 1 } },
      });
      if (!updated.count) bad(409, '人物卡模板已被修改，请刷新');
      for (const c of await tx.character.findMany({ where: { roomId }, select: { id: true } }))
        await refreshCharacter(tx, c.id, rules);
      data = { field, roomVersion: room.version + 1 };
      break;
    }
    case 'sheet.field.remove': {
      gm(member!);
      if (p.version === undefined) bad(400, '缺少房间版本号');
      version(room.version, p.version);
      const current = sheetFields(room.sheetSchema),
        id = required(p.fieldId, '字段标识');
      if (!current.some((f) => f.fieldId === id)) bad(404, '字段不存在');
      const shield = resourceField(current, 'shield');
      if (id === shield?.fieldId || id === shield?.maxFieldId) bad(409, '护盾是固定资源字段，可将角色护盾设为 0');
      const dependent = current.filter((f) => f.formula?.includes(`{{${id}}}`) || f.maxFieldId === id);
      if (dependent.length) bad(409, `字段被 ${dependent.map((f) => f.name).join('、')} 引用，请先修改依赖`);
      const used = await tx.character.findMany({ where: { roomId }, select: { name: true, fieldValues: true } });
      if (used.some((c) => Object.hasOwn(object(c.fieldValues), id)))
        bad(409, '已有角色保存了该字段的数值，请先备份并迁移');
      const updated = await tx.room.updateMany({
        where: { id: roomId, version: room.version },
        data: { sheetSchema: json(current.filter((f) => f.fieldId !== id)), version: { increment: 1 } },
      });
      if (!updated.count) bad(409, '人物卡模板已被修改，请刷新');
      data = { fieldId: id, roomVersion: room.version + 1 };
      break;
    }
    case 'character.field.set':
    case 'character.field.adjust': {
      gm(member!);
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      editable(member!, c, userId);
      if (p.version === undefined) bad(400, '缺少角色版本号');
      version(c.version, p.version);
      const definitions = sheetFields(room.sheetSchema);
      const found = definitions.find((f) => f.fieldId === required(p.fieldId, '字段标识'));
      if (!found) bad(404, '字段不存在');
      const field = found!;
      if (field.formula) bad(403, '派生字段只能通过公式修改');
      const raw = object(c.fieldValues),
        previousValue = raw[field.fieldId] ?? field.defaultValue ?? null;
      let nextValue: unknown;
      if (type === 'character.field.adjust') {
        if (field.type !== 'number') bad(400, '只有数值字段可以增减');
        const delta = Number(p.delta);
        if (!Number.isFinite(delta) || Math.abs(delta) > 1e9) bad(400, '增减值无效');
        if (typeof previousValue !== 'number') bad(400, '原始数值未设置');
        nextValue = previousValue + delta;
      } else nextValue = p.value;
      if (field.type === 'number') {
        if (typeof nextValue !== 'number' || !Number.isFinite(nextValue) || Math.abs(nextValue) > 1e12)
          bad(400, '数值无效');
        const value = nextValue as number;
        if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))
          bad(400, '数值超出字段约束');
      } else if (field.type === 'text') {
        if (typeof nextValue !== 'string' || nextValue.length > 5000) bad(400, '文本字段无效');
      } else if (field.type === 'boolean') {
        if (typeof nextValue !== 'boolean') bad(400, '布尔字段无效');
      } else if (field.type === 'select') {
        if (typeof nextValue !== 'string' || !field.options?.includes(nextValue)) bad(400, '选项无效');
      }
      const changed = await tx.character.updateMany({
        where: { id: c.id, version: c.version },
        data: { fieldValues: json({ ...raw, [field.fieldId]: nextValue }), version: { increment: 1 } },
      });
      if (!changed.count) bad(409, '角色数值已被其他人修改，请刷新');
      await refreshCharacter(tx, c.id, rules);
      const audit = {
        operationId: opId,
        fieldId: field.fieldId,
        previousValue,
        newValue: nextValue,
        delta:
          field.type === 'number' && typeof previousValue === 'number' ? (nextValue as number) - previousValue : null,
        reason: str(p.reason).slice(0, 500),
      };
      await tx.activityLog.create({ data: { roomId, userId, action: type, entityId: c.id, data: json(audit) } });
      data = { characterId: c.id, fieldId: field.fieldId, previousValue, newValue: nextValue, version: c.version + 1 };
      break;
    }
    case 'character.update': {
      const c = await characterIn(tx, roomId, required(p.id, '角色 ID'));
      editable(member!, c, userId);
      version(c.version, p.version);
      const patch = object(p.patch);
      if (['name', 'avatarUrl'].some((key) => key in patch) && !memberCan(room, member!, 'characterBasics'))
        bad(403, 'GM 尚未授权编辑人物卡基础信息');
      if (
        ['description', 'currentHp', 'fields', 'formulas', 'skills', 'statuses', 'traits', 'inventorySlots'].some(
          (key) => key in patch,
        )
      )
        gm(member!);
      if (
        member!.role !== 'GM' &&
        Object.keys(object(patch.attributes)).some((name) =>
          gmManagedField({ fieldId: name, name, type: 'number' }, []),
        )
      )
        bad(403, '生命与特殊机制仅 GM 可修改');
      const allowed = [
        'name',
        'description',
        'avatarUrl',
        'ownerId',
        'visibility',
        'isNpc',
        'allowSearch',
        'currentHp',
        'inventorySlots',
        'fields',
        'skills',
        'statuses',
        'traits',
        'formulas',
        'attackProfiles',
      ];
      if (
        ['attributes', 'currentHp', 'fields', 'formulas'].some((key) => key in patch) &&
        !memberCan(room, member!, 'characterValues')
      )
        bad(403, '本房间由 GM 控制人物卡数值');
      if (['xpGain', 'level'].some((key) => key in patch) && !memberCan(room, member!, 'experience'))
        bad(403, '本房间由 GM 控制经验与等级');
      if (
        ['skills', 'statuses', 'traits', 'attackProfiles'].some((key) => key in patch) &&
        !memberCan(room, member!, 'templateInstall')
      )
        bad(403, '本房间由 GM 控制能力和状态');
      const changes: any = {};
      for (const key of allowed)
        if (key in patch) {
          if (['ownerId', 'visibility', 'isNpc', 'allowSearch'].includes(key)) gm(member!);
          changes[key] = ['fields', 'skills', 'statuses', 'traits', 'formulas'].includes(key)
            ? json(patch[key])
            : patch[key];
        }
      if ('allowSearch' in changes && typeof changes.allowSearch !== 'boolean') bad(400, '搜索许可应为开或关');
      if ('isNpc' in changes && typeof changes.isNpc !== 'boolean') bad(400, '角色类型无效');
      if (changes.isNpc ?? c.isNpc) {
        if (changes.ownerId) bad(400, 'NPC 由 GM 控制，不能分配给玩家');
        changes.ownerId = null;
      }
      if (
        changes.ownerId &&
        !(await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId: changes.ownerId } } }))
      )
        bad(400, '角色控制者必须是本房间成员');
      if ('visibility' in changes)
        changes.visibility =
          changes.visibility === 'GM'
            ? 'GM'
            : changes.visibility === 'PUBLIC'
              ? 'PUBLIC'
              : bad(400, '角色可见范围无效');
      const nextAvatar = String(changes.avatarUrl ?? c.avatarUrl ?? '');
      if (
        (changes.visibility ?? c.visibility) === 'GM' &&
        nextAvatar.startsWith('/uploads/') &&
        !nextAvatar.startsWith(`/uploads/${roomId}/private/`) &&
        !nextAvatar.startsWith(`/uploads/${roomId}/characters/${c.id}/`) &&
        !/^\/uploads\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)$/i.test(nextAvatar)
      )
        bad(409, '隐藏角色请使用私密上传头像');
      if ('attackProfiles' in patch) {
        gm(member!);
        const profiles = array(patch.attackProfiles);
        if (profiles.length > 20) bad(400, '攻击方式过多');
        for (const profile of profiles) {
          if (!profile.id || !profile.name || !profile.attack || !profile.damage) bad(400, '攻击方式字段不完整');
          try {
            rollDice(
              String(profile.attack),
              () => 0,
              () => 1,
            );
            rollDice(
              String(profile.damage),
              () => 0,
              () => 1,
            );
          } catch (e) {
            bad(400, (e as Error).message);
          }
        }
        changes.attackProfiles = json(profiles);
      }
      if ('currentHp' in patch) {
        const current = await tx.combatEncounter.findFirst({ where: { roomId, status: 'ACTIVE' } });
        if (current && member!.role !== 'GM') bad(403, '战斗中的血量由战斗操作结算');
        if (!Number.isSafeInteger(Number(patch.currentHp)) || Number(patch.currentHp) < 0) bad(400, '当前血量无效');
      }
      if ('attributes' in patch) {
        const next = { ...object(c.attributes), ...object(patch.attributes) };
        for (const [k, v] of Object.entries(next))
          if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) bad(400, `属性 ${k} 无效`);
        changes.attributes = json(next);
      }
      if ('xpGain' in patch) {
        const next = gainXp(c.level, c.xp, num(patch.xpGain), rules.retainExcessXp);
        changes.level = next.level;
        changes.xp = next.xp;
      }
      if ('level' in patch) {
        gm(member!);
        changes.level = Math.max(1, Math.floor(num(patch.level)));
      }
      if ('name' in changes) changes.name = required(changes.name, '角色名');
      const updated = await tx.character.update({
        where: { id: c.id },
        data: { ...changes, version: { increment: 1 } },
      });
      await refreshCharacter(tx, c.id, rules);
      data = updated;
      break;
    }
    case 'character.delete': {
      gm(member!);
      const c = await characterIn(tx, roomId, required(p.id, '角色 ID'));
      await tx.character.delete({ where: { id: c.id } });
      data = { id: c.id };
      break;
    }
    case 'character.copy': {
      gm(member!);
      const c = await characterIn(tx, roomId, required(p.id, '角色 ID'));
      const token = p.tokenId
        ? await tx.mapToken.findFirst({ where: { id: str(p.tokenId), characterId: c.id, map: { roomId } } })
        : null;
      if (p.tokenId && !token) bad(404, '当前地图人物不存在');
      const copy = await tx.character.create({
        data: {
          roomId,
          name: `${c.name} 副本`,
          visibility: c.visibility,
          isNpc: c.isNpc,
          allowSearch: c.allowSearch,
          ownerId: c.ownerId,
          avatarUrl: c.avatarUrl,
          description: c.description,
          level: c.level,
          xp: c.xp,
          currentHp: c.currentHp,
          attributes: json(c.attributes),
          formulas: json(c.formulas),
          fields: json(c.fields),
          fieldValues: json(c.fieldValues),
          skills: json(c.skills),
          statuses: json(c.statuses),
          traits: json(c.traits),
          inventorySlots: c.inventorySlots,
          attackProfiles: json(c.attackProfiles),
          initiativeConfig: json(c.initiativeConfig),
        },
      });
      if (c.avatarUrl?.startsWith(`/uploads/${roomId}/characters/${c.id}/`)) {
        const original = c.avatarUrl.split('/').at(-1)!;
        if (!/^[0-9a-f-]{36}\.webp$/.test(original)) bad(400, '原角色头像路径无效');
        const directory = join(uploadDir, roomId, 'characters', copy.id),
          filename = `${randomUUID()}.webp`,
          target = join(directory, filename);
        await mkdir(directory, { recursive: true });
        createdFiles.push(target);
        await copyFile(join(uploadDir, roomId, 'characters', c.id, original), target);
        copy.avatarUrl = `/uploads/${roomId}/characters/${copy.id}/${filename}`;
        await tx.character.update({ where: { id: copy.id }, data: { avatarUrl: copy.avatarUrl } });
      }
      for (const entry of c.inventory) {
        const cloned = await tx.inventoryEntry.create({
          data: {
            characterId: copy.id,
            itemId: entry.itemId,
            quantity: entry.quantity,
            position: entry.position,
            data: json(entry.data),
          },
        });
        for (const equipped of entry.equipped)
          await tx.equippedItem.create({ data: { characterId: copy.id, entryId: cloned.id, slot: equipped.slot } });
      }
      const tags = await tx.characterTag.findMany({ where: { characterId: c.id, roomId } });
      for (const tag of tags)
        await tx.characterTag.create({
          data: {
            roomId,
            characterId: copy.id,
            tagDefinitionId: tag.tagDefinitionId,
            detailsMarkdown: tag.detailsMarkdown,
            customFields: json(tag.customFields),
            remainingTurns: tag.remainingTurns,
            romanNumeral: tag.romanNumeral,
            visibility: tag.visibility,
            priority: tag.priority,
            sortOrder: tag.sortOrder,
          },
        });
      if (token)
        await tx.mapToken.create({
          data: {
            mapId: token.mapId,
            characterId: copy.id,
            visibility: token.visibility,
            x: token.x + 35,
            y: token.y + 35,
          },
        });
      await refreshCharacter(tx, copy.id, rules);
      data = await tx.character.findUniqueOrThrow({ where: { id: copy.id } });
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
