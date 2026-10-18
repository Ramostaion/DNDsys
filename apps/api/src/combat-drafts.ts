import type express from 'express';
import type { CombatDraft, Prisma, PrismaClient, Room, RoomMember } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  canControlCharacter,
  characterAttribute,
  contestAttributes,
  type AgilityContest,
  type CombatDraftView,
} from '@dnd/shared';
import { characterDerived } from './character-values.js';
import { adjudicateAgility } from './agility-service.js';
import { rulesOf, object } from './data.js';
import { json, requestId, sheetFields } from './operations/helpers.js';
import { asyncRoute, fail } from './http.js';

type Tx = Prisma.TransactionClient;
const leaseMs = 90_000;
const inputSchema = z.object({
  revision: z.number().int().min(1).max(2147483647),
  actorId: z.string().nullish(),
  targetId: z.string().nullish(),
  privateRecord: z.boolean().default(false),
  actorAttribute: z.enum(contestAttributes).default('敏捷'),
});
type DraftCharacter = Prisma.CharacterGetPayload<{
  include: {
    characterTags: { include: { definition: true } };
    equipment: { include: { entry: { include: { item: true } } } };
  };
}>;

/** Recalculate the same authoritative inputs used by adjudicateAgility, without rolling. */
export async function combatDraftInputs(
  tx: Tx,
  roomId: string,
  userId: string,
  actorId: string,
  targetId: string,
  privateRecord: boolean,
  lock = true,
  actorAttribute = '敏捷',
) {
  if (lock)
    await tx.$queryRaw`SELECT id FROM "Character" WHERE "roomId" = ${roomId} AND id IN (${actorId}, ${targetId}) ORDER BY id FOR UPDATE`;
  const member = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
  if (!member) return fail(403, '你不是该房间成员');
  if (privateRecord && member.role !== 'GM') fail(403, '私密记录仅 GM 可操作');
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  const characters = await tx.character.findMany({
    where: { roomId, id: { in: [actorId, targetId] } },
    include: {
      characterTags: { include: { definition: true } },
      equipment: { include: { entry: { include: { item: true } } } },
    },
  });
  return resolveInputs(room, member, characters, userId, actorId, targetId, privateRecord, actorAttribute);
}

function resolveInputs(
  room: Room,
  member: RoomMember,
  characters: DraftCharacter[],
  userId: string,
  actorId: string,
  targetId: string,
  privateRecord: boolean,
  actorAttribute: string,
  resolutions = new Map<string, ReturnType<typeof characterAttribute>>(),
) {
  if (privateRecord && member.role !== 'GM') fail(403, '私密记录仅 GM 可操作');
  const actor = characters.find((c) => c.id === actorId),
    target = characters.find((c) => c.id === targetId);
  if (!actor || !target) return fail(404, '对抗角色不存在');
  if (!canControlCharacter(member, actor, userId) || (member.role !== 'GM' && target.visibility === 'GM'))
    fail(403, '没有操作该对抗的权限');
  const fields = sheetFields(room.sheetSchema),
    rules = rulesOf(room.rules);
  const resolution = (c: DraftCharacter, name: string) => {
    const key = `${c.id}:${name}`;
    if (!resolutions.has(key))
      resolutions.set(
        key,
        characterAttribute(
          { ...c, derived: characterDerived(c, rules, fields, room.sheetMode) },
          fields,
          room.sheetMode,
          name,
        ),
      );
    return resolutions.get(key)!;
  };
  const sides = [actor, target].map((c, index) => ({
    id: c.id,
    name: c.name,
    avatarUrl: c.avatarUrl,
    ownerId: c.ownerId,
    visibility: c.visibility,
    isNpc: c.isNpc,
    resolution: resolution(c, index === 0 ? actorAttribute : '敏捷'),
  }));
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        sides,
        privateRecord,
        actorAttribute,
        isGM: member.role === 'GM',
        rules,
        sheetMode: room.sheetMode,
      }),
    )
    .digest('hex');
  return { fingerprint, sides, isGM: member.role === 'GM' };
}

function view(draft: CombatDraft): CombatDraftView {
  const adjudication = object(draft.adjudication),
    contest = adjudication.contest as AgilityContest | undefined;
  const side = (value: AgilityContest['attacker']) => ({
    id: value.id,
    name: value.name,
    avatarUrl: (value as any).avatarUrl,
    d20: value.d20,
    bonus: value.bonus,
    total: value.total,
    attributeName: value.attributeName || '敏捷',
  });
  return {
    id: draft.id,
    revision: draft.revision,
    eventId: draft.eventId,
    state: draft.state,
    expiresAt: draft.expiresAt.toISOString(),
    serverNow: Date.now(),
    ...(typeof adjudication.skippedReason === 'string' ? { skippedReason: adjudication.skippedReason } : {}),
    ...(draft.state === 'ACTIVE' && contest
      ? { contest: { attacker: side(contest.attacker), defender: side(contest.defender), hit: contest.hit } }
      : {}),
  };
}

/** Saving consumes this exact result. Invalid/expired drafts fail closed and never roll a replacement here. */
export async function consumeCombatDraft(
  tx: Tx,
  args: {
    id: string;
    revision: unknown;
    eventId: unknown;
    roomId: string;
    userId: string;
    actorId?: string;
    targetId?: string;
    privateRecord: boolean;
    operationId: string;
    actorAttribute?: string;
  },
) {
  const draft = await tx.combatDraft.findUnique({ where: { id: requestId(args.id) } });
  if (!draft || draft.roomId !== args.roomId || draft.userId !== args.userId)
    return fail(403, '临时判定不属于当前草稿');
  if (
    draft.state !== 'ACTIVE' ||
    draft.expiresAt.getTime() <= Date.now() ||
    draft.revision !== args.revision ||
    draft.eventId !== args.eventId ||
    draft.actorId !== args.actorId ||
    draft.targetId !== args.targetId ||
    draft.privateRecord !== args.privateRecord ||
    (object(draft.adjudication).actorAttribute || '敏捷') !== (args.actorAttribute || '敏捷')
  )
    fail(409, '临时判定已变化或结束，请等待最新判定后再次保存');
  const current = await combatDraftInputs(
    tx,
    args.roomId,
    args.userId,
    args.actorId!,
    args.targetId!,
    args.privateRecord,
    true,
    args.actorAttribute,
  );
  if (current.fingerprint !== draft.fingerprint) fail(409, '双方属性或权限已变化，请等待最新判定后再次保存');
  const adjudication = structuredClone(object(draft.adjudication));
  if (adjudication.contest) adjudication.contest.operationId = args.operationId;
  return adjudication;
}

export function registerCombatDrafts(
  app: express.Express,
  db: PrismaClient,
  auth: express.RequestHandler,
  changed: (roomId: string) => void,
) {
  const base = '/api/rooms/:roomId/combat-drafts';
  app.get(
    base,
    auth,
    asyncRoute(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      // A viewing client must never reserve the single PGlite connection in an interactive transaction.
      const member = await db.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!member) return fail(403, '你不是该房间成员');
      const drafts = await db.combatDraft.findMany({
        where: { roomId, state: 'ACTIVE', expiresAt: { gt: new Date() } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      });
      const views: CombatDraftView[] = [];
      if (drafts.length) {
        const [room, owners, characters] = await Promise.all([
          db.room.findUniqueOrThrow({ where: { id: roomId } }),
          db.roomMember.findMany({ where: { roomId, userId: { in: [...new Set(drafts.map((d) => d.userId))] } } }),
          db.character.findMany({
            where: {
              roomId,
              id: {
                in: [
                  ...new Set(drafts.flatMap((d) => [d.actorId, d.targetId]).filter((id): id is string => Boolean(id))),
                ],
              },
            },
            include: {
              characterTags: { include: { definition: true } },
              equipment: { include: { entry: { include: { item: true } } } },
            },
          }),
        ]);
        const resolutions = new Map<string, ReturnType<typeof characterAttribute>>();
        for (const draft of drafts) {
          try {
            const owner = owners.find((m) => m.userId === draft.userId);
            if (!owner) continue;
            const current = resolveInputs(
              room,
              owner,
              characters,
              draft.userId,
              draft.actorId!,
              draft.targetId!,
              draft.privateRecord,
              object(draft.adjudication).actorAttribute || '敏捷',
              resolutions,
            );
            if (current.fingerprint !== draft.fingerprint) continue;
            const contest = object(draft.adjudication).contest as AgilityContest | undefined;
            if ((draft.privateRecord || contest?.broadcast.scope === 'GM') && member.role !== 'GM') continue;
            if (contest) views.push(view(draft));
          } catch (error) {
            if (![403, 404].includes((error as any).status)) throw error;
          }
        }
      }
      res.json({ drafts: views, serverNow: Date.now() });
    }),
  );
  app.put(
    base + '/:draftId',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        id = requestId(req.params.draftId),
        input = inputSchema.parse(req.body);
      const result = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          const member = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
          if (!member) return fail(403, '你不是该房间成员');
          const old = await tx.combatDraft.findUnique({ where: { id } });
          if (old && (old.roomId !== roomId || old.userId !== userId)) fail(403, '无权修改此草稿');
          if (old && (['CLOSED', 'SAVED'].includes(old.state) || input.revision < old.revision))
            fail(409, '草稿已结束或请求已过期');
          if (old?.state === 'ACTIVE' && old.expiresAt.getTime() <= Date.now() && input.revision === old.revision)
            fail(409, '临时判定已过期，请重新选择目标或重试判定');
          if (
            old &&
            input.revision === old.revision &&
            (old.actorId !== (input.actorId || null) ||
              old.targetId !== (input.targetId || null) ||
              old.privateRecord !== input.privateRecord ||
              (object(old.adjudication).actorAttribute || '敏捷') !== input.actorAttribute)
          )
            fail(409, '草稿版本冲突');
          const active = Boolean(input.actorId && input.targetId && input.actorId !== input.targetId);
          const current = active
            ? await combatDraftInputs(
                tx,
                roomId,
                userId,
                input.actorId!,
                input.targetId!,
                input.privateRecord,
                true,
                input.actorAttribute,
              )
            : null;
          const reusable =
            old?.state === 'ACTIVE' && old.expiresAt.getTime() > Date.now() && current?.fingerprint === old.fingerprint;
          let adjudication: unknown = reusable ? old!.adjudication : {};
          const eventId = reusable ? old!.eventId : randomUUID();
          if (current && !reusable) {
            const result = await adjudicateAgility(tx, {
              roomId,
              actorId: input.actorId!,
              targetId: input.targetId!,
              operationId: eventId,
              isGM: current.isGM,
              privateRecord: input.privateRecord,
              actorAttribute: input.actorAttribute,
            });
            if (result.contest) {
              Object.assign(result.contest.attacker, { avatarUrl: current.sides[0].avatarUrl });
              Object.assign(result.contest.defender, { avatarUrl: current.sides[1].avatarUrl });
            }
            adjudication = json({ ...result, actorAttribute: input.actorAttribute });
          }
          const data = {
            roomId,
            userId,
            revision: input.revision,
            eventId,
            actorId: input.actorId || null,
            targetId: input.targetId || null,
            privateRecord: input.privateRecord,
            fingerprint: current?.fingerprint || '',
            adjudication: json(adjudication),
            state: active ? 'ACTIVE' : 'CANCELED',
            expiresAt: new Date(Date.now() + leaseMs),
          };
          // Separate create from update: a cross-room ID collision must never rebind another owner's draft.
          const saved = old
            ? await tx.combatDraft.update({ where: { id }, data })
            : await tx.combatDraft.create({ data: { id, ...data } });
          return { saved, notify: !reusable || old?.revision !== input.revision };
        },
        { isolationLevel: 'ReadCommitted', maxWait: 15000, timeout: 10000 },
      );
      if (result.notify) {
        try {
          changed(roomId);
        } catch {
          /* The filtered read and lease recover missed notifications. */
        }
      }
      res.json(view(result.saved));
    }),
  );
  app.delete(
    base + '/:draftId',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        id = requestId(req.params.draftId);
      await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          if (!(await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } })))
            fail(403, '你不是该房间成员');
          const old = await tx.combatDraft.findUnique({ where: { id } });
          if (old && (old.roomId !== roomId || old.userId !== userId)) fail(403, '无权关闭此草稿');
          if (old?.state === 'SAVED') return;
          const data = { state: 'CLOSED', adjudication: json({}), expiresAt: new Date() };
          if (old) await tx.combatDraft.update({ where: { id }, data });
          else
            await tx.combatDraft.create({
              data: { id, roomId, userId, revision: 2147483647, eventId: randomUUID(), ...data },
            });
        },
        { isolationLevel: 'ReadCommitted', maxWait: 15000, timeout: 10000 },
      );
      try {
        changed(roomId);
      } catch {
        /* Expiration also removes abandoned performances. */
      }
      res.json({ ok: true });
    }),
  );
}
