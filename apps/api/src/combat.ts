import type { Prisma, RoomMember } from '@prisma/client';
import { canControlCharacter, compareCombatants, contestAttributes, type RuleConfig } from '@dnd/shared';
import { recordFreeRoll } from './dice-service.js';
import { adjudicateAgility } from './agility-service.js';
import { consumeCombatDraft } from './combat-drafts.js';
import { array, object } from './data.js';
import { fail as bad } from './http.js';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const key = (value: unknown) => String(value ?? '').trim();
const positive = (value: unknown, name: string, max = 100000) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) bad(400, `${name}必须在 1–${max} 之间`);
  return number;
};
const gm = (m: RoomMember) => {
  if (m.role !== 'GM') bad(403, '仅主持人可以管理战斗');
};
const control = (
  m: RoomMember,
  character: { ownerId: string | null; visibility: string; isNpc: boolean },
  userId: string,
) => {
  if (!canControlCharacter(m, character, userId)) bad(403, '没有操作该角色的权限');
};
const derived = (c: { derived: unknown }) => object(object(c.derived).values);
async function character(tx: Tx, roomId: string, id: string) {
  const c = await tx.character.findFirst({ where: { id, roomId } });
  if (!c) bad(404, '角色不存在');
  return c!;
}
async function active(tx: Tx, roomId: string) {
  const encounter = await tx.combatEncounter.findFirst({
    where: { roomId, status: 'ACTIVE' },
    include: { combatants: { include: { character: true } } },
  });
  if (!encounter) bad(409, '当前没有进行中的战斗');
  return encounter!;
}
function ordered(encounter: Awaited<ReturnType<typeof active>>) {
  return [...encounter.combatants].sort(compareCombatants);
}
async function event(
  tx: Tx,
  roomId: string,
  userId: string,
  kind: string,
  data: unknown,
  encounterId?: string,
  actorId?: string,
  targetId?: string,
  visibility = 'PUBLIC',
) {
  return tx.combatEvent.create({
    data: { roomId, userId, kind, data: json(data), encounterId, actorId, targetId, visibility },
  });
}
export async function combatOperation(
  tx: Tx,
  args: {
    type: string;
    payload: Record<string, any>;
    roomId: string;
    userId: string;
    member: RoomMember;
    requestedAt: number;
    opId: string;
    rules: RuleConfig;
  },
) {
  const { type, payload: p, roomId, userId, member, rules } = args;
  switch (type) {
    case 'dice.roll': {
      const expression = key(p.expression),
        reason = key(p.reason).slice(0, 160),
        visibility = p.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
      let c;
      if (p.characterId) {
        c = await character(tx, roomId, key(p.characterId));
        control(member, c, userId);
      }
      if (c?.visibility === 'GM' && member.role !== 'GM') bad(403, '私密角色仅 GM 可操作');
      return recordFreeRoll(
        tx,
        { roomId, userId, member, requestedAt: args.requestedAt, characterId: c?.id, expression, reason, visibility },
        c,
      );
    }
    case 'combat.start': {
      gm(member);
      await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      if (await tx.combatEncounter.count({ where: { roomId, status: 'ACTIVE' } })) bad(409, '已有进行中的战斗');
      const ids = [...new Set(array(p.characterIds).map(key))];
      if (ids.length < 1 || ids.length > 32) bad(400, '战斗需要 1–32 名角色');
      const chars = await tx.character.findMany({ where: { roomId, id: { in: ids } } });
      if (chars.length !== ids.length) bad(400, '角色不属于此房间');
      const encounter = await tx.combatEncounter.create({ data: { roomId } });
      for (const [sortOrder, id] of ids.entries())
        await tx.combatant.create({ data: { encounterId: encounter.id, characterId: id, initiative: 0, sortOrder } });
      await event(
        tx,
        roomId,
        userId,
        'START',
        { participants: ids, note: key(p.note).slice(0, 500), mode: 'MANUAL' },
        encounter.id,
      );
      return tx.combatEncounter.findUniqueOrThrow({ where: { id: encounter.id }, include: { combatants: true } });
    }
    case 'combat.advance': {
      gm(member);
      const encounter = await active(tx, roomId);
      if (Number(p.version) !== encounter.version) bad(409, '战斗回合已更新，请刷新');
      const participants = ordered(encounter);
      if (!participants.length) bad(409, '战斗没有参与角色');
      const next = encounter.turnIndex + 1;
      const turnIndex = next >= participants.length ? 0 : next;
      const round = encounter.round + (next >= participants.length ? 1 : 0);
      const updated = await tx.combatEncounter.updateMany({
        where: { id: encounter.id, version: encounter.version },
        data: { turnIndex, round, version: { increment: 1 } },
      });
      if (!updated.count) bad(409, '战斗回合已更新');
      await event(
        tx,
        roomId,
        userId,
        'TURN',
        { round, turnIndex, characterId: participants[turnIndex].characterId },
        encounter.id,
      );
      return { round, turnIndex, characterId: participants[turnIndex].characterId };
    }
    case 'combat.initiative': {
      gm(member);
      return bad(410, '先攻已停用，请由 GM 指定行动角色和顺序');
    }
    case 'combat.focus':
    case 'combat.order':
    case 'combat.round': {
      gm(member);
      const encounter = await active(tx, roomId);
      if (p.version === undefined || Number(p.version) !== encounter.version) bad(409, '战斗状态已更新，请刷新');
      const participants = ordered(encounter);
      let turnIndex = encounter.turnIndex,
        round = encounter.round,
        kind = 'TURN';
      let payload: Record<string, unknown> = {};
      if (type === 'combat.focus') {
        turnIndex = participants.findIndex((entry) => entry.characterId === p.characterId);
        if (turnIndex < 0) bad(404, '角色不在战斗中');
        payload = { characterId: p.characterId, round, turnIndex, manual: true };
      } else if (type === 'combat.round') {
        round = positive(p.round, '轮次', 10000);
        payload = { round };
        kind = 'ROUND';
      } else {
        const ids = array(p.characterIds).map(key);
        if (
          ids.length !== participants.length ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !participants.some((entry) => entry.characterId === id))
        )
          bad(400, '行动顺序必须包含全部参与角色');
        const currentId = participants[turnIndex]?.characterId;
        turnIndex = Math.max(0, ids.indexOf(currentId));
        kind = 'ORDER';
        payload = { participants: ids };
      }
      const updated = await tx.combatEncounter.updateMany({
        where: { id: encounter.id, version: encounter.version },
        data: { turnIndex, round, version: { increment: 1 } },
      });
      if (!updated.count) bad(409, '战斗状态已更新，请刷新');
      if (type === 'combat.order')
        for (const [sortOrder, id] of array(p.characterIds).map(key).entries())
          await tx.combatant.update({
            where: { encounterId_characterId: { encounterId: encounter.id, characterId: id } },
            data: { sortOrder },
          });
      await event(tx, roomId, userId, kind, payload, encounter.id);
      return { round, turnIndex };
    }
    case 'combat.add': {
      gm(member);
      const encounter = await active(tx, roomId);
      const c = await character(tx, roomId, key(p.characterId));
      if (p.version !== undefined && Number(p.version) !== encounter.version) bad(409, '战斗状态已更新，请刷新');
      if (encounter.combatants.some((x) => x.characterId === c.id)) bad(409, '角色已在战斗中');
      const currentId = ordered(encounter)[encounter.turnIndex]?.characterId;
      const added = await tx.combatant.create({
        data: {
          encounterId: encounter.id,
          characterId: c.id,
          initiative: 0,
          sortOrder: Math.max(-1, ...encounter.combatants.map((entry) => entry.sortOrder)) + 1,
        },
      });
      const next = ordered({ ...encounter, combatants: [...encounter.combatants, { ...added, character: c }] });
      const currentIndex = next.findIndex((x) => x.characterId === currentId);
      const updated = await tx.combatEncounter.updateMany({
        where: { id: encounter.id, version: encounter.version },
        data: {
          turnIndex: currentIndex < 0 ? Math.max(0, Math.min(encounter.turnIndex, next.length - 1)) : currentIndex,
          version: { increment: 1 },
        },
      });
      if (!updated.count) bad(409, '战斗状态已更新，请刷新');
      await event(tx, roomId, userId, 'ADD', { characterId: c.id }, encounter.id);
      return added;
    }
    case 'combat.remove': {
      gm(member);
      const encounter = await active(tx, roomId);
      const target = encounter.combatants.find((x) => x.characterId === p.characterId);
      if (!target) bad(404, '角色不在战斗中');
      if (p.version !== undefined && Number(p.version) !== encounter.version) bad(409, '战斗状态已更新，请刷新');
      const currentId = ordered(encounter)[encounter.turnIndex]?.characterId;
      await tx.combatant.delete({ where: { id: target!.id } });
      const next = ordered({ ...encounter, combatants: encounter.combatants.filter((x) => x.id !== target!.id) });
      const currentIndex = next.findIndex((x) => x.characterId === currentId);
      const updated = await tx.combatEncounter.updateMany({
        where: { id: encounter.id, version: encounter.version },
        data: {
          turnIndex: currentIndex < 0 ? Math.max(0, Math.min(encounter.turnIndex, next.length - 1)) : currentIndex,
          version: { increment: 1 },
        },
      });
      if (!updated.count) bad(409, '战斗状态已更新，请刷新');
      await event(tx, roomId, userId, 'REMOVE', { characterId: target!.characterId }, encounter.id);
      return { characterId: target!.characterId };
    }
    case 'combat.end': {
      gm(member);
      const encounter = await active(tx, roomId);
      const ended = await tx.combatEncounter.update({
        where: { id: encounter.id },
        data: { status: 'ENDED', endedAt: new Date(), version: { increment: 1 } },
      });
      await event(tx, roomId, userId, 'END', {}, encounter.id);
      return ended;
    }
    case 'combat.record': {
      const kind = key(p.kind);
      if (!['DECLARATION', 'RESULT', 'RULING', 'NOTE', 'STATE', 'SCENE'].includes(kind)) bad(400, '战斗记录类型无效');
      if (['RULING', 'SCENE'].includes(kind)) gm(member);
      const actor = p.actorId ? await character(tx, roomId, key(p.actorId)) : null;
      const target = p.targetId ? await character(tx, roomId, key(p.targetId)) : null;
      const note =
        key(p.note) ||
        (kind === 'DECLARATION' && actor && target && actor.id !== target.id
          ? `${actor.name}向${target.name}发起攻击。`
          : '');
      if (!note || note.length > 2000) bad(400, '记录内容需在 1–2000 字之间');
      if (member.role !== 'GM' && (actor?.visibility === 'GM' || target?.visibility === 'GM'))
        bad(403, '私密角色仅 GM 可操作');
      if (actor) control(member, actor, userId);
      const visibility = p.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
      if (visibility === 'PRIVATE') gm(member);
      const encounter = await tx.combatEncounter.findFirst({ where: { roomId, status: 'ACTIVE' } });
      const actorAttribute = key(p.actorAttribute) || '敏捷';
      if (!(contestAttributes as readonly string[]).includes(actorAttribute)) bad(400, '判定属性无效');
      const adjudication =
        kind === 'DECLARATION' || p.draftId
          ? p.draftId
            ? await consumeCombatDraft(tx, {
                id: key(p.draftId),
                revision: p.draftRevision,
                eventId: p.draftEventId,
                roomId,
                userId,
                actorId: actor?.id,
                targetId: target?.id,
                privateRecord: visibility === 'PRIVATE',
                operationId: args.opId,
                actorAttribute,
              })
            : await adjudicateAgility(tx, {
                roomId,
                actorId: actor?.id,
                targetId: target?.id,
                operationId: args.opId,
                isGM: member.role === 'GM',
                privateRecord: visibility === 'PRIVATE',
                actorAttribute,
              })
          : {};
      const saved = await event(
        tx,
        roomId,
        userId,
        kind,
        { note, manual: true, ...adjudication },
        encounter?.id,
        actor?.id,
        target?.id,
        adjudication.contest?.broadcast.scope === 'GM' ? 'PRIVATE' : visibility,
      );
      if (p.draftId)
        await tx.combatDraft.update({
          where: { id: key(p.draftId) },
          data: { state: 'SAVED', recordId: saved.id, adjudication: json({}), fingerprint: '' },
        });
      return saved;
    }
    case 'combat.correct': {
      const original = await tx.combatEvent.findFirst({ where: { id: key(p.eventId), roomId } });
      if (!original) return bad(404, '原记录不存在');
      if (original.userId !== userId && member.role !== 'GM') bad(403, '只能更正自己的记录');
      if (original.visibility === 'PRIVATE' && member.role !== 'GM') bad(403, '私密记录仅 GM 可更正');
      const note = key(p.note);
      if (!note || note.length > 2000) bad(400, '更正内容需在 1–2000 字之间');
      return event(
        tx,
        roomId,
        userId,
        'CORRECTION',
        { note, correctsEventId: original.id, manual: true },
        original.encounterId || undefined,
        original.actorId || undefined,
        original.targetId || undefined,
        original.visibility,
      );
    }
    case 'combat.hp': {
      gm(member);
      const c = await character(tx, roomId, key(p.targetId));
      const amount = positive(p.amount, '血量变化');
      const kind = p.kind === 'HEAL' ? 'HEAL' : 'DAMAGE';
      const maxHp = Number(derived(c).血量上限) || 0;
      const next =
        kind === 'HEAL'
          ? Math.max(c.currentHp, Math.min(maxHp, c.currentHp + amount))
          : Math.max(0, c.currentHp - amount);
      const updated = await tx.character.update({
        where: { id: c.id },
        data: { currentHp: next, version: { increment: 1 } },
      });
      const encounter = await tx.combatEncounter.findFirst({ where: { roomId, status: 'ACTIVE' } });
      await event(
        tx,
        roomId,
        userId,
        kind,
        { amount, previousHp: c.currentHp, currentHp: next, note: key(p.note).slice(0, 200) },
        encounter?.id,
        undefined,
        c.id,
      );
      return updated;
    }
    case 'combat.attack': {
      return bad(410, '自动攻击结算已停用。请使用掷骰、战斗记录和手动数值调整。旧攻击记录仍可查看。');
    }
    default:
      bad(400, '未知战斗操作');
  }
}
