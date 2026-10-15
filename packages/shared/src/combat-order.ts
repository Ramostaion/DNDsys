export function compareCombatants(
  a: { sortOrder?: number; id: string },
  b: { sortOrder?: number; id: string },
): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id);
}
