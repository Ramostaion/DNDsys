export const RULER_COLORS = [
  '#70def4',
  '#f4ad70',
  '#c0a0ff',
  '#7fe0a6',
  '#ff8da8',
  '#ffe27a',
  '#80aaff',
  '#e8a9f0',
  '#b0d775',
  '#efc7a0',
  '#96ded2',
  '#f5a6a6',
];

/** Keep saved author colors; allocate distinct colors for the remaining members/legacy rulers. */
export function rulerAuthorColors(
  members: { userId: string; joinedAt?: string | Date }[],
  drawings: { authorId: string; kind: string; data: unknown }[],
): Map<string, string> {
  const colors = new Map<string, string>(),
    used = new Set<string>();
  const rulers = drawings.filter((drawing) => drawing.kind === 'RULER');
  for (const drawing of rulers) {
    const color = (drawing.data as { color?: unknown } | null)?.color;
    if (
      !colors.has(drawing.authorId) &&
      typeof color === 'string' &&
      /^#[0-9a-f]{6}$/i.test(color) &&
      !used.has(color.toLowerCase())
    ) {
      colors.set(drawing.authorId, color.toLowerCase());
      used.add(color.toLowerCase());
    }
  }
  const authors = [
    ...new Set([
      ...[...members]
        .sort(
          (a, b) =>
            String(a.joinedAt instanceof Date ? a.joinedAt.toISOString() : a.joinedAt || '').localeCompare(
              String(b.joinedAt instanceof Date ? b.joinedAt.toISOString() : b.joinedAt || ''),
            ) || a.userId.localeCompare(b.userId),
        )
        .map((member) => member.userId),
      ...rulers.map((drawing) => drawing.authorId).sort(),
    ]),
  ];
  for (const author of authors) {
    if (colors.has(author)) continue;
    const color =
      RULER_COLORS.find((candidate) => !used.has(candidate)) || RULER_COLORS[colors.size % RULER_COLORS.length];
    colors.set(author, color);
    used.add(color);
  }
  return colors;
}
