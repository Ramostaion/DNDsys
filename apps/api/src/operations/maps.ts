import { object } from '../data.js';
import { fail as bad } from '../http.js';
import { str, num, required, characterIn, mapIn, editable, gm, version } from './helpers.js';
import type { OperationContext } from './context.js';

export async function mapOperation(context: OperationContext) {
  const { tx, room, member, roomId, userId, p } = context;
  let data: any;
  switch (context.type) {
    case 'map.create': {
      gm(member!);
      const parent = p.parentId ? await mapIn(tx, roomId, str(p.parentId)) : null;
      const visibility = parent?.visibility === 'GM' || p.visibility === 'GM' ? 'GM' : 'PUBLIC';
      if (
        visibility === 'GM' &&
        str(p.imageUrl).startsWith('/uploads/') &&
        !str(p.imageUrl).startsWith(`/uploads/${roomId}/private/`)
      )
        bad(409, '私密地图请使用私密上传图片');
      data = await tx.map.create({
        data: {
          roomId,
          name: required(p.name, '地图名'),
          visibility,
          parentId: p.parentId || null,
          imageUrl: p.imageUrl || null,
          width: Math.max(1, num(p.width) || 1600),
          height: Math.max(1, num(p.height) || 900),
        },
      });
      break;
    }
    case 'map.update': {
      gm(member!);
      const m = await mapIn(tx, roomId, required(p.id, '地图 ID'));
      version(m.version, p.version);
      const patch = object(p.patch);
      if (patch.parentId) {
        if (patch.parentId === m.id) bad(400, '地图不能成为自己的子地图');
        await mapIn(tx, roomId, patch.parentId);
      }
      const update: any = { version: { increment: 1 } };
      for (const key of ['name', 'imageUrl', 'parentId', 'width', 'height', 'scalePixels', 'scaleUnits'])
        if (key in patch) update[key] = patch[key];
      if ('name' in patch) update.name = required(patch.name, '地图名称');
      for (const key of ['width', 'height'])
        if (key in patch) {
          const value = Number(patch[key]);
          if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) bad(400, '地图宽度与高度应为正整数');
          update[key] = value;
        }
      for (const key of ['scalePixels', 'scaleUnits'])
        if (key in patch) {
          const value = Number(patch[key]);
          if (!Number.isFinite(value) || value <= 0) bad(400, '地图比例尺应大于 0');
          update[key] = value;
        }
      if ('visibility' in patch) {
        if (!['PUBLIC', 'GM'].includes(patch.visibility)) bad(400, '地图可见范围无效');
        update.visibility = patch.visibility;
      }
      const parentId = 'parentId' in patch ? patch.parentId : m.parentId;
      if (parentId) {
        const parent = await mapIn(tx, roomId, str(parentId));
        if (parent.visibility === 'GM' && (update.visibility ?? m.visibility) === 'PUBLIC')
          bad(409, '私密父地图下的子地图不能公开');
      }
      if (update.visibility === 'GM' && (await tx.map.count({ where: { parentId: m.id, visibility: 'PUBLIC' } })))
        bad(409, '请先将公开子地图设为仅 GM 可见');
      const nextImage = String(update.imageUrl ?? m.imageUrl ?? '');
      if (
        (update.visibility ?? m.visibility) === 'GM' &&
        nextImage.startsWith('/uploads/') &&
        !nextImage.startsWith(`/uploads/${roomId}/private/`)
      )
        bad(409, '私密地图请先移除公开上传图片，设为私密后再上传');
      data = await tx.map.update({ where: { id: m.id }, data: update });
      break;
    }
    case 'map.delete': {
      gm(member!);
      const m = await mapIn(tx, roomId, required(p.id, '地图 ID'));
      if (room.activeMapId === m.id)
        await tx.room.update({ where: { id: roomId }, data: { activeMapId: null, version: { increment: 1 } } });
      await tx.map.delete({ where: { id: m.id } });
      data = { id: m.id };
      break;
    }
    case 'map.activate': {
      gm(member!);
      if (p.id) await mapIn(tx, roomId, str(p.id));
      data = await tx.room.update({
        where: { id: roomId },
        data: { activeMapId: p.id || null, version: { increment: 1 } },
      });
      break;
    }
    case 'portal.create': {
      gm(member!);
      const source = await mapIn(tx, roomId, required(p.sourceMapId, '源地图'));
      const target = await mapIn(tx, roomId, required(p.targetMapId, '目标地图'));
      if (source.id === target.id) bad(400, '入口目标应为另一张地图');
      data = await tx.mapPortal.create({
        data: {
          sourceMapId: source.id,
          targetMapId: target.id,
          label: required(p.label, '入口名称'),
          x: num(p.x),
          y: num(p.y),
        },
      });
      break;
    }
    case 'portal.update': {
      gm(member!);
      const portal = await tx.mapPortal.findFirst({ where: { id: required(p.id, '入口 ID'), source: { roomId } } });
      if (!portal) bad(404, '入口不存在');
      const update: { label?: string; x?: number; y?: number } = {};
      if ('label' in p) update.label = required(p.label, '入口名称');
      for (const key of ['x', 'y'] as const)
        if (key in p) {
          const value = Number(p[key]);
          if (!Number.isFinite(value)) bad(400, '入口坐标无效');
          update[key] = value;
        }
      if (!Object.keys(update).length) bad(400, '没有要修改的入口内容');
      data = await tx.mapPortal.update({ where: { id: portal!.id }, data: update });
      break;
    }
    case 'portal.delete': {
      gm(member!);
      const portal = await tx.mapPortal.findFirst({ where: { id: str(p.id), source: { roomId } } });
      if (!portal) bad(404, '入口不存在');
      await tx.mapPortal.delete({ where: { id: portal!.id } });
      data = { id: portal!.id };
      break;
    }
    case 'token.create': {
      const map = await mapIn(tx, roomId, required(p.mapId, '地图 ID')),
        c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      editable(member!, c, userId);
      if ((map.visibility === 'GM' || c.visibility === 'GM' || p.visibility === 'GM') && member!.role !== 'GM')
        bad(403, '私密地图、角色和 Token 仅 GM 可操作');
      if (member!.role !== 'GM' && (await tx.mapToken.findFirst({ where: { mapId: map.id, characterId: c.id } })))
        bad(403, '仅主持人可以复制棋子');
      data = await tx.mapToken.create({
        data: {
          mapId: map.id,
          characterId: c.id,
          visibility: p.visibility === 'GM' ? 'GM' : 'PUBLIC',
          x: num(p.x),
          y: num(p.y),
        },
      });
      break;
    }
    case 'token.copy': {
      gm(member!);
      const token = await tx.mapToken.findFirst({ where: { id: required(p.id, '棋子 ID'), map: { roomId } } });
      if (!token) bad(404, 'Token 不存在');
      data = await tx.mapToken.create({
        data: {
          mapId: token!.mapId,
          characterId: token!.characterId,
          visibility: token!.visibility,
          x: token!.x + 35,
          y: token!.y + 35,
        },
      });
      break;
    }
    case 'token.move': {
      const x = Number(p.x),
        y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) bad(400, '棋子坐标无效');
      const token: any = await tx.mapToken.findFirst({
        where: { id: str(p.id), map: { roomId } },
        include: { character: true, map: true },
      });
      if (!token) bad(404, 'Token 不存在');
      if (
        member!.role !== 'GM' &&
        (token.visibility === 'GM' || token.map.visibility === 'GM' || token.character.visibility === 'GM')
      )
        bad(403, '私密 Token 仅 GM 可操作');
      editable(member!, token.character, userId);
      version(token.version, p.version);
      const currentRoom = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
      if (currentRoom.activeMapId !== token!.mapId) bad(409, '地图已切换，请刷新');
      const moved = await tx.mapToken.updateMany({
        where: { id: token!.id, version: token!.version },
        data: { x, y, version: { increment: 1 } },
      });
      if (!moved.count) bad(409, 'Token 已被其他人移动');
      data = await tx.mapToken.findUniqueOrThrow({ where: { id: token!.id } });
      data = {
        ...data,
        movement: {
          eventId: context.opId,
          roomId,
          tokenId: token.id,
          characterId: token.characterId,
          mapId: token.mapId,
          actorId: userId,
          version: data.version,
          from: { x: token.x, y: token.y },
          to: { x: data.x, y: data.y },
          completedAt: Date.now(),
          gmOnly: [token.visibility, token.map.visibility, token.character.visibility].includes('GM'),
        },
      };
      break;
    }
    case 'token.delete': {
      gm(member!);
      const token = await tx.mapToken.findFirst({ where: { id: str(p.id), map: { roomId } } });
      if (!token) bad(404, 'Token 不存在');
      await tx.mapToken.delete({ where: { id: token!.id } });
      data = { id: token!.id };
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
