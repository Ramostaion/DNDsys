import type { Attachment } from './usePrivateClues';
export type Draft = {
  title: string;
  bodyMarkdown: string;
  gmNote: string;
  associatedCharacterId: string;
  allowForward: boolean;
  recipientUserIds: string[];
  attachments: Attachment[];
  operationId: string | null;
};
export const emptyDraft = (): Draft => ({
  title: '',
  bodyMarkdown: '',
  gmNote: '',
  associatedCharacterId: '',
  allowForward: false,
  recipientUserIds: [],
  attachments: [],
  operationId: null,
});
export const draftKey = (roomId: string, userId: string) => `dnd-private-clue-draft:${roomId}:${userId}`;
export function readDraft(key: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      !value ||
      typeof value.title !== 'string' ||
      typeof value.bodyMarkdown !== 'string' ||
      !Array.isArray(value.recipientUserIds) ||
      !Array.isArray(value.attachments)
    )
      return emptyDraft();
    return { ...emptyDraft(), ...value };
  } catch {
    return emptyDraft();
  }
}
export function writeDraft(key: string, value: Draft) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
