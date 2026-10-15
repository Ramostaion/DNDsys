import { rulerPixels, rulerAuthorColors } from '@dnd/shared';
import { array, object } from '../data.js';
import { fail as bad } from '../http.js';
import { json, str, num, required, mapIn } from './helpers.js';
import type { OperationContext } from './context.js';
import { z } from 'zod';
import { recordDrawingEdit, replayDrawingEdit } from './drawing-history.js';

export async function drawingOperation(context: OperationContext) {
  const { tx, member, rules, roomId, userId, p } = context;
  let data: any;
  switch (context.type) {
    case 'drawing.history.undo':
    case 'drawing.history.redo': {
      const map = await mapIn(tx, roomId, required(p.mapId, '地图 ID'));
      if (map.visibility === 'GM' && member.role !== 'GM') bad(403, '私密地图仅 GM 可操作');
      if (member.role !== 'GM' && object(member.permissions).draw !== true) bad(403, '没有绘画权限');
      data = await replayDrawingEdit(
        tx,
        { roomId, mapId: map.id, userId },
        context.type.endsWith('.undo') ? 'undo' : 'redo',
      );
      break;
    }
    case 'drawing.erase': {
      const map = await mapIn(tx, roomId, required(p.mapId, '地图 ID'));
      if (map.visibility === 'GM' && member.role !== 'GM') bad(403, '私密地图仅 GM 可操作');
      if (member.role !== 'GM' && object(member.permissions).draw !== true) bad(403, '没有绘画权限');
      const ids = [...new Set(z.array(z.string().min(1).max(100)).min(1).max(2000).parse(p.ids))];
      const strokes = await tx.drawingOperation.findMany({
        where: { id: { in: ids }, roomId, mapId: map.id, kind: 'STROKE' },
      });
      if (strokes.length !== ids.length) bad(400, '只能擦除当前地图的完整笔画');
      await recordDrawingEdit(
        tx,
        { roomId, mapId: map.id, userId },
        strokes.filter((stroke) => !stroke.undone),
        true,
      );
      data = { mapId: map.id, ids };
      break;
    }
    case 'drawing.add': {
      const map = await mapIn(tx, roomId, required(p.mapId, '地图 ID'));
      const kind = required(p.kind, '绘画类型');
      if (map.visibility === 'GM' && member!.role !== 'GM') bad(403, '私密地图仅 GM 可操作');
      if (kind !== 'RULER' && member!.role !== 'GM' && object(member!.permissions).draw !== true)
        bad(403, '没有绘画权限');
      const drawingData = object(p.data);
      if (kind === 'RULER') {
        if (!['LINE', 'CIRCLE', 'SQUARE', 'CONE'].includes(str(drawingData.shape))) bad(400, '量尺形状无效');
        if (!Number.isFinite(num(drawingData.distance)) || num(drawingData.distance) <= 0) bad(400, '距离无效');
        if (!Number.isFinite(num(drawingData.x)) || !Number.isFinite(num(drawingData.y))) bad(400, '量尺坐标无效');
        drawingData.length = rulerPixels(num(drawingData.distance), map.scalePixels, map.scaleUnits);
        drawingData.angle = rules.coneAngle;
        const [members, drawings, author] = await Promise.all([
          tx.roomMember.findMany({ where: { roomId }, select: { userId: true, joinedAt: true } }),
          tx.drawingOperation.findMany({
            where: { roomId, kind: 'RULER' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          tx.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } }),
        ]);
        drawingData.color = rulerAuthorColors(members, drawings).get(userId);
        drawingData.authorName = author.username;
      } else if (['STROKE', 'ERASER'].includes(kind)) {
        const points = array(drawingData.points);
        if (
          points.length < 4 ||
          points.length > 5000 ||
          points.some((v) => typeof v !== 'number' || !Number.isFinite(v))
        )
          bad(400, '笔画路径无效');
        if (!Number.isFinite(num(drawingData.width)) || num(drawingData.width) < 0 || num(drawingData.width) > 100)
          bad(400, '笔刷大小需在 0–100 之间');
        if (!/^#[0-9a-fA-F]{6}$/.test(str(drawingData.color))) bad(400, '画笔颜色无效');
      } else bad(400, '绘画类型无效');
      data = await tx.drawingOperation.create({
        data: { roomId, mapId: map.id, authorId: userId, kind, data: json(drawingData) },
      });
      if (kind !== 'RULER') {
        await recordDrawingEdit(tx, { roomId, mapId: map.id, userId }, [{ ...data, undone: true }], false);
        data = await tx.drawingOperation.findUniqueOrThrow({ where: { id: data.id } });
      }
      break;
    }
    case 'drawing.undo': {
      const drawing = await tx.drawingOperation.findFirst({ where: { id: str(p.id), roomId, undone: false } });
      if (!drawing) bad(404, '绘画不存在');
      if (member!.role !== 'GM' && drawing!.authorId !== userId) bad(403, '只能撤回自己的绘画');
      const map = await mapIn(tx, roomId, drawing!.mapId);
      if (map.visibility === 'GM' && member.role !== 'GM') bad(403, '私密地图仅 GM 可操作');
      if (drawing!.kind === 'RULER')
        data = await tx.drawingOperation.update({ where: { id: drawing!.id }, data: { undone: true } });
      else {
        if (member.role !== 'GM' && object(member.permissions).draw !== true) bad(403, '没有绘画权限');
        await recordDrawingEdit(tx, { roomId, mapId: map.id, userId }, [drawing!], true);
        data = await tx.drawingOperation.findUniqueOrThrow({ where: { id: drawing!.id } });
      }
      break;
    }
    case 'drawing.update': {
      const drawing = await tx.drawingOperation.findFirst({ where: { id: str(p.id), roomId, undone: false } });
      if (!drawing) bad(404, '图形不存在');
      if (drawing!.kind !== 'RULER') bad(400, '只能移动量尺图形');
      if (member!.role !== 'GM' && drawing!.authorId !== userId) bad(403, '没有修改权限');
      const patch: Record<string, number> = {};
      for (const field of ['x', 'y', 'rotation']) {
        if (p.patch?.[field] === undefined) continue;
        if (typeof p.patch[field] !== 'number' || !Number.isFinite(p.patch[field])) bad(400, '量尺坐标或角度无效');
        patch[field] = p.patch[field];
      }
      if (!Object.keys(patch).length) bad(400, '没有可更新的量尺位置或角度');
      data = await tx.drawingOperation.update({
        where: { id: drawing!.id },
        data: { data: json({ ...object(drawing!.data), ...patch }) },
      });
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
