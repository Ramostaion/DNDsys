import { useEffect, useRef, useState } from 'react';

// Remote updates refresh saved text while preserving a local, unsaved draft.
export function useSyncedText(value: string, entityId: string) {
  const [draft, setDraft] = useState(value),
    previous = useRef({ value, entityId });
  useEffect(() => {
    const old = previous.current;
    setDraft((current) => (old.entityId !== entityId || current === old.value ? value : current));
    previous.current = { value, entityId };
  }, [value, entityId]);
  return [draft, setDraft] as const;
}
