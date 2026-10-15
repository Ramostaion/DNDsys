import Konva from 'konva';
import { movementGuide } from './movement-guide';

/** Built only on a new move or a zoom change; frames update the group's opacity. */
export function drawMovementGuide(group: Konva.Group | null, path: { x: number; y: number }[], scale: number) {
  if (!group) return;
  group.destroyChildren();
  const guide = movementGuide(path, scale);
  if (!guide.points.length) return;
  group.add(
    new Konva.Line({
      name: 'token-move-path',
      points: guide.points,
      stroke: '#E8C97A',
      strokeWidth: guide.lineWidth,
      dash: guide.dash,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    }),
  );
  for (const arrow of guide.arrows)
    group.add(
      new Konva.Line({
        name: 'token-move-arrow',
        x: arrow.x,
        y: arrow.y,
        rotation: arrow.rotation,
        points: [
          guide.size / 2,
          0,
          -guide.size / 2,
          -guide.size * 0.3,
          -guide.size * 0.25,
          0,
          -guide.size / 2,
          guide.size * 0.3,
        ],
        closed: true,
        fill: '#D4AF57',
        stroke: '#705027',
        strokeWidth: guide.lineWidth * 0.35,
        lineJoin: 'round',
        opacity: 1,
        listening: false,
        shadowColor: '#E8C97A',
        shadowBlur: guide.glow,
        shadowOpacity: 0.2,
        perfectDrawEnabled: false,
      }),
    );
}
