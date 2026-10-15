import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  TAG_DETAILS_MAX,
  TAG_ICONS,
  TAG_VISIBILITIES,
  canViewCharacterTag,
  sortCharacterTags,
  canControlCharacter,
} from '@dnd/shared';
import { fail } from './http.js';

const priority = z.number().int().min(-100).max(100);
const details = z.string().max(TAG_DETAILS_MAX, '详情最多 100,000 字符');
const definitionInput = z.object({
  name: z.string().trim().min(1, '请填写标签名称').max(80),
  icon: z
    .string()
    .refine(
      (value) =>
        (TAG_ICONS as readonly string[]).includes(value) ||
        (/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]*$/u.test(value) &&
          value.length <= 16),
      '请选择图标或输入一个 emoji',
    ),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, '请选择有效颜色'),
  templateDescription: details.default(''),
  defaultVisibility: z.enum(TAG_VISIBILITIES).default('GM_ONLY'),
  defaultPriority: priority.default(0),
});
const instanceInput = z.object({
  detailsMarkdown: details,
  visibility: z.enum(TAG_VISIBILITIES),
  priority,
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
});
const idInput = z.string().min(1).max(100);
const expectedVersion = z.number().int().min(0);
type Tx = Prisma.TransactionClient;
async function definitionIn(tx: Tx, roomId: string, id: unknown) {
  const definition = await tx.tagDefinition.findFirst({ where: { id: idInput.parse(id), roomId } });
  if (!definition) fail(404, '标签定义不存在');
  return definition!;
}
async function tagIn(tx: Tx, roomId: string, id: unknown) {
  const tag = await tx.characterTag.findFirst({ where: { id: idInput.parse(id), roomId } });
  if (!tag) fail(404, '角色标签不存在或已被移除');
  return tag!;
}
function checkVersion(actual: number, input: unknown) {
  if (actual !== expectedVersion.parse(input)) fail(409, '内容已被其他窗口更新，请重新加载或复制当前草稿');
}

export async function characterTagOperation(tx: Tx, roomId: string, type: string, p: Record<string, unknown>) {
  switch (type) {
    case 'tagDefinition.create':
      return tx.tagDefinition.create({ data: { roomId, ...definitionInput.parse(p) } });
    case 'tagDefinition.update': {
      const definition = await definitionIn(tx, roomId, p.id);
      checkVersion(definition.version, p.version);
      const data = definitionInput.parse(p);
      const changed = await tx.tagDefinition.updateMany({
        where: { id: definition.id, version: definition.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) fail(409, '标签定义已被其他窗口修改');
      return tx.tagDefinition.findUniqueOrThrow({ where: { id: definition.id } });
    }
    case 'tagDefinition.archive':
    case 'tagDefinition.restore': {
      const definition = await definitionIn(tx, roomId, p.id);
      checkVersion(definition.version, p.version);
      return tx.tagDefinition.update({
        where: { id: definition.id, version: definition.version },
        data: { isArchived: type === 'tagDefinition.archive', version: { increment: 1 } },
      });
    }
    case 'characterTag.attach':
    case 'characterTag.attachBatch': {
      const definition = await definitionIn(tx, roomId, p.tagDefinitionId);
      checkVersion(definition.version, p.definitionVersion);
      if (definition.isArchived) fail(409, '标签已归档，请先恢复再分配');
      const ids =
        type === 'characterTag.attach'
          ? [idInput.parse(p.characterId)]
          : z.array(idInput).min(1).max(100).parse(p.characterIds);
      const uniqueIds = [...new Set(ids)];
      if ((await tx.character.count({ where: { roomId, id: { in: uniqueIds } } })) !== uniqueIds.length)
        fail(404, '角色不存在或不属于当前房间');
      const data = instanceInput.parse({
        detailsMarkdown: definition.templateDescription,
        visibility: definition.defaultVisibility,
        priority: definition.defaultPriority,
        sortOrder: 0,
        ...p,
      });
      const attached = [];
      const skipped: string[] = [];
      for (const characterId of uniqueIds) {
        const existing = await tx.characterTag.findUnique({
          where: { characterId_tagDefinitionId: { characterId, tagDefinitionId: definition.id } },
        });
        if (existing) {
          if (type === 'characterTag.attach') fail(409, '此角色已经拥有这个标签，请编辑已有备注');
          skipped.push(characterId);
          continue;
        }
        attached.push(
          await tx.characterTag.create({ data: { roomId, characterId, tagDefinitionId: definition.id, ...data } }),
        );
      }
      return type === 'characterTag.attach' ? attached[0] : { attached, skipped };
    }
    case 'characterTag.update': {
      const tag = await tagIn(tx, roomId, p.id);
      checkVersion(tag.version, p.version);
      const data = instanceInput.parse(p);
      const changed = await tx.characterTag.updateMany({
        where: { id: tag.id, version: tag.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) fail(409, '内容已被其他窗口更新，请保留草稿并重新加载');
      return tx.characterTag.findUniqueOrThrow({ where: { id: tag.id } });
    }
    case 'characterTag.detach': {
      const tag = await tagIn(tx, roomId, p.id);
      checkVersion(tag.version, p.version);
      await tx.characterTag.delete({ where: { id: tag.id, version: tag.version } });
      return { id: tag.id, characterId: tag.characterId };
    }
    default:
      fail(400, '未知标签操作');
  }
}

export async function visibleCharacterTags(
  db: PrismaClient,
  roomId: string,
  viewerId: string,
  isGM: boolean,
  characters: { id: string; ownerId: string | null; isNpc?: boolean; visibility?: string }[],
  controlsAll: boolean,
) {
  const accessible = new Map(
    characters.map((c) => [
      c.id,
      canControlCharacter(
        { role: isGM ? 'GM' : 'PLAYER', permissions: { editAllCharacters: controlsAll } },
        c,
        viewerId,
      ),
    ]),
  );
  const all = await db.characterTag.findMany({
    where: { roomId, characterId: { in: [...accessible.keys()] } },
    include: { definition: { select: { id: true, name: true, icon: true, color: true, isArchived: true } } },
  });
  const characterTags = sortCharacterTags(
    all.filter((tag) => canViewCharacterTag(tag.visibility, isGM, accessible.get(tag.characterId) === true)),
  );
  const tagDefinitions = isGM
    ? (
        await db.tagDefinition.findMany({
          where: { roomId },
          include: { _count: { select: { characterTags: true } } },
          orderBy: { createdAt: 'asc' },
        })
      ).map(({ _count, ...definition }) => ({ ...definition, characterCount: _count.characterTags }))
    : [];
  return { characterTags, tagDefinitions };
}
