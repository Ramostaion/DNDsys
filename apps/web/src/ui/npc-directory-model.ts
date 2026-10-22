import type { Snapshot } from '../api';
export type NpcFolder = NonNullable<Snapshot['npcDirectory']>['folders'][number];
export function folderChain(folders: NpcFolder[], id: string | null): NpcFolder[] {
  const chain: NpcFolder[] = [],
    seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((row) => row.id === id);
    if (!folder) break;
    chain.unshift(folder);
    id = folder.parentId;
  }
  return chain;
}
export const folderPath = (folders: NpcFolder[], id: string | null) =>
  id
    ? folderChain(folders, id)
        .map((row) => row.name)
        .join(' / ')
    : '未分类';
export function folderDescendants(folders: NpcFolder[], id: string) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders)
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
  }
  return ids;
}
