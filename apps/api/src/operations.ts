import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canViewCharacterInventory, characterIsIncapacitated, characterCurrentHealth } from '@dnd/shared';
import { rulesOf } from './data.js';
import { memberCan } from './permissions.js';
import { fail as bad } from './http.js';
import { unlink } from 'node:fs/promises';
import { arrangeInventory } from './inventory-layout.js';
import { json, str, requestId, editable } from './operations/helpers.js';
import { dispatchOperation } from './operations/dispatch.js';
import { visibleCombatRecord } from './combat-visibility.js';
export function registerOperations(
  app: express.Express,
  db: PrismaClient,
  auth: express.RequestHandler,
  emit: (roomId: string, event: string, data: unknown) => void,
  emitPrivate: (roomId: string, event: string, data: unknown, userId: string) => void,
) {
  app.post('/api/rooms/:roomId/operations', auth, async (req, res, next) => {
    const requestedAt = Date.now();
    const createdFiles: string[] = [];
    let committed = false;
    try {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      const input = z
        .object({ id: z.string(), type: z.string(), payload: z.record(z.string(), z.any()).default({}) })
        .parse(req.body);
      const opId = requestId(input.id),
        p = input.payload;
      const member = await db.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!member) bad(403, '你不是该房间成员');
      const room = await db.room.findUniqueOrThrow({ where: { id: roomId } }),
        rules = rulesOf(room.rules);
      const result = await db.$transaction(
        async (tx) => {
          // Dice and drawing history use the room row lock with READ COMMITTED:
          // concurrent requests see committed receipts and the latest edit state.
          if (['dice.roll', 'combat.record'].includes(input.type) || input.type.startsWith('drawing.'))
            await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          const previous = await tx.operationReceipt.findUnique({ where: { id: opId } });
          if (previous) {
            if (previous.userId !== userId || previous.roomId !== roomId) bad(409, '操作 ID 冲突');
            return { data: previous.result, duplicate: true };
          }
          let data: any;
          const inventoryCharacters = new Set<string>();
          const inventoryEditable = (character: {
            ownerId: string | null;
            visibility: string;
            isNpc: boolean;
            currentHp?: number;
            derived?: unknown;
          }) => {
            editable(member!, character, userId);
            const healthCurrent = characterCurrentHealth(room, character);
            if (
              member!.role !== 'GM' &&
              !character.isNpc &&
              characterIsIncapacitated({ ownerId: character.ownerId, healthCurrent })
            )
              bad(403, '生命归零后不能操作该角色的背包和装备');
            if (
              !canViewCharacterInventory(
                member!,
                { ...character, healthCurrent },
                userId,
                memberCan(room, member!, 'viewOtherInventories'),
              )
            )
              bad(403, '没有查看该角色物品的权限');
          };
          data = await dispatchOperation({
            tx,
            room,
            member: member!,
            rules,
            roomId,
            userId,
            type: input.type,
            opId,
            requestedAt,
            p,
            createdFiles,
            inventoryCharacters,
            inventoryEditable,
          });
          for (const characterId of inventoryCharacters) await arrangeInventory(tx, characterId);
          if (inventoryCharacters.size && data?.id && input.type.startsWith('inventory.') && !data.deleted)
            data = await tx.inventoryEntry.findUniqueOrThrow({ where: { id: data.id } });
          await tx.operationReceipt.create({ data: { id: opId, roomId, userId, result: json(data) } });
          if (!['character.field.set', 'character.field.adjust'].includes(input.type))
            await tx.activityLog.create({
              data: {
                roomId,
                userId,
                action: input.type,
                entityId: str(data?.id) || null,
                data: json({ operationId: opId }),
              },
            });
          return { data, duplicate: false };
        },
        {
          isolationLevel:
            ['dice.roll', 'combat.record'].includes(input.type) || input.type.startsWith('drawing.')
              ? 'ReadCommitted'
              : 'Serializable',
          timeout: 10000,
        },
      );
      committed = true;
      if (!result.duplicate) {
        const notice = { operationId: opId };
        if (input.type === 'combat.record' && result.data?.data?.contest) {
          const contest = result.data.data.contest;
          const payload = {
            ...notice,
            roomId,
            recordId: result.data.id,
            version: contest.version,
            createdAt: result.data.createdAt,
            serverNow: Date.now(),
            message: contest.message,
            hit: contest.hit,
            attacker: {
              name: contest.attacker.name,
              d20: contest.attacker.d20,
              effective: contest.attacker.effective,
              bonus: contest.attacker.bonus,
              total: contest.attacker.total,
            },
            defender: {
              name: contest.defender.name,
              d20: contest.defender.d20,
              effective: contest.defender.effective,
              bonus: contest.defender.bonus,
              total: contest.defender.total,
            },
          };
          try {
            if (result.data.visibility === 'PRIVATE') emitPrivate(roomId, input.type, payload, userId);
            else emit(roomId, input.type, payload);
            contest.broadcast = { ...contest.broadcast, status: 'SENT', sentAt: new Date().toISOString() };
          } catch {
            contest.broadcast = { ...contest.broadcast, status: 'FAILED' };
          }
          // An emission or status-write failure must never turn a committed record into an HTTP error.
          await db
            .$transaction([
              db.combatEvent.update({ where: { id: result.data.id }, data: { data: json(result.data.data) } }),
              db.operationReceipt.update({ where: { id: opId }, data: { result: json(result.data) } }),
            ])
            .catch(() => {});
        } else if (input.type === 'token.move' && result.data?.movement) {
          const { gmOnly, ...movement } = result.data.movement;
          // Same visibility gates as snapshot tokens: never send private coordinates room-wide.
          // A failed presentation must not make an already committed move look unsuccessful.
          try {
            const payload = { ...movement, serverNow: Date.now() };
            if (gmOnly) emitPrivate(roomId, 'token.moved', payload, userId);
            else emit(roomId, 'token.moved', payload);
          } catch {
            /* The next snapshot still recovers the committed position. */
          }
        } else if (input.type.startsWith('tagDefinition.') || input.type.startsWith('characterTag.'))
          emit(roomId, 'tags.changed', { roomId });
        else if (
          ['dice.roll', 'combat.record', 'combat.correct'].includes(input.type) &&
          result.data?.visibility === 'PRIVATE'
        )
          emitPrivate(roomId, input.type, notice, userId);
        else if (input.type === 'dice.roll')
          emit(roomId, input.type, {
            ...notice,
            roomId,
            roll: result.data,
            cooldownUntil: result.data.cooldownUntil,
            serverNow: Date.now(),
          });
        else emit(roomId, input.type, notice);
      }
      let response = result.data;
      if (input.type === 'combat.record' && member!.role !== 'GM' && response?.data?.contest) {
        const ids = [response.data.contest.attacker.id, response.data.contest.defender.id];
        const characters = await db.character.findMany({ where: { roomId, id: { in: ids } } });
        response = visibleCombatRecord(response, (id) => {
          const c = characters.find((candidate) => candidate.id === id);
          return (
            !!c &&
            canViewCharacterInventory(
              member!,
              { ...c, healthCurrent: characterCurrentHealth(room, c) },
              userId,
              memberCan(room, member!, 'viewOtherInventories'),
            )
          );
        });
      }
      res.json(
        input.type === 'dice.roll' && result.data?.visibility === 'PUBLIC'
          ? { ...result.data, serverNow: Date.now() }
          : response,
      );
    } catch (e) {
      if (!committed) await Promise.all(createdFiles.map((file) => unlink(file).catch(() => {})));
      next(e);
    }
  });
}
