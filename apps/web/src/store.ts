import { create } from 'zustand';
import { createId } from './id';
export type WindowType =
  | 'private-clues'
  | 'clue-reader'
  | 'clue-sent'
  | 'clue-image'
  | 'characters'
  | 'character'
  | 'sheet'
  | 'maps'
  | 'portal'
  | 'items'
  | 'item'
  | 'inventory'
  | 'equipment'
  | 'templates'
  | 'quests'
  | 'drawing'
  | 'settings'
  | 'logs'
  | 'combat'
  | 'dice'
  | 'presentation'
  | 'character-tags'
  | 'tag-detail'
  | 'tag-library'
  | 'tag-overview';
export type WindowState = {
  id: string;
  type: WindowType;
  entityId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
};
type UI = {
  windows: WindowState[];
  topZ: number;
  closeGuards: Record<string, () => boolean>;
  setCloseGuard: (id: string, guard?: () => boolean) => void;
  open: (type: WindowType, entityId?: string) => void;
  toggle: (type: WindowType, entityId?: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  minimize: (id: string) => void;
};
export const useUI = create<UI>((set, get) => ({
  windows: [],
  topZ: 10,
  closeGuards: {},
  setCloseGuard: (id, guard) =>
    set((s) => {
      const closeGuards = { ...s.closeGuards };
      if (guard) closeGuards[id] = guard;
      else delete closeGuards[id];
      return { closeGuards };
    }),
  open: (type, entityId) => {
    const old = get().windows.find((w) => w.type === type && w.entityId === entityId);
    if (old) {
      get().focus(old.id);
      return;
    }
    const n = get().windows.length;
    const tagWindow = type.includes('tag');
    const w =
      type === 'clue-image'
        ? 760
        : type === 'private-clues'
          ? 660
          : ['clue-reader', 'clue-sent'].includes(type)
            ? 620
            : type === 'character'
              ? 660
              : tagWindow
                ? 640
                : ['quests', 'maps', 'item', 'items', 'inventory', 'templates'].includes(type)
                  ? 580
                  : 520;
    const h = ['private-clues', 'clue-reader', 'clue-sent', 'clue-image'].includes(type)
      ? 650
      : type === 'item' || type === 'templates'
        ? 640
        : type === 'character' || tagWindow
          ? 620
          : type === 'inventory'
            ? 600
            : type === 'items'
              ? 560
              : type === 'dice'
                ? 570
                : type === 'quests' || type === 'maps'
                  ? 540
                  : 480;
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
      viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    let x = 0,
      y = 0;
    for (let offset = n; offset <= n + get().windows.length; offset++) {
      x = Math.min(120 + offset * 36, Math.max(8, viewportWidth - w - 90));
      y = Math.min(80 + offset * 26, Math.max(8, viewportHeight - h - 16));
      if (!get().windows.some((win) => Math.abs(win.x - x) < 8 && Math.abs(win.y - y) < 8)) break;
    }
    set((s) => ({
      topZ: s.topZ + 1,
      windows: [...s.windows, { id: createId(), type, entityId, x, y, w, h, z: s.topZ + 1, minimized: false }],
    }));
  },
  toggle: (type, entityId) => {
    const old = get().windows.find((w) => w.type === type && w.entityId === entityId);
    if (!old) get().open(type, entityId);
    else if (old.minimized) get().focus(old.id);
    else get().close(old.id);
  },
  close: (id) => {
    if (get().closeGuards[id] && !get().closeGuards[id]()) return;
    get().setCloseGuard(id);
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) }));
  },
  focus: (id) =>
    set((s) => ({
      topZ: s.topZ + 1,
      windows: s.windows.map((w) => (w.id === id ? { ...w, z: s.topZ + 1, minimized: false } : w)),
    })),
  move: (id, x, y) => set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) })),
  resize: (id, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) => (win.id === id ? { ...win, w: Math.max(340, w), h: Math.max(240, h) } : win)),
    })),
  minimize: (id) => set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) })),
}));
