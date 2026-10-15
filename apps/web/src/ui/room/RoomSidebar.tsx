import {
  BookOpen,
  Boxes,
  Brush,
  Map,
  ScrollText,
  Settings,
  Shield,
  Users,
  LogOut,
  Swords,
  Dices,
  SlidersHorizontal,
  Clapperboard,
  Tags,
  Backpack,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUI, type WindowType } from '../../store';

const items: { type: WindowType; label: string; icon: LucideIcon; gmOnly?: boolean; playerOnly?: boolean }[] = [
  { type: 'characters', label: '角色', icon: Users },
  { type: 'tag-library', label: '标签', icon: Tags, gmOnly: true },
  { type: 'sheet', label: '字段', icon: SlidersHorizontal },
  { type: 'maps', label: '地图', icon: Map },
  { type: 'presentation', label: '导演台', icon: Clapperboard },
  { type: 'private-clues', label: '私密线索', icon: Mail },
  { type: 'combat', label: '战斗', icon: Swords },
  { type: 'dice', label: '骰子', icon: Dices },
  { type: 'items', label: '物品', icon: Boxes, gmOnly: true },
  { type: 'inventory', label: '背包', icon: Backpack, playerOnly: true },
  { type: 'templates', label: '能力', icon: BookOpen, gmOnly: true },
  { type: 'quests', label: '任务', icon: Shield },
  { type: 'logs', label: '日志', icon: ScrollText },
  { type: 'drawing', label: '画笔', icon: Brush },
  { type: 'settings', label: '设置', icon: Settings },
];

export default function RoomSidebar({ isGM, unreadCount }: { isGM: boolean; unreadCount: number }) {
  const navigate = useNavigate(),
    toggle = useUI((s) => s.toggle);
  const visible = useUI((s) =>
    s.windows
      .filter((w) => !w.minimized && w.entityId === undefined)
      .map((w) => w.type)
      .join(','),
  );
  const active = new Set(visible.split(','));
  return (
    <aside className="game-rail z-10">
      <button className="rail-emblem" title="冒险大厅" onClick={() => navigate('/rooms')}>
        ✦
      </button>
      <div className="rail-divider" />
      {items
        .filter((item) => (!item.gmOnly || isGM) && (!item.playerOnly || !isGM))
        .map(({ type, label, icon: Icon }, index) => (
          <button
            title={type === 'presentation' && !isGM ? '线索图库' : label}
            key={type}
            className={`rail-action ${index === 4 ? 'rail-action-spaced' : ''} ${type === 'private-clues' ? 'clue-rail' : ''}`}
            aria-pressed={active.has(type)}
            onClick={() => toggle(type)}
          >
            <Icon size={20} strokeWidth={1.7} />
            <span>{type === 'presentation' && !isGM ? '线索' : label}</span>
            {type === 'private-clues' && unreadCount > 0 && (
              <span className="clue-rail-badge" aria-label={`${unreadCount} 条未读私密线索`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      <button className="rail-action mt-auto" title="返回大厅" onClick={() => navigate('/rooms')}>
        <LogOut size={19} />
        <span>离开</span>
      </button>
    </aside>
  );
}
