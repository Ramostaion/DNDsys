import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUI } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 1000, matchMedia: () => ({ matches: false }) });
  useUI.setState({ windows: [], closeGuards: {}, topZ: 10 });
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('reopening during exit cancels stale removal and preserves draft protection', () => {
  const ui = useUI.getState();
  ui.open('settings');
  const id = useUI.getState().windows[0].id;
  const guard = vi.fn(() => true);
  ui.setCloseGuard(id, guard);
  ui.close(id);
  expect(useUI.getState().windows[0].motion).toBe('closing');
  ui.open('settings');
  vi.runAllTimers();
  expect(useUI.getState().windows[0]).toMatchObject({ id, motion: undefined });
  expect(useUI.getState().closeGuards[id]).toBe(guard);
  ui.close(id);
  vi.runAllTimers();
  expect(useUI.getState().windows).toHaveLength(0);
});
it('cancellation and reduced-motion requests bypass neither guards nor immediate privacy cleanup', () => {
  const ui = useUI.getState();
  ui.open('settings');
  const id = useUI.getState().windows[0].id;
  ui.setCloseGuard(id, () => false);
  ui.close(id);
  expect(useUI.getState().windows[0].motion).toBeUndefined();
  ui.setCloseGuard(id);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  ui.close(id);
  expect(useUI.getState().windows).toHaveLength(0);
});

it('replacing a composer finishes closure immediately while preserving its close guard', () => {
  const ui = useUI.getState();
  ui.open('private-clues');
  const id = useUI.getState().windows[0].id;
  const guard = vi.fn(() => false);
  ui.setCloseGuard(id, guard);
  ui.close(id, { immediate: true });
  expect(guard).toHaveBeenCalledOnce();
  expect(useUI.getState().windows).toHaveLength(1);
  guard.mockReturnValue(true);
  ui.close(id);
  expect(useUI.getState().windows[0].motion).toBe('closing');
  ui.close(id, { immediate: true });
  expect(useUI.getState().windows).toHaveLength(0);
  expect(useUI.getState().closeGuards[id]).toBeUndefined();
  ui.open('private-clues');
  vi.runAllTimers();
  expect(useUI.getState().windows).toHaveLength(1);
  expect(useUI.getState().windows[0].id).not.toBe(id);
});
