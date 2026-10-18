import { useEffect } from 'react';
import { useUI } from '../../store';
export function useDraftProtection(windowId: string, dirty: boolean) {
  const setGuard = useUI((s) => s.setCloseGuard);
  useEffect(() => {
    setGuard(windowId, dirty ? () => window.confirm('还有未保存的状态草稿。关闭会丢弃草稿，确定关闭？') : undefined);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setGuard(windowId);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [windowId, dirty, setGuard]);
}
