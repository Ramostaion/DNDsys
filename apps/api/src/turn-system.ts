import { z } from 'zod';
import type { Prisma, TurnSession } from '@prisma/client';
import {
  calculateInitiative,
  initiativeFields,
  initiativeWeightErrors,
  nextTurn,
  rebuildNextRound,
  recalculateTurn,
  sortInitiativeOrder,
  insertTurnParticipant,
  findNextUnactedActor,
  canControlCharacter,
  canViewCharacterTag,
  type InitiativeWeight,
  type TurnParticipant,
  type TurnSessionView,
  type SheetField,
} from '@dnd/shared';
import type { OperationContext } from './operations/context.js';
import { gm, json, version } from './operations/helpers.js';
import { array, object, rulesOf } from './data.js';
import { fail } from './http.js';
import { characterDerived } from './character-values.js';
import { removeCharacterStates } from './character-tags.js';

type Tx = Prisma.TransactionClient;
const expected = z.number().int().min(0),
  id = z.string().min(1).max(100);
const weightInput = z
  .array(
    z.object({
      fieldId: id,
      weight: z.number().finite().min(0).max(100),
      min: z.number().finite().min(-1e12).max(1e12),
      max: z.number().finite().min(-1e12).max(1e12),
      missing: z.enum(['BLOCK', 'ZERO', 'FIXED']).default('BLOCK'),
      fallback: z.number().finite().min(-1e12).max(1e12).optional(),
    }),
  )
  .min(1)
  .max(50);
const totalInput = z.number().int().positive().max(1000000).nullable();
const participantsOf = (session: { participants: unknown }) => array(session.participants) as TurnParticipant[];

async function weightsIn(tx: Tx, room: any, input: unknown) {
  const weights = weightInput.parse(input),
    errors = initiativeWeightErrors(weights);
  if (errors.length) fail(400, errors.join('；'));
  const characters = room.sheetMode
    ? []
    : await tx.character.findMany({
        where: { roomId: room.id },
        select: { attributes: true, formulas: true, derived: true },
      });
  const fields = initiativeFields(room, characters);
  for (const w of weights) if (!fields.some((f) => f.fieldId === w.fieldId)) fail(400, `数值属性不存在：${w.fieldId}`);
  return weights;
}

async function scoreTokens(tx: Tx, room: any, mapId: string, tokenIds: string[], round: number) {
  const tokens = await tx.mapToken.findMany({ where: { id: { in: tokenIds }, mapId, map: { roomId: room.id } } });
  if (tokens.length !== tokenIds.length) fail(400, '请选择当前地图中真实存在的Token');
  if (new Set(tokens.map((t) => t.characterId)).size !== tokens.length)
    fail(400, '同一人物卡只能选择一个代表Token；独立NPC请使用独立人物卡');
  const characters = await tx.character.findMany({
    where: { roomId: room.id, id: { in: tokens.map((t) => t.characterId) } },
    include: {
      equipment: { include: { entry: { include: { item: true } } } },
      characterTags: { include: { definition: true } },
    },
  });
  if (characters.length !== tokens.length) fail(409, '参战人物已变化，请重新选择');
  const preset = room.initiativePresetId
    ? await tx.initiativePreset.findFirst({ where: { id: room.initiativePresetId, roomId: room.id } })
    : null;
  const all = room.sheetMode
    ? characters
    : await tx.character.findMany({
        where: { roomId: room.id },
        select: { attributes: true, formulas: true, derived: true },
      });
  const fields = initiativeFields(room, all),
    rules = rulesOf(room.rules);
  return sortInitiativeOrder(
    tokens.map((token) => {
      const c = characters.find((c) => c.id === token.characterId)!;
      const derived = characterDerived(c, rules, array(room.sheetSchema) as SheetField[], room.sheetMode);
      const calculation = calculateInitiative(
        room,
        { ...c, derived },
        preset?.weights as InitiativeWeight[] | undefined,
        fields,
      );
      if (!calculation.valid) fail(400, `${c.name}：${calculation.errors.join('；')}`);
      return {
        characterId: c.id,
        tokenId: token.id,
        score: calculation.score!,
        calculation,
        firstRound: round,
        lastActedRound: 0,
      };
    }),
  );
}

async function rebuildRound(
  tx: Tx,
  room: any,
  next: Omit<TurnSession, 'participants'> & { participants: TurnParticipant[] },
) {
  if (next.currentCharacterId || next.status === 'LIMIT' || next.status === 'ENDED' || !next.participants.length)
    return;
  if (!next.mapId) fail(409, '会话地图已被移除，请先移出失效人物或结束模式');
  const scored = await scoreTokens(
    tx,
    room,
    next.mapId!,
    next.participants.map((p) => p.tokenId),
    next.round + 1,
  );
  Object.assign(next, rebuildNextRound(next, scored));
}

export async function initiativeOperation(context: OperationContext) {
  const { tx, roomId, member, p, type } = context;
  gm(member);
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  if (type === 'initiative.character') {
    const c = await tx.character.findFirst({ where: { roomId, id: id.parse(p.characterId) } });
    if (!c) fail(404, '角色不存在');
    version(c!.version, expected.parse(p.version));
    const config = z
      .object({ weights: weightInput.optional(), bonus: z.number().finite().min(-1e6).max(1e6).default(0) })
      .parse(p.config);
    if (config.weights) config.weights = await weightsIn(tx, room, config.weights);
    return tx.character.update({
      where: { id: c!.id, version: c!.version },
      data: { initiativeConfig: json(config), version: { increment: 1 } },
    });
  }
  if (type === 'initiative.preset.save') {
    const name = z.string().trim().min(1).max(80).parse(p.name),
      weights = await weightsIn(tx, room, p.weights);
    if (p.id) {
      const preset = await tx.initiativePreset.findFirst({ where: { id: id.parse(p.id), roomId } });
      if (!preset) fail(404, '先手模板不存在');
      version(preset!.version, expected.parse(p.version));
      return tx.initiativePreset.update({
        where: { id: preset!.id, version: preset!.version },
        data: { name, weights: json(weights), version: { increment: 1 } },
      });
    }
    return tx.initiativePreset.create({ data: { roomId, name, weights: json(weights) } });
  }
  const preset = await tx.initiativePreset.findFirst({ where: { id: id.parse(p.id), roomId } });
  if (!preset) fail(404, '先手模板不存在');
  if (type === 'initiative.preset.select') {
    version(room.version, expected.parse(p.version));
    return tx.room.update({
      where: { id: roomId, version: room.version },
      data: { initiativePresetId: preset!.id, version: { increment: 1 } },
    });
  }
  if (type === 'initiative.preset.delete') {
    version(preset!.version, expected.parse(p.version));
    if (room.initiativePresetId === preset!.id)
      await tx.room.update({ where: { id: roomId }, data: { initiativePresetId: null, version: { increment: 1 } } });
    await tx.initiativePreset.delete({ where: { id: preset!.id, version: preset!.version } });
    return { id: preset!.id };
  }
  return fail(400, '未知先手操作');
}

export async function turnOperation(context: OperationContext) {
  const { tx, roomId, member, p, type, opId } = context;
  gm(member);
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  if (type === 'turn.start') {
    if (await tx.turnSession.count({ where: { roomId, status: { not: 'ENDED' } } }))
      fail(409, '房间已有回合会话，请先结束原会话');
    const map = await tx.map.findFirst({ where: { id: id.parse(p.mapId), roomId } });
    if (!map) fail(404, '地图不存在');
    const tokenIds = z.array(id).min(1).max(128).parse(p.tokenIds);
    if (new Set(tokenIds).size !== tokenIds.length) fail(400, 'Token不能重复');
    const participants = await scoreTokens(tx, room, map!.id, tokenIds, 1);
    return tx.turnSession.create({
      data: {
        roomId,
        mapId: map!.id,
        mapName: map!.name,
        totalRounds: totalInput.parse(p.totalRounds ?? null),
        currentCharacterId: participants[0].characterId,
        participants: json(participants),
      },
    });
  }
  const session = await tx.turnSession.findFirst({
    where: { id: id.parse(p.sessionId), roomId, status: { not: 'ENDED' } },
  });
  if (!session) fail(409, '回合会话已结束或不存在');
  version(session!.version, expected.parse(p.version));
  const participants = participantsOf(session!),
    beforeVersion = session!.version;
  const next = { ...session!, participants },
    transition: any = { operationId: opId, version: beforeVersion + 1, changed: [] };
  let advancedAt: Date | undefined;
  switch (type) {
    case 'turn.advance':
    case 'turn.skip': {
      if (session!.status !== 'ACTIVE' || !session!.currentCharacterId) fail(409, '请先继续回合或处理预计轮数上限');
      if (session!.lastAdvancedAt && Date.now() - session!.lastAdvancedAt.getTime() < 400)
        fail(409, '回合刚刚推进，请稍候再操作');
      const characterId = session!.currentCharacterId!;
      const actor = participants.find((row) => row.characterId === characterId);
      if (!actor || actor.firstRound > next.round || actor.lastActedRound >= next.round)
        fail(409, '当前人物已经行动或不属于本轮，请刷新回合');
      if (!(await tx.character.count({ where: { id: characterId, roomId } })))
        fail(409, '当前人物已被删除，请将其移出队列');
      transition.endedCharacterId = characterId;
      const states = await tx.characterTag.findMany({
        where: { roomId, characterId, remainingTurns: { gt: 0 } },
        include: { definition: true },
      });
      transition.changed = states.map((tag) => ({
        id: tag.id,
        characterId,
        visibility: tag.visibility,
        name: tag.definition.name,
        romanNumeral: tag.romanNumeral,
        icon: tag.definition.icon,
        color: tag.definition.color,
        before: tag.remainingTurns!,
        after: tag.remainingTurns! - 1,
      }));
      const continuing = states.filter((tag) => tag.remainingTurns! > 1),
        expiring = states.filter((tag) => tag.remainingTurns === 1);
      if (continuing.length)
        await tx.characterTag.updateMany({
          where: { roomId, characterId, id: { in: continuing.map((t) => t.id) } },
          data: { remainingTurns: { decrement: 1 }, version: { increment: 1 } },
        });
      if (states.length)
        await removeCharacterStates(
          tx,
          roomId,
          characterId,
          expiring.map((t) => t.id),
          rulesOf(room.rules),
        );
      Object.assign(next, nextTurn(next, characterId));
      await rebuildRound(tx, room, next);
      advancedAt = new Date();
      break;
    }
    case 'turn.pause':
      if (session!.status !== 'ACTIVE') fail(409, '只有进行中的会话可以暂停');
      next.status = 'PAUSED';
      break;
    case 'turn.resume':
      if (session!.status !== 'PAUSED') fail(409, '当前会话没有暂停');
      if (!participants.length) fail(409, '队列为空，请先添加人物');
      next.status = 'ACTIVE';
      next.currentCharacterId = next.currentCharacterId ?? findNextUnactedActor(next)?.characterId ?? null;
      if (!next.currentCharacterId) {
        Object.assign(next, nextTurn(next));
        await rebuildRound(tx, room, next);
      }
      break;
    case 'turn.end':
      next.status = 'ENDED';
      next.currentCharacterId = null;
      break;
    case 'turn.order': {
      const ids = z.array(id).parse(p.characterIds);
      if (
        ids.length !== participants.length ||
        new Set(ids).size !== ids.length ||
        ids.some((key) => !participants.some((r) => r.characterId === key))
      )
        fail(400, '排序必须包含全部参战人物且不能重复');
      next.participants = ids.map((key) => participants.find((r) => r.characterId === key)!);
      break;
    }
    case 'turn.focus': {
      if (session!.status === 'LIMIT') fail(409, '请先延长预计轮数');
      const chosen = participants.find((r) => r.characterId === p.characterId);
      if (!chosen || chosen.firstRound > session!.round || chosen.lastActedRound >= session!.round)
        fail(400, '只能切换至本轮尚未行动的人物');
      next.currentCharacterId = chosen!.characterId;
      break;
    }
    case 'turn.add': {
      if (session!.status === 'LIMIT' || !session!.mapId) fail(409, '请先处理轮数上限或已移除的地图');
      const rows = await scoreTokens(
        tx,
        room,
        session!.mapId!,
        [id.parse(p.tokenId)],
        session!.round + (p.nextRound === true ? 1 : 0),
      );
      if (participants.length >= 128 || participants.some((r) => r.characterId === rows[0].characterId))
        fail(409, '该人物已参战或队列已满');
      next.participants = insertTurnParticipant(participants, rows[0]);
      if (!next.currentCharacterId && rows[0].firstRound <= next.round)
        next.currentCharacterId = findNextUnactedActor(next)?.characterId ?? null;
      break;
    }
    case 'turn.remove': {
      const removed = id.parse(p.characterId);
      if (!participants.some((r) => r.characterId === removed)) fail(404, '参战人物不存在');
      next.participants = participants.filter((r) => r.characterId !== removed);
      if (session!.currentCharacterId === removed || !next.participants.length) {
        Object.assign(next, nextTurn(next));
        await rebuildRound(tx, room, next);
      }
      break;
    }
    case 'turn.recalculate': {
      if (!session!.mapId) fail(409, '会话地图已被移除');
      const scored = await scoreTokens(
        tx,
        room,
        session!.mapId!,
        participants.map((r) => r.tokenId),
        session!.round,
      );
      Object.assign(next, recalculateTurn(next, scored));
      break;
    }
    case 'turn.total': {
      const total = totalInput.parse(p.totalRounds ?? null);
      if (total !== null && total < session!.round) fail(400, '预计总轮数不能小于当前轮次');
      next.totalRounds = total;
      if (session!.status === 'LIMIT') {
        if (total !== null && total <= session!.round) fail(400, '请延长总轮数，或改为不限轮数');
        next.status = 'ACTIVE';
        next.currentCharacterId = null;
        await rebuildRound(tx, room, next);
      }
      break;
    }
    default:
      fail(400, '未知回合操作');
  }
  const changed = await tx.turnSession.updateMany({
    where: { id: session!.id, roomId, version: beforeVersion },
    data: {
      status: next.status,
      round: next.round,
      totalRounds: next.totalRounds,
      currentCharacterId: next.currentCharacterId,
      participants: json(next.participants),
      lastTransition: json(transition),
      ...(advancedAt ? { lastAdvancedAt: advancedAt } : {}),
      version: { increment: 1 },
    },
  });
  if (!changed.count) fail(409, '回合已被其他窗口更新，请刷新');
  return {
    id: session!.id,
    sessionId: session!.id,
    beforeVersion,
    afterVersion: beforeVersion + 1,
    round: next.round,
    currentCharacterId: next.currentCharacterId,
    status: next.status,
    transition,
  };
}

export async function visibleTurnSession(
  session: TurnSession | null,
  viewer: any,
  viewerId: string,
  characters: any[],
  maps: any[],
  tokens: any[],
  tags: any[],
): Promise<TurnSessionView | null> {
  if (!session) return null;
  const isGM = viewer?.role === 'GM';
  if (!isGM && (!session.mapId || !maps.some((m) => m.id === session.mapId))) return null;
  const visible = participantsOf(session).filter(
    (p) =>
      isGM ||
      (characters.some((c) => c.id === p.characterId) &&
        tokens.some((t) => t.id === p.tokenId && t.mapId === session.mapId)),
  );
  const allowed = new Set(visible.map((p) => p.characterId));
  const transition = object(session.lastTransition);
  const effects = array(transition.changed)
    .filter((effect) => {
      const c = characters.find((c) => c.id === effect.characterId);
      return (
        (effect.after === 0 || tags.some((t) => t.id === effect.id)) &&
        allowed.has(effect.characterId) &&
        canViewCharacterTag(effect.visibility, isGM, !!c && canControlCharacter(viewer, c, viewerId))
      );
    })
    .map(({ visibility: _visibility, ...row }) => row);
  return {
    id: session.id,
    mapId: session.mapId,
    mapName: maps.find((m) => m.id === session.mapId)?.name || session.mapName,
    status: session.status as TurnSessionView['status'],
    round: session.round,
    totalRounds: session.totalRounds,
    currentCharacterId: allowed.has(session.currentCharacterId || '') ? session.currentCharacterId : null,
    version: session.version,
    participants: visible.map((p) => {
      const c = characters.find((c) => c.id === p.characterId);
      return {
        characterId: p.characterId,
        tokenId: p.tokenId,
        name: c?.name || '已移除的人物',
        avatarUrl: c?.avatarUrl || null,
        isNpc: c?.isNpc ?? false,
        firstRound: p.firstRound,
        lastActedRound: p.lastActedRound,
        ...(isGM
          ? { score: p.score, calculation: p.calculation, tokenMissing: !tokens.some((t) => t.id === p.tokenId) }
          : {}),
        states: tags
          .filter((t) => t.characterId === p.characterId)
          .map((t) => ({
            id: t.id,
            name: t.definition.name,
            romanNumeral: t.romanNumeral,
            icon: t.definition.icon,
            color: t.definition.color,
            remainingTurns: t.remainingTurns ?? null,
          })),
      };
    }),
    transition: transition.operationId
      ? {
          operationId: transition.operationId,
          version: transition.version,
          ...(allowed.has(transition.endedCharacterId) ? { endedCharacterId: transition.endedCharacterId } : {}),
          changed: effects as any,
        }
      : null,
  };
}
