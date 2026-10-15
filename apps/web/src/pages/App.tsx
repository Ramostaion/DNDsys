import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { request } from '../api';
import AuthPage from './AuthPage';
import Lobby from './Lobby';
import Room from './Room';
import LoadBoundary from '../ui/LoadBoundary';

const PresentationStage = lazy(() => import('../ui/presentation/PresentationStage'));

export default function App() {
  const {
    data: me,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      request<any>('/auth/me').catch((cause: Error & { status?: number }) => {
        if (cause.status === 401) return null;
        throw cause;
      }),
    retry: false,
  });
  if (isLoading) return <div className="min-h-screen grid place-items-center subtle">正在载入…</div>;
  // Keep an authenticated room mounted during transient refetch failures so drafts and reconnect handlers survive.
  if (error && !me)
    return (
      <main className="landing min-h-screen grid place-items-center p-5">
        <div className="surface p-8 text-center">
          <h1 className="display-title text-2xl">暂时无法连接冒险桌</h1>
          <p className="subtle mt-3">连接恢复后可继续使用原账号。</p>
          <button className="btn btn-primary mt-5" onClick={() => void refetch()}>
            重试连接
          </button>
        </div>
      </main>
    );
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/rooms" /> : <AuthPage />} />
      <Route path="/rooms" element={me ? <Lobby me={me} /> : <Navigate to="/login" />} />
      <Route path="/rooms/:roomId" element={me ? <Room me={me} /> : <Navigate to="/login" />} />
      <Route
        path="/rooms/:roomId/presentation"
        element={
          me ? (
            <LoadBoundary>
              <Suspense fallback={<div className="min-h-screen grid place-items-center subtle">正在准备大屏…</div>}>
                <PresentationStage />
              </Suspense>
            </LoadBoundary>
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route path="*" element={<Navigate to={me ? '/rooms' : '/login'} />} />
    </Routes>
  );
}
