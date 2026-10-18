import TurnHUD from '../ui/turns/TurnHUD';
import RoomSidebar from '../ui/room/RoomSidebar';
import PartyPanel from '../ui/room/PartyPanel';
import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, Swords, Dices, Compass, ChevronRight, ScrollText } from 'lucide-react';
import { post } from '../api';
import { useUI } from '../store';
import { compareCombatants } from '@dnd/shared';
import PresentationViewer from '../ui/presentation/PresentationViewer';
import { usePresentation } from '../ui/presentation/usePresentation';
import { PrivateClueContext, usePrivateClues } from '../ui/private-clues/usePrivateClues';
import SealedClueMark from '../ui/private-clues/SealedClueMark';
import '../ui/private-clues/private-clues.css';
import LoadBoundary from '../ui/LoadBoundary';
import { useRoomConnection } from '../hooks/useRoomConnection';
import { useRoomSession } from '../hooks/useRoomSession';
import { RoomDiceContext, useRoomDice } from '../ui/dice/useRoomDice';
import { useCombatBroadcast } from '../ui/combat/useCombatBroadcast';
import RoomBroadcasts from '../ui/RoomBroadcasts';
import { TokenMovementChannel } from '../ui/token-motion';
import { ResourceFeedbackScope } from '../ui/ResourceMeter';
import CombatDraftPerformances from '../ui/combat/CombatDraftPerformances';

const Board = lazy(() => import('../ui/Board'));
const Windows = lazy(() => import('../ui/Windows'));

export default function Room({ me }: { me: any }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnToLobby = useCallback(() => {
    useUI.setState({ windows: [], closeGuards: {} });
    void queryClient.cancelQueries({ queryKey: ['snapshot', roomId] });
    queryClient.removeQueries({ queryKey: ['snapshot', roomId] });
    void queryClient.invalidateQueries({ queryKey: ['rooms'] });
    navigate('/rooms', { replace: true });
  }, [navigate, queryClient, roomId]);
  const open = useUI((s) => s.open);
  const hasWindows = useUI((s) => s.windows.length > 0);
  const presentation = usePresentation(roomId);
  const privateClues = usePrivateClues(roomId, me.id);
  const { snap, isLoading, refetch, mutate, error, setError, unavailable, dataUpdatedAt } = useRoomSession(
    roomId,
    me.id,
  );
  const dice = useRoomDice(roomId, snap);
  const combat = useCombatBroadcast(roomId);
  const movements = useMemo(() => new TokenMovementChannel(roomId), [roomId, me.id]);
  useEffect(() => {
    if (unavailable) returnToLobby();
  }, [unavailable, returnToLobby]);
  const { online, connected } = useRoomConnection({
    roomId,
    userId: me.id,
    refresh: refetch,
    refreshPresentation: presentation.refresh,
    presentationChanged: presentation.changed,
    refreshClues: privateClues.refresh,
    onKicked: () => navigate('/rooms'),
    onDeleted: returnToLobby,
    onError: setError,
    diceChanged: dice.receive,
    combatChanged: combat.receive,
    tokenMoved: movements.receive,
    resetMovements: movements.reset,
  });
  if (isLoading) return <div className="min-h-screen grid place-items-center subtle">正在准备冒险桌…</div>;
  if (!snap)
    return (
      <div className="min-h-screen grid place-items-center">
        <div>
          无法进入房间{' '}
          <button className="btn" onClick={() => navigate('/rooms')}>
            返回
          </button>
        </div>
      </div>
    );
  const isGM = snap.members.find((m) => m.userId === me.id)?.role === 'GM';
  const active = snap.maps.find((m) => m.id === snap.room.activeMapId);
  const turn = snap.encounter?.combatants?.slice().sort(compareCombatants)[snap.encounter?.turnIndex ?? 0];
  const turnCharacter = snap.characters.find((c) => c.id === turn?.characterId);
  return (
    <ResourceFeedbackScope connected={connected} updatedAt={dataUpdatedAt}>
      <RoomDiceContext.Provider value={{ clock: dice.clock, updateClock: dice.updateClock }}>
        <PrivateClueContext.Provider value={privateClues}>
          <div className="game-shell h-screen overflow-hidden flex" data-turn-active={Boolean(snap.turnSession)}>
            <RoomSidebar isGM={isGM} unreadCount={privateClues.unreadCount} />
            <section className="flex-1 relative min-w-0">
              <RoomBroadcasts
                key={`${roomId}:${me.id}`}
                roomId={roomId!}
                dice={dice.cue}
                combat={combat.cue}
                hasTurn={Boolean(snap.encounter)}
              />
              <LoadBoundary>
                <Suspense fallback={<div className="min-h-full grid place-items-center subtle">正在准备地图…</div>}>
                  <Board snap={snap} me={me} mutate={mutate} open={open} movements={movements} />
                </Suspense>
              </LoadBoundary>
              <div className="room-heading pointer-events-none">
                <div className="eyebrow">
                  THE ADVENTURE TABLE · {snap.room.status === 'ACTIVE' ? '进行中' : '准备中'}
                </div>
                <div className="display-title text-2xl mt-1">{snap.room.name}</div>
                <div className="text-sm text-amber-100/70 flex items-center gap-2 mt-1">
                  <Compass size={15} />
                  {active?.name || '尚未布置地图'}
                </div>
              </div>
              <CombatDraftPerformances
                key={`${roomId}:${me.id}`}
                roomId={roomId!}
                userId={me.id}
                connected={connected}
              />
              <TurnHUD
                key={`${roomId}:${me.id}`}
                session={snap.turnSession}
                visibleCharacters={snap.characters}
                visibleMaps={snap.maps}
                visibleStates={snap.characterTags}
                isGM={isGM}
                connected={connected}
                mutate={mutate}
              />
              <PartyPanel
                snap={snap}
                me={me}
                isGM={isGM}
                online={online}
                connected={connected}
                onError={setError}
                onStart={() =>
                  void post(`/rooms/${roomId}/start`, {})
                    .then(() => refetch())
                    .catch((e) => setError(e.message))
                }
              />
              {snap.encounter && (
                <button className="turn-banner" onClick={() => open('combat')}>
                  <Swords size={18} />
                  <span>
                    第 {snap.encounter.round} 轮 · 轮到 <strong>{turnCharacter?.name || '角色'}</strong>
                  </span>
                  <ChevronRight size={16} />
                </button>
              )}
              <div className="quick-bar">
                <button onClick={() => open('characters')}>
                  <Users size={19} />
                  <span>人物卡</span>
                </button>
                <button onClick={() => open('dice')}>
                  <Dices size={20} />
                  <span>掷骰</span>
                </button>
                <button onClick={() => open('combat')}>
                  <Swords size={20} />
                  <span>战斗</span>
                </button>
                <button onClick={() => open('quests')}>
                  <ScrollText size={19} />
                  <span>任务</span>
                </button>
              </div>
              <PresentationViewer
                roomId={roomId!}
                userId={me.id}
                isGM={isGM}
                current={presentation.current}
                error={presentation.error}
                onRetry={() => void presentation.refresh()}
              />
              {hasWindows && (
                <LoadBoundary>
                  <Suspense fallback={null}>
                    <Windows
                      snap={snap}
                      me={me}
                      isGM={isGM}
                      mutate={mutate}
                      refresh={refetch}
                      presentation={presentation.current}
                      refreshPresentation={presentation.refresh}
                    />
                  </Suspense>
                </LoadBoundary>
              )}
            </section>
            {privateClues.notice && (
              <div className="private-clue-notice" role="status" data-notice-id={privateClues.noticeId}>
                <SealedClueMark key={privateClues.noticeId} />
                <div>
                  <p>{privateClues.notice}</p>
                  <div className="clue-notice-actions">
                    <button
                      onClick={() => {
                        open('private-clues');
                        privateClues.dismiss();
                      }}
                    >
                      打开收件箱
                    </button>
                    <button aria-label="关闭私密线索通知" onClick={privateClues.dismiss}>
                      稍后查看
                    </button>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="toast" onClick={() => setError('')}>
                {error} <span className="ml-2 cursor-pointer">×</span>
              </div>
            )}
          </div>
        </PrivateClueContext.Provider>
      </RoomDiceContext.Provider>
    </ResourceFeedbackScope>
  );
}
