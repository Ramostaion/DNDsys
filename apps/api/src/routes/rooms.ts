import type express from 'express';
import { randomBytes } from 'node:crypto';
import type { Prisma as PrismaType } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_RULES, DEFAULT_EQUIPMENT_SLOTS, withBackpackSlot, withShieldFields } from '@dnd/shared';
import { object, rulesOf } from '../data.js';
import { refreshCharacter } from '../character-values.js';
import { snapshot } from '../snapshot.js';
import { asyncRoute, fail } from '../http.js';
import { requireGM } from '../access.js';
import type { RouteContext } from './context.js';
import { deleteOwnedRoom, removeRoomUploads } from '../room-lifecycle.js';
import { roomProfileInput } from '../room-member-profile.js';

const ruleSchema = z.object({
  minimumPlayers: z.number().int().min(1).max(8),
  maximumPlayers: z.number().int().min(3).max(8),
  gmCountsAsPlayer: z.boolean(),
  retainExcessXp: z.boolean(),
  abilityRanges: z
    .array(z.object({ min: z.number().int().min(0), max: z.number().int().min(0), bonus: z.number().int() }))
    .min(1),
  aboveTwentyStart: z.number().int().min(21),
  aboveTwentyBase: z.number().int(),
  aboveTwentyStep: z.number().int().min(1),
  drawingShared: z.boolean(),
  rulerShared: z.boolean(),
  coneAngle: z.number().min(1).max(359),
  attackHitsOnEqual: z.boolean(),
  minimumDamage: z.number().int().min(0).max(100),
});

export function registerRoomRoutes(
  app: express.Express,
  context: RouteContext,
  kick: (roomId: string, userId: string) => Promise<void>,
  roomDeleted: (roomId: string) => void,
) {
  const { db, auth, member, emit } = context;
  app.get(
    '/api/rooms',
    auth,
    asyncRoute(async (req, res) => {
      const rooms = await db.room.findMany({
        where: { members: { some: { userId: req.user!.id } } },
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rooms.map((room) => ({ ...room, initiativePresetId: undefined })));
    }),
  );
  app.post(
    '/api/rooms',
    auth,
    asyncRoute(async (req, res) => {
      const input = z
        .object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).default('') })
        .parse(req.body);
      const room = await db.room.create({
        data: {
          name: input.name,
          description: input.description,
          ownerId: req.user!.id,
          inviteCode: randomBytes(4).toString('hex').toUpperCase(),
          rules: DEFAULT_RULES as unknown as PrismaType.InputJsonValue,
          sheetMode: true,
          sheetSchema: withShieldFields([]) as PrismaType.InputJsonValue,
          equipmentSlots: DEFAULT_EQUIPMENT_SLOTS as PrismaType.InputJsonValue,
          members: { create: { userId: req.user!.id, role: 'GM' } },
        },
      });
      res.status(201).json(room);
    }),
  );
  app.post(
    '/api/rooms/join',
    auth,
    asyncRoute(async (req, res) => {
      const code = z.object({ inviteCode: z.string().trim() }).parse(req.body).inviteCode.toUpperCase();
      const room = await db.room.findUnique({ where: { inviteCode: code } });
      if (!room) fail(404, '邀请码无效');
      const rules = rulesOf(room!.rules);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${room!.id} FOR UPDATE`;
        const existing = await tx.roomMember.findUnique({
          where: { roomId_userId: { roomId: room!.id, userId: req.user!.id } },
        });
        if (existing) return;
        const count = await tx.roomMember.count({ where: { roomId: room!.id, role: 'PLAYER' } });
        if (count >= rules.maximumPlayers) fail(409, '房间玩家已满');
        await tx.roomMember.create({ data: { roomId: room!.id, userId: req.user!.id, role: 'PLAYER' } });
      });
      emit(room!.id, 'member.joined', { userId: req.user!.id });
      res.json({ ...room, initiativePresetId: undefined });
    }),
  );
  app.delete(
    '/api/rooms/:roomId',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId);
      await deleteOwnedRoom(db, roomId, req.user!.id);
      roomDeleted(roomId);
      let warning: string | undefined;
      try {
        await removeRoomUploads(roomId);
      } catch (error) {
        console.error('Room deleted, but upload cleanup failed:', roomId, error);
        warning = '房间已删除，但部分图片未能清理，请检查上传目录权限。';
      }
      res.json({ ok: true, warning });
    }),
  );
  app.get(
    '/api/rooms/:roomId/snapshot',
    auth,
    asyncRoute(async (req, res) => {
      const m = await member(String(req.params.roomId), req.user!.id);
      res.json(await snapshot(db, String(req.params.roomId), req.user!.id, m.role === 'GM'));
    }),
  );
  app.post(
    '/api/rooms/:roomId/members/me/profile',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      await member(roomId, userId);
      const { displayName } = roomProfileInput.parse(req.body);
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.roomMember.update({
          where: { roomId_userId: { roomId, userId } },
          data: { displayName: displayName || null },
          select: { userId: true, displayName: true },
        });
        await tx.activityLog.create({ data: { roomId, userId, action: 'member.profile', data: {} } });
        return updated;
      });
      emit(roomId, 'member.profile', { userId });
      res.json(result);
    }),
  );
  app.post(
    '/api/rooms/:roomId/leave',
    auth,
    asyncRoute(async (req, res) => {
      const room = await db.room.findUniqueOrThrow({ where: { id: String(req.params.roomId) } });
      if (room.ownerId === req.user!.id) fail(409, '房主不能退出房间');
      await member(room.id, req.user!.id);
      await db.roomMember.delete({ where: { roomId_userId: { roomId: room.id, userId: req.user!.id } } });
      emit(room.id, 'member.left', { userId: req.user!.id });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/rooms/:roomId/kick',
    auth,
    asyncRoute(async (req, res) => {
      const m = await member(String(req.params.roomId), req.user!.id);
      requireGM(m);
      const { userId } = z.object({ userId: z.string() }).parse(req.body);
      if (userId === req.user!.id) fail(409, '不能踢出自己');
      await db.roomMember.delete({ where: { roomId_userId: { roomId: String(req.params.roomId), userId } } });
      await kick(String(req.params.roomId), userId);
      emit(String(req.params.roomId), 'member.kicked', { userId });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/rooms/:roomId/start',
    auth,
    asyncRoute(async (req, res) => {
      const m = await member(String(req.params.roomId), req.user!.id);
      requireGM(m);
      const room = await db.room.findUniqueOrThrow({ where: { id: String(req.params.roomId) } });
      const rules = rulesOf(room.rules);
      const players = await db.roomMember.count({
        where: { roomId: room.id, ...(rules.gmCountsAsPlayer ? {} : { role: 'PLAYER' }) },
      });
      if (players < rules.minimumPlayers) fail(409, `正式开始需要至少 ${rules.minimumPlayers} 名玩家`);
      const updated = await db.room.update({
        where: { id: room.id },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      emit(room.id, 'room.updated', updated);
      res.json(updated);
    }),
  );
  app.post(
    '/api/rooms/:roomId/rules',
    auth,
    asyncRoute(async (req, res) => {
      const m = await member(String(req.params.roomId), req.user!.id);
      requireGM(m);
      const rules = ruleSchema.parse(rulesOf(req.body));
      if (rules.minimumPlayers > rules.maximumPlayers) fail(400, '人数配置无效');
      for (let value = 0; value <= 20; value++)
        if (rules.abilityRanges.filter((r) => value >= r.min && value <= r.max).length !== 1)
          fail(400, `属性值 ${value} 必须恰好有一条加值规则`);
      const updated = await db.room.update({
        where: { id: String(req.params.roomId) },
        data: { rules: rules as unknown as PrismaType.InputJsonValue, version: { increment: 1 } },
      });
      const chars = await db.character.findMany({ where: { roomId: updated.id } });
      await db.$transaction(async (tx) => {
        for (const c of chars) await refreshCharacter(tx, c.id, rules);
      });
      emit(updated.id, 'room.updated', updated);
      res.json(updated);
    }),
  );
  app.post(
    '/api/rooms/:roomId/permission-mode',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await member(roomId, req.user!.id);
      requireGM(m);
      const input = z
        .object({
          version: z.number().int(),
          mode: z.enum(['FREE', 'MIXED', 'CONTROLLED']),
          settings: z
            .object({
              characterBasics: z.boolean().optional(),
              inventoryAdd: z.boolean().optional(),
              characterValues: z.boolean().optional(),
              experience: z.boolean().optional(),
              templateInstall: z.boolean().optional(),
              publicItems: z.boolean().optional(),
              trade: z.boolean().optional(),
              viewOtherInventories: z.boolean().optional(),
            })
            .default({}),
        })
        .parse(req.body);
      const changed = await db.room.updateMany({
        where: { id: roomId, version: input.version },
        data: {
          permissionMode: input.mode,
          permissionSettings: input.settings as PrismaType.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (!changed.count) fail(409, '房间设置已被修改，请刷新');
      const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
      emit(roomId, 'room.permissions.updated', { roomId, version: room.version });
      res.json(room);
    }),
  );
  app.post(
    '/api/rooms/:roomId/equipment-slots',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await member(roomId, req.user!.id);
      requireGM(m);
      const input = z
        .object({ version: z.number().int(), slots: z.array(z.string().trim().min(1).max(40)).min(1).max(30) })
        .parse(req.body);
      input.slots = withBackpackSlot(input.slots);
      if (new Set(input.slots).size !== input.slots.length) fail(400, '装备部位不能重复');
      const occupied = await db.equippedItem.findMany({
        where: { character: { roomId } },
        select: { slot: true },
        distinct: ['slot'],
      });
      const removed = occupied.map((item) => item.slot).filter((slot) => !input.slots.includes(slot));
      if (removed.length) fail(409, `请先卸下这些部位的装备：${removed.join('、')}`);
      const changed = await db.room.updateMany({
        where: { id: roomId, version: input.version },
        data: { equipmentSlots: input.slots as PrismaType.InputJsonValue, version: { increment: 1 } },
      });
      if (!changed.count) fail(409, '装备部位设置已被修改，请刷新');
      const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
      emit(roomId, 'room.equipmentSlots.updated', { roomId, version: room.version });
      res.json(room);
    }),
  );
  app.post(
    '/api/rooms/:roomId/members/:userId/permissions',
    auth,
    asyncRoute(async (req, res) => {
      const m = await member(String(req.params.roomId), req.user!.id);
      requireGM(m);
      const updated = await db.roomMember.update({
        where: { roomId_userId: { roomId: String(req.params.roomId), userId: String(req.params.userId) } },
        data: { permissions: object(req.body) as PrismaType.InputJsonValue },
      });
      emit(String(req.params.roomId), 'member.updated', updated);
      res.json(updated);
    }),
  );
}
