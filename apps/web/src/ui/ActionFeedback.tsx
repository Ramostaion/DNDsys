import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, LoaderCircle, CircleAlert } from 'lucide-react';

type Feedback = { phase: 'idle' | 'pending' | 'success' | 'error'; message: string };
const idle: Feedback = { phase: 'idle', message: '' };
const Context = createContext({ run: async <T,>(action: () => Promise<T>): Promise<T> => action() });
export const useActionFeedback = () => useContext(Context);

export default function ActionFeedback({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback>(idle);
  const state = useRef({
    sequence: 0,
    pending: 0,
    latest: idle,
    failure: '',
    active: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  useEffect(() => {
    const current = state.current;
    current.active = true;
    return () => {
      current.active = false;
      clearTimeout(current.timer);
    };
  }, []);
  async function run<T>(action: () => Promise<T>): Promise<T> {
    const current = state.current,
      sequence = ++current.sequence;
    if (!current.pending) current.failure = '';
    current.pending++;
    clearTimeout(current.timer);
    setFeedback({ phase: 'pending', message: '正在处理…' });
    try {
      const result = await action();
      if (sequence === current.sequence) current.latest = { phase: 'success', message: '操作已完成' };
      return result;
    } catch (error) {
      current.failure = (error as Error).message || '暂时未能确认，请重试';
      if (sequence === current.sequence)
        current.latest = { phase: 'error', message: (error as Error).message || '暂时未能确认，请重试' };
      throw error;
    } finally {
      current.pending--;
      if (current.active && !current.pending) {
        setFeedback(current.failure ? { phase: 'error', message: current.failure } : current.latest);
        if (!current.failure && current.latest.phase === 'success')
          current.timer = setTimeout(() => setFeedback(idle), 1800);
      }
    }
  }
  const Icon = feedback.phase === 'pending' ? LoaderCircle : feedback.phase === 'error' ? CircleAlert : Check;
  return (
    <Context.Provider value={{ run }}>
      {children}
      <div className={`action-feedback is-${feedback.phase}`} role="status" aria-live="polite" aria-atomic="true">
        {feedback.phase !== 'idle' && (
          <>
            <Icon size={13} />
            <span>{feedback.message}</span>
          </>
        )}
      </div>
    </Context.Provider>
  );
}
