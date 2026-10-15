import MapLibrary, { MapPortal } from '../MapLibrary';
import ActivityLogs from '../ActivityLogs';
import { AttackProfiles } from '../Combat';
import ManualCombat from '../ManualCombat';
import { ItemEditor, ItemLibrary } from '../ItemLibrary';
import CharacterSheet from '../CharacterSheet';
import QuestJournal from '../QuestJournal';
import DiceTray from '../DiceTray';
import { Inventory, Equipment, PlayerBackpacks } from '../InventoryEquipment';
import TemplateLibrary from '../TemplateLibrary';
import SheetManager from '../SheetManager';
import TradePanel from '../TradePanel';
import CharacterDirectory from '../CharacterDirectory';
import CharacterTagManager from '../character-tags/CharacterTagManager';
import CharacterTagDetails from '../character-tags/CharacterTagDetails';
import TagLibrary from '../character-tags/TagLibrary';
import GmTagOverview from '../character-tags/GmTagOverview';
import DirectorConsole from '../presentation/DirectorConsole';
import ClueGallery from '../presentation/ClueGallery';
import PrivateClues, { ClueReader, ClueImage } from '../private-clues/PrivateClues';
import type { WindowState } from '../../store';
import type { RoomPanelProps as Props } from '../room/types';
import RoomSettings from '../room/RoomSettings';
import RoomDrawingTools from '../room/RoomDrawingTools';

export default function WindowContent({ w, p }: { w: WindowState; p: Props }) {
  switch (w.type) {
    case 'private-clues':
      return <PrivateClues key={`${p.snap.room.id}:${p.me.id}`} p={p} windowId={w.id} />;
    case 'clue-reader':
      return <ClueReader key={`${p.snap.room.id}:${p.me.id}`} p={p} id={w.entityId} />;
    case 'clue-sent':
      return p.isGM ? <ClueReader key={`${p.snap.room.id}:${p.me.id}`} p={p} id={w.entityId} sent /> : null;
    case 'clue-image':
      return <ClueImage key={`${p.snap.room.id}:${p.me.id}`} p={p} id={w.entityId} windowId={w.id} />;
    case 'character-tags':
      return <CharacterTagManager p={p} id={w.entityId} windowId={w.id} />;
    case 'tag-detail':
      return <CharacterTagDetails p={p} id={w.entityId} windowId={w.id} />;
    case 'tag-library':
      return <TagLibrary p={p} windowId={w.id} />;
    case 'tag-overview':
      return <GmTagOverview p={p} />;
    case 'characters':
      return <CharacterDirectory p={p} />;
    case 'character':
      return (
        <>
          <CharacterSheet p={p} id={w.entityId} />
          {!p.snap.room.sheetMode && <AttackProfiles {...p} id={w.entityId} />}
        </>
      );
    case 'sheet':
      return <SheetManager snap={p.snap} isGM={p.isGM} mutate={p.mutate} />;
    case 'maps':
      return <MapLibrary p={p} id={w.entityId} />;
    case 'portal':
      return <MapPortal p={p} id={w.entityId} />;
    case 'items':
      return p.isGM ? <ItemLibrary p={p} /> : <p className="empty-note">物品库仅 GM 可查看。</p>;
    case 'item':
      return <ItemEditor p={p} id={w.entityId} windowId={w.id} />;
    case 'inventory':
      return !w.entityId ? (
        <PlayerBackpacks p={p} />
      ) : (
        <>
          <Inventory p={p} id={w.entityId} />
          <TradePanel p={p} characterId={w.entityId} />
        </>
      );
    case 'equipment':
      return <Equipment p={p} id={w.entityId} />;
    case 'templates':
      return <TemplateLibrary p={p} characterId={w.entityId} />;
    case 'quests':
      return <QuestJournal p={p} />;
    case 'drawing':
      return <RoomDrawingTools p={p} />;
    case 'settings':
      return <RoomSettings p={p} />;
    case 'logs':
      return <ActivityLogs snap={p.snap} />;
    case 'combat':
      return <ManualCombat {...p} />;
    case 'dice':
      return <DiceTray {...p} />;
    case 'presentation':
      return p.isGM ? (
        <DirectorConsole roomId={p.snap.room.id} current={p.presentation} refresh={p.refreshPresentation} />
      ) : (
        <ClueGallery roomId={p.snap.room.id} revision={p.presentation?.revision || 0} />
      );
  }
}
