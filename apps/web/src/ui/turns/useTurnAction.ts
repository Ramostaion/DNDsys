import { useEffect, useRef, useState } from 'react';
import { createId } from '../../id';
type Mutate = (type: string, payload: Record<string, unknown>, id?: string) => Promise<any>;
// Transport retries keep one receipt ID and the original expected version.
export function useTurnAction(mutate: Mutate) {
  const guard = useRef(false),
    until = useRef(0),
    mounted = useRef(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(type: string, payload: Record<string, unknown>) {
    const advances = type === 'turn.advance' || type === 'turn.skip';
    if (guard.current || (advances && Date.now() < until.current)) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const operationId = createId();
    try {
      try {
        return await mutate(type, payload, operationId);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status && status !== 503) throw e;
        return await mutate(type, payload, operationId);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      return undefined;
    } finally {
      if (advances) until.current = Date.now() + 450;
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { run, busy, error };
}
