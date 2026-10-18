import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { CombatDraftView } from '@dnd/shared';
import { request, type Snapshot } from '../../api';
import { createId } from '../../id';

export const localCombatDrafts = create<{
  hidden: Map<string, string | null>;
  hide: (id: string) => void;
  reveal: (id: string, eventId: string) => void;
}>((set) => ({
  hidden: new Map(),
  hide: (id) => set((s) => ({ hidden: new Map(s.hidden).set(id, null) })),
  reveal: (id, eventId) => set((s) => ({ hidden: new Map(s.hidden).set(id, eventId) })),
}));
export function notifyCombatDrafts(roomId: string, recover = false) {
  window.dispatchEvent(new CustomEvent('dnd:combat-drafts', { detail: { roomId, recover } }));
}

/** One independent draft per mounted combat window; no temporary result is a combat record. */
export function useCombatDraft(
  snap: Snapshot,
  userId: string,
  actorId: string | undefined,
  targetId: string,
  privateRecord: boolean,
  closing: boolean,
  frozen: boolean,
  actorAttribute = '敏捷',
) {
  const [id, setId] = useState(createId),
    [retry, setRetry] = useState(0),
    [state, setState] = useState<{ value?: CombatDraftView; pending: boolean; error: string }>({
      pending: false,
      error: '',
    });
  const sequence = useRef(0),
    closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const actor = snap.characters.find((c) => c.id === actorId),
    target = snap.characters.find((c) => c.id === targetId);
  const valid = Boolean(actor && target && actor.id !== target.id && !closing);
  const parameters = JSON.stringify({
    actorId: valid ? actorId : null,
    targetId: valid ? targetId : null,
    privateRecord,
    actorAttribute,
    actor: actor && [actor.name, actor.avatarUrl, actor.ownerId, actor.visibility, actor.derived],
    target: target && [target.name, target.avatarUrl, target.ownerId, target.visibility, target.derived],
    schema: snap.room.sheetSchema,
    rules: snap.room.rules,
    member: snap.members.find((m) => m.userId === userId),
    retry,
  });
  useEffect(() => {
    if (frozen) return;
    const revision = ++sequence.current,
      controller = new AbortController();
    const body = {
      revision,
      actorId: valid ? actorId : null,
      targetId: valid ? targetId : null,
      privateRecord,
      actorAttribute,
    };
    let alive = true;
    localCombatDrafts.getState().hide(id);
    setState({ pending: valid, error: '' });
    async function update() {
      if (!alive || revision !== sequence.current) return;
      if (!valid && revision === 1) return;
      try {
        const value = await request<CombatDraftView>(`/rooms/${snap.room.id}/combat-drafts/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!alive || revision !== sequence.current) return;
        setState({ value, pending: false, error: '' });
        localCombatDrafts.getState().reveal(id, value.eventId);
        notifyCombatDrafts(snap.room.id);
      } catch (error) {
        if (!alive || controller.signal.aborted || revision !== sequence.current) return;
        setState({ pending: false, error: (error as Error).message });
        // A rejected replacement must also withdraw the previously selected target.
        if ((error as any).status && (error as any).status < 500) {
          const cancellation = ++sequence.current;
          void request(`/rooms/${snap.room.id}/combat-drafts/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ revision: cancellation, actorId: null, targetId: null, privateRecord: false }),
          }).catch(() => {});
        }
      }
    }
    void update();
    const renew = valid ? setInterval(() => void update(), 25_000) : undefined;
    return () => {
      alive = false;
      controller.abort();
      if (renew) clearInterval(renew);
    };
  }, [id, parameters, frozen]);
  useEffect(() => {
    const pendingClose = closeTimers.current.get(id);
    if (pendingClose) {
      clearTimeout(pendingClose);
      closeTimers.current.delete(id);
    }
    return () => {
      localCombatDrafts.getState().hide(id);
      const timer = setTimeout(() => {
        closeTimers.current.delete(id);
        void request(`/rooms/${snap.room.id}/combat-drafts/${id}`, { method: 'DELETE', keepalive: true }).catch(
          () => {},
        );
      }, 0);
      closeTimers.current.set(id, timer);
    };
  }, [id, snap.room.id]);
  useEffect(() => {
    const close = () => {
      void request(`/rooms/${snap.room.id}/combat-drafts/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  }, [id, snap.room.id]);
  return {
    ...state,
    valid,
    ready: !state.pending && state.value?.state === 'ACTIVE',
    fields: state.value ? { draftId: id, draftRevision: state.value.revision, draftEventId: state.value.eventId } : {},
    refresh: () => setRetry((value) => value + 1),
    committed: () => {
      localCombatDrafts.getState().hide(id);
      setState({ pending: false, error: '' });
      setId(createId());
    },
  };
}
