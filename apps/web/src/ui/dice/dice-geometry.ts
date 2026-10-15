import type { DicePart } from '@dnd/shared';

type Vec = [number, number, number];
export type DieFace = { polygon: string; transform: string; normal: Vec; u: Vec; v: Vec; shade: number };
export type DisplayDie = { sides: number; value?: number; sign: 1 | -1 };
const dot = (a: Vec, b: Vec) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const subtract = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, s: number): Vec => a.map((x) => x * s) as Vec;
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec) => scale(a, 1 / Math.hypot(...a));
const center = (points: Vec[]): Vec =>
  [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length) as Vec;

// Find the outward planes of a small convex solid, merging coplanar triangles.
function hull(vertices: Vec[]) {
  const faces = new Map<string, number[]>();
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++) {
        let normal = cross(subtract(vertices[b], vertices[a]), subtract(vertices[c], vertices[a]));
        if (Math.hypot(...normal) < 1e-7) continue;
        normal = unit(normal);
        const distances = vertices.map((p) => dot(normal, subtract(p, vertices[a])));
        if (distances.some((d) => d > 1e-6) && distances.some((d) => d < -1e-6)) continue;
        const indices = distances.flatMap((d, i) => (Math.abs(d) < 1e-6 ? [i] : []));
        faces.set(indices.join(','), indices);
      }
  return [...faces.values()].map((indices) => {
    const points = indices.map((i) => vertices[i]),
      mid = center(points);
    let normal = unit(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
    if (dot(normal, mid) < 0) normal = scale(normal, -1);
    const u = unit(subtract(points[0], mid)),
      v = cross(normal, u);
    points.sort(
      (a, b) =>
        Math.atan2(dot(subtract(a, mid), v), dot(subtract(a, mid), u)) -
        Math.atan2(dot(subtract(b, mid), v), dot(subtract(b, mid), u)),
    );
    return { points, mid, normal, u, v };
  });
}

function dual(vertices: Vec[]): Vec[] {
  return hull(vertices).map((face) => scale(face.normal, 1 / dot(face.normal, face.mid)));
}

function verticesFor(sides: number): Vec[] {
  if (sides === 4)
    return [
      [1, 1, 1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, -1, -1],
    ];
  if (sides === 6) return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as Vec)));
  if (sides === 8)
    return [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  if (sides === 10) {
    const antiprism = Array.from({ length: 10 }, (_, i): Vec => {
      const angle = ((i % 5) * Math.PI * 2) / 5 + (i >= 5 ? Math.PI / 5 : 0);
      return [Math.cos(angle), Math.sin(angle), i >= 5 ? 0.5 : -0.5];
    });
    return dual(antiprism);
  }
  const phi = (1 + Math.sqrt(5)) / 2;
  const icosahedron: Vec[] = [-1, 1].flatMap((a) =>
    [-phi, phi].flatMap(
      (b) =>
        [
          [0, a, b],
          [a, b, 0],
          [b, 0, a],
        ] as Vec[],
    ),
  );
  return sides === 12 ? dual(icosahedron) : icosahedron;
}

const cache = new Map<number, DieFace[]>();
export function dieGeometry(sides: number): DieFace[] {
  const shape = [4, 6, 8, 10, 12, 20].includes(sides) ? sides : 20;
  if (cache.has(shape)) return cache.get(shape)!;
  const vertices = verticesFor(shape),
    radius = Math.max(...vertices.map((p) => Math.hypot(...p)));
  const faces = hull(vertices.map((p) => scale(p, 42 / radius))).map(({ points, mid, normal, u, v }) => ({
    polygon: `polygon(${points
      .map((p) => {
        const local = subtract(p, mid);
        return `${50 + (dot(local, u) / 88) * 100}% ${50 + (dot(local, v) / 88) * 100}%`;
      })
      .join(',')})`,
    transform: `matrix3d(${[...u, 0, ...v, 0, ...normal, 0, ...mid, 1].join(',')})`,
    normal,
    u,
    v,
    shade: Math.round(24 + Math.max(0, dot(normal, unit([-1, -1, 2]))) * 28),
  }));
  cache.set(shape, faces);
  return faces;
}

// Inverse face basis brings the selected result face toward the camera.
export function resultOrientation(face: DieFace) {
  const { u, v, normal: n } = face;
  return `matrix3d(${[u[0], v[0], n[0], 0, u[1], v[1], n[1], 0, u[2], v[2], n[2], 0, 0, 0, 0, 1].join(',')})`;
}

export function rolledDice(parts: DicePart[]): DisplayDie[] {
  return parts.flatMap((part) => {
    const sides = Number(/^[0-9]*d([0-9]+)$/i.exec(part.label)?.[1]);
    return part.kind === 'dice' && sides >= 2 && sides <= 1000
      ? (part.rolls || []).map((value) => ({ sides, value, sign: part.sign }))
      : [];
  });
}

// Preview only reads dice notation. It never rolls or resolves a character value.
export function previewDice(expression: string): DisplayDie[] {
  const dice: DisplayDie[] = [];
  for (const match of expression.replace(/\s+/g, '').matchAll(/(?:^|([+-]))(\d*)d(\d+)(?=$|[+-])/gi)) {
    const count = Number(match[2] || 1),
      sides = Number(match[3]);
    if (count < 1 || count > 100 || sides < 2 || sides > 1000) continue;
    for (let i = 0; i < count && dice.length < 6; i++) dice.push({ sides, sign: match[1] === '-' ? -1 : 1 });
  }
  return dice;
}
