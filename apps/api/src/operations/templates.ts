import { array, object } from '../data.js';
import { refreshCharacter } from '../character-values.js';
import { memberCan } from '../permissions.js';
import { fail as bad } from '../http.js';
import { randomUUID } from 'node:crypto';
import { customFieldsInput } from '../custom-fields.js';
import { json, str, required, characterIn, editable, gm, version, modifierData } from './helpers.js';
import type { OperationContext } from './context.js';

export async function templateOperation(context: OperationContext) {
  const { tx, room, member, rules, roomId, userId, p } = context;
  let data: any;
  switch (context.type) {
    case 'template.create': {
      gm(member!);
      const kind = required(p.kind, '模板类型');
      if (!['TRAIT', 'SKILL', 'STATUS', 'SPECIAL'].includes(kind)) bad(400, '模板类型无效');
      data = await tx.template.create({
        data: {
          roomId,
          kind,
          name: required(p.name, '模板名称'),
          description: str(p.description).slice(0, 5000),
          iconUrl: p.iconUrl ? str(p.iconUrl) : null,
          data: json(templateData(p.data)),
        },
      });
      break;
    }
    case 'template.update': {
      gm(member!);
      const template = await tx.template.findFirst({ where: { id: str(p.id), roomId } });
      if (!template) bad(404, '模板不存在');
      version(template!.version, p.version);
      const patch = object(p.patch),
        update: any = { version: { increment: 1 } };
      for (const key of ['name', 'description', 'iconUrl', 'data'])
        if (key in patch)
          update[key] =
            key === 'data'
              ? json(templateData(patch[key]))
              : key === 'name'
                ? required(patch.name, '模板名称')
                : key === 'description'
                  ? str(patch.description).slice(0, 5000)
                  : patch[key];
      data = await tx.template.update({ where: { id: template!.id }, data: update });
      const field = template!.kind === 'TRAIT' ? 'traits' : template!.kind === 'STATUS' ? 'statuses' : 'skills';
      const chars = await tx.character.findMany({ where: { roomId } });
      for (const c of chars) {
        const instances = array((c as any)[field]);
        if (!instances.some((i) => i.shared === true && i.templateId === template!.id)) continue;
        const next = instances.map((i) =>
          i.shared === true && i.templateId === template!.id
            ? {
                id: i.id,
                kind: template!.kind,
                templateId: template!.id,
                name: data.name,
                description: data.description,
                ...object(data.data),
                shared: true,
                enabled: i.enabled !== false,
              }
            : i,
        );
        await tx.character.update({ where: { id: c.id }, data: { [field]: json(next), version: { increment: 1 } } });
        await refreshCharacter(tx, c.id, rules);
      }
      break;
    }
    case 'template.delete': {
      gm(member!);
      const template = await tx.template.findFirst({ where: { id: str(p.id), roomId } });
      if (!template) bad(404, '模板不存在');
      const field = template!.kind === 'TRAIT' ? 'traits' : template!.kind === 'STATUS' ? 'statuses' : 'skills';
      const characters = await tx.character.findMany({ where: { roomId }, select: { [field]: true } });
      if (characters.some((c) => array((c as any)[field]).some((instance) => instance.templateId === template!.id)))
        bad(409, '此模板仍被角色使用，请先从角色卡移除');
      await tx.template.delete({ where: { id: template!.id } });
      data = { id: template!.id };
      break;
    }
    case 'template.apply': {
      if (!memberCan(room, member!, 'templateInstall') || !memberCan(room, member!, 'characterValues'))
        bad(403, '本房间由 GM 安装能力和状态');
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      editable(member!, c, userId);
      const template = await tx.template.findFirst({ where: { id: str(p.templateId), roomId } });
      if (!template) bad(404, '模板不存在');
      const field = template!.kind === 'TRAIT' ? 'traits' : template!.kind === 'STATUS' ? 'statuses' : 'skills';
      const current = array((c as any)[field]);
      if (current.some((instance) => instance.templateId === template!.id))
        bad(409, '该角色已安装此模板，如需叠加请复制为新的模板');
      if (member!.role !== 'GM' && template!.kind === 'SPECIAL') bad(403, '特殊机制仅 GM 可设置');
      const instance = {
        id: crypto.randomUUID(),
        kind: template!.kind,
        templateId: template!.id,
        name: template!.name,
        description: template!.description,
        ...object(template!.data),
        enabled: true,
        shared: p.shared === true,
      };
      data = await tx.character.update({
        where: { id: c.id },
        data: { [field]: json([...current, instance]), version: { increment: 1 } },
      });
      await refreshCharacter(tx, c.id, rules);
      break;
    }
    case 'template.enable': {
      if (
        p.field !== 'traits' &&
        (!memberCan(room, member!, 'templateInstall') || !memberCan(room, member!, 'characterValues'))
      )
        bad(403, '本房间由 GM 管理能力和状态');
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      editable(member!, c, userId);
      version(c.version, p.version);
      const field = ['traits', 'statuses'].includes(str(p.field)) ? str(p.field) : bad(400, '类型无效');
      const current = array((c as any)[field]);
      if (!current.some((instance) => instance.id === p.instanceId)) bad(404, '角色效果不存在');
      const chosen = current.find((instance) => instance.id === p.instanceId);
      if (
        member!.role !== 'GM' &&
        (chosen?.kind === 'SPECIAL' ||
          (chosen?.templateId &&
            (await tx.template.findUnique({ where: { id: chosen.templateId } }))?.kind === 'SPECIAL'))
      )
        bad(403, '特殊机制仅 GM 可设置');
      const next = current.map((instance) =>
        instance.id === p.instanceId ? { ...instance, enabled: p.enabled === true } : instance,
      );
      data = await tx.character.update({
        where: { id: c.id },
        data: { [field]: json(next), version: { increment: 1 } },
      });
      await refreshCharacter(tx, c.id, rules);
      break;
    }
    case 'template.remove': {
      if (!memberCan(room, member!, 'templateInstall') || !memberCan(room, member!, 'characterValues'))
        bad(403, '本房间由 GM 管理能力和状态');
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      editable(member!, c, userId);
      const field = ['traits', 'statuses', 'skills'].includes(str(p.field)) ? str(p.field) : bad(400, '类型无效');
      const chosen = array((c as any)[field]).find((instance) => instance.id === p.instanceId);
      if (
        member!.role !== 'GM' &&
        (chosen?.kind === 'SPECIAL' ||
          (chosen?.templateId &&
            (await tx.template.findUnique({ where: { id: chosen.templateId } }))?.kind === 'SPECIAL'))
      )
        bad(403, '特殊机制仅 GM 可设置');
      data = await tx.character.update({
        where: { id: c.id },
        data: {
          [field]: json(array((c as any)[field]).filter((x) => x.id !== p.instanceId)),
          version: { increment: 1 },
        },
      });
      await refreshCharacter(tx, c.id, rules);
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;

  function templateData(value: unknown) {
    const data = modifierData(value, room);
    if ('customFields' in data) data.customFields = customFieldsInput.parse(data.customFields);
    return data;
  }
}
