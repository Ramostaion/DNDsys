import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Compass, ChevronRight } from 'lucide-react';
import { post, request } from '../api';
import RoomDeleteButton from '../ui/room/RoomDeleteButton';

export default function Lobby({ me }: { me: any }) {
  const { data: rooms = [], refetch } = useQuery({ queryKey: ['rooms'], queryFn: () => request<any[]>('/rooms') });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const lobbyLocation = useLocation();
  async function run(fn: () => Promise<any>) {
    setError('');
    try {
      const room = await fn();
      await refetch();
      navigate(`/rooms/${room.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="landing min-h-screen px-6 py-10">
      <div className="max-w-6xl mx-auto relative z-10">
        <header className="flex justify-between items-center">
          <div>
            <div className="eyebrow">THE ADVENTURE AWAITS</div>
            <h1 className="display-title text-5xl mt-2">冒险大厅</h1>
            <p className="subtle mt-2">选一张桌子，故事就从这里开始。</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="subtle text-sm">{me.username}</span>
            <button
              className="btn"
              onClick={async () => {
                await post('/auth/logout', {});
                location.href = '/login';
              }}
            >
              退出
            </button>
          </div>
        </header>
        <div className="grid md:grid-cols-2 gap-5 mt-10">
          <div className="panel lobby-action p-6">
            <div className="eyebrow">BE THE STORYTELLER</div>
            <h2 className="display-title text-2xl mt-2">创建新冒险</h2>
            <p className="subtle text-sm mt-2 mb-5">建立房间，邀请伙伴，布置地图与角色。</p>
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="为冒险取个名字"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="btn btn-primary whitespace-nowrap"
                disabled={!name.trim()}
                onClick={() => run(() => post('/rooms', { name: name.trim() }))}
              >
                创建 <ChevronRight size={15} className="inline" />
              </button>
            </div>
          </div>
          <div className="panel lobby-action p-6">
            <div className="eyebrow">JOIN THE PARTY</div>
            <h2 className="display-title text-2xl mt-2">加入伙伴</h2>
            <p className="subtle text-sm mt-2 mb-5">输入主持人给你的邀请码，加入跑团。</p>
            <div className="flex gap-2">
              <input
                className="input uppercase"
                placeholder="输入邀请码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className="btn btn-primary whitespace-nowrap"
                disabled={!code.trim()}
                onClick={() => run(() => post('/rooms/join', { inviteCode: code.trim() }))}
              >
                加入 <ChevronRight size={15} className="inline" />
              </button>
            </div>
          </div>
        </div>
        {(error || lobbyLocation.state?.message) && (
          <p className="text-red-300 mt-4" role="alert">
            {error || lobbyLocation.state?.message}
          </p>
        )}
        <div className="flex items-center gap-4 mt-12 mb-5">
          <h2 className="display-title text-2xl">我的冒险</h2>
          <div className="rule-line flex-1" />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <article key={room.id} className="room-card text-left" aria-label={`冒险：${room.name}`}>
              <button
                onClick={() => navigate(`/rooms/${room.id}`)}
                className="block w-full text-left"
                aria-label={`进入房间：${room.name}`}
              >
                <div className="room-card-art">
                  <Compass size={48} strokeWidth={1} />
                </div>
                <div className="p-5">
                  <div className="text-xl display-title">{room.name}</div>
                  <p className="subtle text-sm mt-2 line-clamp-2">{room.description || '新的故事正在等待你们书写。'}</p>
                  <div className="tiny mt-5 text-amber-300">
                    {room._count.members} 位成员 · {room.status === 'ACTIVE' ? '冒险进行中' : '等待开团'}
                  </div>
                </div>
              </button>
              {room.ownerId === me.id && (
                <div className="px-5 pb-4">
                  <RoomDeleteButton room={room} userId={me.id} onDeleted={(result) => setError(result.warning || '')} />
                </div>
              )}
            </article>
          ))}
        </div>
        {rooms.length === 0 && <div className="empty-note">还没有加入冒险。创建一张桌子，或使用伙伴的邀请码。</div>}
      </div>
    </main>
  );
}
