import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../api';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(`/auth/${mode}`, { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/rooms');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="landing min-h-screen flex items-center justify-center p-5">
      <div className="landing-mark" aria-hidden="true">
        ✦
      </div>
      <div className="surface landing-card w-full max-w-md p-8">
        <div className="eyebrow">A WORLD TO MAKE YOUR OWN</div>
        <div className="brand-mark mt-3">✦</div>
        <h1 className="display-title text-5xl mt-2">万象跑团</h1>
        <p className="subtle mt-3">召集同伴，展开一场只属于你们的冒险。</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="label">冒险者名称</span>
            <input
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={30}
              required
            />
          </label>
          <label className="block">
            <span className="label">密码</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'register' ? 8 : 1}
              required
            />
          </label>
          {error && <p className="text-red-300 text-sm">{error}</p>}
          <button className="btn btn-primary w-full !py-3" disabled={busy}>
            {mode === 'login' ? '进入冒险' : '创建冒险者账号'}
          </button>
        </form>
        <button
          className="text-amber-300 text-sm mt-5"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? '初次到来？创建账号' : '已有账号？返回登录'}
        </button>
      </div>
    </main>
  );
}
