export const TAG_VISIBILITIES = ['GM_ONLY', 'OWNER', 'PUBLIC'] as const;
export type TagVisibility = (typeof TAG_VISIBILITIES)[number];
export const TAG_ICONS = [
  'clue',
  'secret',
  'curse',
  'relation',
  'event',
  'todo',
  'star',
  'key',
  'book',
  'heart',
  'shield',
  'flame',
] as const;
export const TAG_COLORS = ['#c69452', '#b56ce2', '#62a9db', '#60b895', '#de7385', '#b5bace'] as const;
export const TAG_DETAILS_MAX = 100_000;
export interface TagAppearance {
  id: string;
  name: string;
  icon: string;
  color: string;
  isArchived: boolean;
}
export interface TagDefinition extends TagAppearance {
  roomId: string;
  templateDescription: string;
  defaultVisibility: TagVisibility;
  defaultPriority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  characterCount: number;
}
export interface CharacterTag {
  id: string;
  roomId: string;
  characterId: string;
  tagDefinitionId: string;
  detailsMarkdown: string;
  visibility: TagVisibility;
  priority: number;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  definition: TagAppearance;
}
export function sortCharacterTags<T extends { priority: number; sortOrder: number; id: string }>(
  tags: readonly T[],
): T[] {
  return [...tags].sort((a, b) => b.priority - a.priority || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
export function canViewCharacterTag(visibility: string, isGM: boolean, controlsCharacter: boolean): boolean {
  return isGM || visibility === 'PUBLIC' || (visibility === 'OWNER' && controlsCharacter);
}
export function safeTagLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
