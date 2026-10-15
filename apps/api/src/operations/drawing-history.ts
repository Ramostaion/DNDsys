import type { DrawingOperation, Prisma } from '@prisma/client';
import { json } from './helpers.js';

type Change = { id: string; before: boolean; after: boolean; beforeHistoryId: string | null };
type Scope = { roomId: string; mapId: string; userId: string };
type Tx = Prisma.TransactionClient;

/** Called under the existing room row lock, together with the actual drawing write. */
export async function recordDrawingEdit(
  tx: Tx,
  scope: Scope,
  drawings: DrawingOperation[],
  after: boolean,
  newBranch = true,
) {
  if (!drawings.length) return;
  if (newBranch)
    await tx.drawingHistory.updateMany({ where: { ...scope, state: 'UNDONE' }, data: { state: 'DISCARDED' } });
  const history = await tx.drawingHistory.create({
    data: {
      ...scope,
      ...(!newBranch ? { createdAt: drawings[0].createdAt } : {}),
      changes: json(drawings.map((d) => ({ id: d.id, before: d.undone, after, beforeHistoryId: d.historyId }))),
    },
  });
  await tx.drawingOperation.updateMany({
    where: { roomId: scope.roomId, mapId: scope.mapId, id: { in: drawings.map((d) => d.id) } },
    data: { undone: after, historyId: history.id },
  });
}

export async function replayDrawingEdit(tx: Tx, scope: Scope, direction: 'undo' | 'redo') {
  const undo = direction === 'undo';
  let history = await tx.drawingHistory.findFirst({
    where: { ...scope, state: undo ? 'APPLIED' : 'UNDONE' },
    orderBy: [{ createdAt: undo ? 'desc' : 'asc' }, { id: undo ? 'desc' : 'asc' }],
  });
  // Existing drawings remain individually undoable without rewriting any old geometry.
  if (!history && undo) {
    const legacy = await tx.drawingOperation.findFirst({
      where: {
        roomId: scope.roomId,
        mapId: scope.mapId,
        authorId: scope.userId,
        kind: { in: ['STROKE', 'ERASER'] },
        undone: false,
        historyId: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (legacy) {
      await recordDrawingEdit(tx, scope, [{ ...legacy, undone: true }], false, false);
      history = await tx.drawingHistory.findFirstOrThrow({
        where: { ...scope, state: 'APPLIED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    }
  }
  if (!history) return { mapId: scope.mapId, changed: 0, skipped: 0 };
  const changes = history.changes as Change[];
  // One batch query even when a sweep erased many strokes. A later member's edit wins.
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "DrawingOperation" AS d
    SET "undone" = CASE WHEN ${undo} THEN c.before ELSE c.after END,
        "historyId" = CASE WHEN ${undo} THEN c."beforeHistoryId" ELSE ${history.id} END
    FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
      AS c(id text, before boolean, after boolean, "beforeHistoryId" text)
    WHERE d.id = c.id AND d."roomId" = ${scope.roomId} AND d."mapId" = ${scope.mapId}
      AND d.kind IN ('STROKE', 'ERASER')
      AND d.undone = CASE WHEN ${undo} THEN c.after ELSE c.before END
      AND d."historyId" IS NOT DISTINCT FROM
        (CASE WHEN ${undo} THEN ${history.id} ELSE c."beforeHistoryId" END)
    RETURNING d.id
  `;
  const updatedIds = new Set(updated.map((row) => row.id));
  const applied = changes.filter((change) => updatedIds.has(change.id));
  await tx.drawingHistory.update({
    where: { id: history.id },
    data: { state: applied.length ? (undo ? 'UNDONE' : 'APPLIED') : 'DISCARDED', changes: json(applied) },
  });
  return { mapId: scope.mapId, changed: applied.length, skipped: changes.length - applied.length };
}
