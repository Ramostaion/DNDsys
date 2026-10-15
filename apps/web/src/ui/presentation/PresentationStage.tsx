import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { usePresentation } from './usePresentation';

export default function PresentationStage() {
  const navigate = useNavigate();
  const { roomId } = useParams(),
    presentation = usePresentation(roomId),
    [connected, setConnected] = useState(false),
    [imageError, setImageError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!roomId) return;
    const socket = io({ withCredentials: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('room:join', roomId);
      void presentation.refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:deleted', () => navigate('/rooms', { replace: true }));
    socket.on('presentation.changed', (event: { revision: number }) => presentation.changed(event.revision));
    return () => {
      socket.emit('room:leave', roomId);
      socket.disconnect();
    };
  }, [roomId, presentation.refresh, presentation.changed, navigate]);
  useEffect(() => {
    if (presentation.unavailable) navigate('/rooms', { replace: true });
  }, [presentation.unavailable, navigate]);
  useEffect(() => {
    setImageError(false);
    setRetry(0);
  }, [presentation.current?.revision]);
  const current = presentation.current,
    asset = current?.asset;
  return (
    <main className="presentation-stage">
      <div className="presentation-stage-bar">
        <span>✦ 万象跑团 · 观众页</span>
        <span>{connected ? '实时连接中' : '连接中断 · 正在重连'}</span>
        <Link to={`/rooms/${roomId}`}>返回房间</Link>
      </div>
      {current?.status === 'blackout' ? (
        <div className="presentation-stage-center blackout">黑幕</div>
      ) : current?.status === 'showing' && asset ? (
        <div
          className={`presentation-stage-image transition-${current.transition}`}
          key={`${asset.id}:${current.revision}`}
        >
          {imageError ? (
            <div className="presentation-stage-center">
              图片不可用{' '}
              <button
                className="btn"
                onClick={() => {
                  setImageError(false);
                  setRetry((value) => value + 1);
                }}
              >
                重试图片
              </button>
            </div>
          ) : (
            <img src={`${asset.screenUrl}?r=${retry}`} alt={asset.title} onError={() => setImageError(true)} />
          )}
          <div className="presentation-stage-caption">
            <h1>{asset.title}</h1>
            {asset.caption && <p>{asset.caption}</p>}
          </div>
        </div>
      ) : (
        <div className="presentation-stage-center">
          {presentation.error ? '当前画面读取失败' : '等待 GM 放映画面'}{' '}
          <button className="btn" onClick={() => void presentation.refresh()}>
            重试
          </button>
        </div>
      )}
    </main>
  );
}
