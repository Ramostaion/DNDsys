import {
  Search,
  EyeOff,
  Skull,
  Handshake,
  Flag,
  CheckSquare,
  Star,
  KeyRound,
  BookOpen,
  Heart,
  Shield,
  Flame,
} from 'lucide-react';
import { TAG_ICONS, TAG_COLORS, type TagVisibility } from '@dnd/shared';
const icons = {
  clue: Search,
  secret: EyeOff,
  curse: Skull,
  relation: Handshake,
  event: Flag,
  todo: CheckSquare,
  star: Star,
  key: KeyRound,
  book: BookOpen,
  heart: Heart,
  shield: Shield,
  flame: Flame,
};
export const iconNames: Record<string, string> = {
  clue: '线索',
  secret: '秘密',
  curse: '诅咒',
  relation: '关系',
  event: '事件',
  todo: '待办',
  star: '星辰',
  key: '钥匙',
  book: '书籍',
  heart: '心',
  shield: '盾',
  flame: '火焰',
};
export const visibilityNames: Record<TagVisibility, string> = {
  GM_ONLY: '仅 GM 可见',
  OWNER: '角色控制者与 GM',
  PUBLIC: '全房间公开',
};
export function TagIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Icon = icons[icon as keyof typeof icons];
  return Icon ? (
    <Icon size={size} />
  ) : (
    <span className="tag-emoji" style={{ fontSize: size }}>
      {icon}
    </span>
  );
}
export function VisibilitySelect({
  value,
  onChange,
  label = '标签可见范围',
}: {
  value: TagVisibility;
  onChange: (v: TagVisibility) => void;
  label?: string;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select
        className="input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as TagVisibility)}
      >
        {Object.entries(visibilityNames).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function IconPicker({
  icon,
  color,
  onIcon,
  onColor,
}: {
  icon: string;
  color: string;
  onIcon: (v: string) => void;
  onColor: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <span className="label">标签图标与颜色</span>
      <div className="tag-icon-picker">
        {TAG_ICONS.map((key) => (
          <button
            type="button"
            title={iconNames[key]}
            aria-label={`图标：${iconNames[key]}`}
            aria-pressed={icon === key}
            key={key}
            className={icon === key ? 'selected' : ''}
            style={{ color }}
            onClick={() => onIcon(key)}
          >
            <TagIcon icon={key} size={22} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input !w-28"
          aria-label="自定义 emoji"
          placeholder="或输入 emoji"
          value={TAG_ICONS.includes(icon as (typeof TAG_ICONS)[number]) ? '' : icon}
          maxLength={16}
          onChange={(e) => onIcon(e.target.value)}
        />
        {TAG_COLORS.map((value) => (
          <button
            type="button"
            key={value}
            className="tag-color-swatch"
            aria-label={`颜色 ${value}`}
            aria-pressed={color === value}
            style={{ backgroundColor: value }}
            onClick={() => onColor(value)}
          />
        ))}
        <input type="color" aria-label="标签颜色" value={color} onChange={(e) => onColor(e.target.value)} />
        <span className="tag-symbol-preview" style={{ color, borderColor: color }}>
          <TagIcon icon={icon} size={22} />
        </span>
      </div>
    </div>
  );
}
