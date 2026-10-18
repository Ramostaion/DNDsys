/** Bounds of the visible cone, in the unrotated ruler group's map coordinates. */
export function coneRulerBounds(length: number, aperture: number, rotation: number) {
  const radius = Math.abs(length);
  const start = (((rotation % 360) + 360) % 360) - aperture / 2;
  const end = start + aperture;
  const angles = [start, end];
  // The extrema of a circular arc can occur between its two endpoints.
  for (let quadrant = Math.ceil(start / 90); quadrant * 90 < end; quadrant++) angles.push(quadrant * 90);
  const xs = [0],
    ys = [0];
  for (const angle of angles) {
    const radians = (angle * Math.PI) / 180;
    xs.push(radius * Math.cos(radians));
    ys.push(radius * Math.sin(radians));
  }
  const left = Math.min(...xs),
    top = Math.min(...ys);
  // Match the existing 2-map-pixel outline; screen-sized selection padding is added by Ruler.
  return { x: left - 1, y: top - 1, width: Math.max(...xs) - left + 2, height: Math.max(...ys) - top + 2 };
}
