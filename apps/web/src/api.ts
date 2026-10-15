import { createId } from './id';
export const API = '/api';
export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { ...data, status: response.status });
  return data as T;
}
export const post = <T = any>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const op = (roomId: string, type: string, payload: Record<string, unknown>, operationId = createId()) =>
  post(`/rooms/${roomId}/operations`, { id: operationId, type, payload });
import type { CharacterTag, TagDefinition } from '@dnd/shared';
export type Snapshot = {
  room: any;
  members: any[];
  characters: any[];
  maps: any[];
  portals: any[];
  tokens: any[];
  items: any[];
  templates: any[];
  quests: any[];
  drawings: any[];
  drawingHistory?: { mapId: string; canUndo: boolean; canRedo: boolean }[];
  logs: any[];
  encounter: any | null;
  rolls: any[];
  diceState?: import('@dnd/shared').DiceClock;
  combatEvents: any[];
  trades: any[];
  characterTags: CharacterTag[];
  tagDefinitions: TagDefinition[];
};
