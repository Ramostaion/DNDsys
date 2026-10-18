export const STARTER_MAP_IMAGE = '/maps/frontier-watchtower.png?v=night-20261017';

/** Refresh the bundled map in existing rooms without rewriting their saved map data. */
export function mapImageUrl(url?: string | null) {
  return url?.split(/[?#]/)[0] === '/maps/frontier-watchtower.png' ? STARTER_MAP_IMAGE : url || undefined;
}
