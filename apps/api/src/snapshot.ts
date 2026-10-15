import {
  canControlCharacter,
  canViewCharacterInventory,
  canLootCharacterInventory,
  characterCurrentHealth,
  withShieldFields,
  compareCombatants,
  type SheetField,
} from '@dnd/shared';
import type { PrismaClient } from '@prisma/client';
import { array, object } from './data.js';
import { visibleCharacterTags } from './character-tags.js';
import { memberCan } from './permissions.js';
import { visibleCombatRecord } from './combat-visibility.js';

export async function snapshot(db: PrismaClient, roomId: string, viewerId: string, isGM = false) {
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
  const members = await db.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, username: true, avatarUrl: true } } },
  });
  const allCharacters = await db.character.findMany({
    where: { roomId },
    include: { inventory: { include: { item: true, equipped: true } }, equipment: true },
    orderBy: { createdAt: 'asc' },
  });
  const definitions = withShieldFields(array(room.sheetSchema) as SheetField[]);
  const viewer = members.find((member) => member.userId === viewerId);
  const visible = (field: SheetField, character: { ownerId: string | null; isNpc?: boolean; visibility?: string }) =>
    isGM ||
    (field.visibility !== 'GM' && (field.visibility !== 'OWNER' || canControlCharacter(viewer, character, viewerId)));
  const visibleCharacters = allCharacters.filter((character) => isGM || character.visibility !== 'GM');
  const visibleCharacterIds = new Set(visibleCharacters.map((character) => character.id));
  const tags = await visibleCharacterTags(
    db,
    roomId,
    viewerId,
    isGM,
    visibleCharacters,
    object(members.find((member) => member.userId === viewerId)?.permissions).editAllCharacters === true,
  );
  const characters = visibleCharacters.map((character) => {
    const allowed = new Set(definitions.filter((field) => visible(field, character)).map((field) => field.fieldId));
    const hide = (input: unknown) =>
      Object.fromEntries(
        Object.entries(object(input)).filter(
          ([key]) => !definitions.some((field) => field.fieldId === key) || allowed.has(key),
        ),
      );
    const derived = object(character.derived);
    const agility = object(derived.agility);
    const visibleAgility =
      isGM ||
      !agility.fieldId ||
      !definitions.some((field) => field.fieldId === agility.fieldId) ||
      allowed.has(agility.fieldId);
    const visibleValues = hide(derived.values);
    if (!visibleAgility) {
      if (!definitions.some((field) => field.fieldId === '当前有效敏捷')) delete visibleValues.当前有效敏捷;
      if (!definitions.some((field) => field.fieldId === '敏捷属性加值')) delete visibleValues.敏捷属性加值;
    }
    const inventoryVisible = canViewCharacterInventory(
      viewer,
      { ...character, healthCurrent: characterCurrentHealth(room, character) },
      viewerId,
      Boolean(viewer && memberCan(room, viewer, 'viewOtherInventories')),
    );
    const inventoryLootable = canLootCharacterInventory(
      viewer,
      { ...character, healthCurrent: characterCurrentHealth(room, character) },
      viewerId,
    );
    return {
      ...character,
      inventoryVisible,
      inventoryLootable,
      inventory: inventoryVisible ? character.inventory : [],
      equipment: inventoryVisible ? character.equipment : [],
      fieldValues: hide(character.fieldValues),
      derived: {
        ...derived,
        agility:
          visibleAgility && agility.fieldId
            ? { ...agility, modifiers: inventoryVisible ? agility.modifiers : [] }
            : null,
        values: visibleValues,
        sources: inventoryVisible ? hide(derived.sources) : {},
        breakdown: inventoryVisible ? hide(derived.breakdown) : {},
        errors: hide(derived.errors),
      },
    };
  });
  const allMaps = await db.map.findMany({ where: { roomId }, orderBy: { name: 'asc' } });
  const maps = allMaps.filter((map) => isGM || map.visibility !== 'GM');
  const visibleMapIds = new Set(maps.map((map) => map.id));
  const portals = (await db.mapPortal.findMany({ where: { source: { roomId } } })).filter(
    (portal) => visibleMapIds.has(portal.sourceMapId) && visibleMapIds.has(portal.targetMapId),
  );
  const allTokens = await db.mapToken.findMany({ where: { map: { roomId } } });
  const tokens = allTokens.filter(
    (token) =>
      visibleMapIds.has(token.mapId) &&
      visibleCharacterIds.has(token.characterId) &&
      (isGM || token.visibility !== 'GM'),
  );
  const visibleTokenIds = new Set(tokens.map((token) => token.id));
  const templates = await db.template.findMany({ where: { roomId } });
  const rawQuests = await db.quest.findMany({ where: { roomId, ...(isGM ? {} : { isPublic: true }) } });
  const quests = isGM
    ? rawQuests
    : rawQuests.map((quest) => Object.fromEntries(Object.entries(quest).filter(([key]) => key !== 'privateNote')));
  const drawings = (
    await db.drawingOperation.findMany({
      where: { roomId, undone: false },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).filter((drawing) => visibleMapIds.has(drawing.mapId));
  const history = await db.drawingHistory.groupBy({
    where: { roomId, userId: viewerId, mapId: { in: [...visibleMapIds] }, state: { in: ['APPLIED', 'UNDONE'] } },
    by: ['mapId', 'state'],
  });
  const drawingHistory = maps.map((map) => ({
    mapId: map.id,
    canUndo:
      history.some((h) => h.mapId === map.id && h.state === 'APPLIED') ||
      drawings.some(
        (d) => d.mapId === map.id && d.authorId === viewerId && ['STROKE', 'ERASER'].includes(d.kind) && !d.historyId,
      ),
    canRedo: history.some((h) => h.mapId === map.id && h.state === 'UNDONE'),
  }));
  const allLogs = await db.activityLog.findMany({
    where: { roomId, ...(isGM ? {} : { action: { notIn: ['dice.roll', 'combat.record', 'combat.correct'] } }) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const characterById = new Map(allCharacters.map((character) => [character.id, character]));
  const logs = allLogs.filter((log) => {
    if (isGM) return true;
    if (log.action.startsWith('tagDefinition.') || log.action.startsWith('characterTag.')) return false;
    if (
      log.entityId &&
      !visibleCharacterIds.has(log.entityId) &&
      allCharacters.some((character) => character.id === log.entityId)
    )
      return false;
    if (log.entityId && allMaps.some((map) => map.id === log.entityId) && !visibleMapIds.has(log.entityId))
      return false;
    if (log.entityId && allTokens.some((token) => token.id === log.entityId) && !visibleTokenIds.has(log.entityId))
      return false;
    if (!['character.field.set', 'character.field.adjust'].includes(log.action)) return true;
    const field = definitions.find((candidate) => candidate.fieldId === object(log.data).fieldId);
    return !field || visible(field, characterById.get(log.entityId || '') ?? { ownerId: null });
  });
  const rawEncounter = await db.combatEncounter.findFirst({
    where: { roomId, status: 'ACTIVE' },
    include: { combatants: true },
  });
  const currentId = rawEncounter
    ? [...rawEncounter.combatants].sort(compareCombatants)[rawEncounter.turnIndex]?.characterId
    : null;
  const visibleCombatants =
    rawEncounter?.combatants
      .filter((combatant) => visibleCharacterIds.has(combatant.characterId))
      .sort(compareCombatants) || [];
  const encounter = rawEncounter
    ? {
        ...rawEncounter,
        combatants: visibleCombatants,
        currentCharacterId: currentId && visibleCharacterIds.has(currentId) ? currentId : null,
        turnIndex: visibleCombatants.findIndex((combatant) => combatant.characterId === currentId),
      }
    : null;
  const rolls = (
    await db.diceRoll.findMany({
      where: { roomId, ...(isGM ? {} : { OR: [{ visibility: 'PUBLIC' }, { userId: viewerId }] }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  ).filter(
    (roll) => roll.visibility === 'PUBLIC' || isGM || !roll.characterId || visibleCharacterIds.has(roll.characterId),
  );
  const combatEvents = (
    await db.combatEvent.findMany({
      where: { roomId, ...(isGM ? {} : { visibility: 'PUBLIC' }) },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  )
    .filter((event) => {
      if (isGM) return true;
      const payload = object(event.data),
        ids = [event.actorId, event.targetId, payload.characterId, ...array(payload.participants)];
      return ids.every((id) => !id || visibleCharacterIds.has(String(id)));
    })
    .map((event) =>
      isGM ? event : visibleCombatRecord(event, (id) => characters.find((c) => c.id === id)?.inventoryVisible === true),
    );
  const trades = await db.tradeRequest.findMany({
    where: { roomId, ...(isGM ? {} : { OR: [{ senderId: viewerId }, { recipientId: viewerId }] }) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const itemIds = [
    ...new Set([
      ...characters.flatMap((character) => character.inventory.map((entry) => entry.itemId)),
      ...trades.map((trade) => trade.itemId),
    ]),
  ];
  const items = await db.itemDefinition.findMany({
    where: { roomId, ...(isGM ? {} : { id: { in: itemIds } }) },
    orderBy: { createdAt: 'asc' },
  });
  const visibleRoom = {
    ...room,
    activeMapId: room.activeMapId && visibleMapIds.has(room.activeMapId) ? room.activeMapId : null,
    sheetSchema: definitions.filter((field) => isGM || field.visibility !== 'GM'),
  };
  return {
    room: visibleRoom,
    members,
    characters,
    maps,
    portals,
    tokens,
    items,
    templates,
    quests,
    drawings,
    drawingHistory,
    logs,
    encounter,
    rolls,
    diceState: { serverNow: Date.now(), cooldownUntil: room.publicDiceAvailableAt?.getTime() || 0 },
    combatEvents,
    trades,
    ...tags,
  };
}
