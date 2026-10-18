import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { agilityBonus, agilityContestBase, type AgilityContest, type ContestParticipant } from '@dnd/shared';
import './agility-bonus-info.css';

const ranges = [
  [0, 2],
  [3, 4],
  [5, 6],
  [7, 9],
  [10, 12],
  [13, 15],
  [16, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;

export default function AgilityBonusInfo({
  side,
  version,
}: {
  side: ContestParticipant;
  version: AgilityContest['version'];
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const cancelHide = () => clearTimeout(timer.current);
  const show = () => {
    cancelHide();
    setOpen(true);
  };
  const hide = () => {
    cancelHide();
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      if (!button.current || !tooltip.current) return;
      const anchor = button.current.getBoundingClientRect(),
        box = tooltip.current.getBoundingClientRect();
      const above = Math.max(0, anchor.top - 20),
        below = Math.max(0, window.innerHeight - anchor.bottom - 20);
      const upwards = box.height > below && above > below;
      const maxHeight = upwards ? above : below;
      setPosition({
        left: Math.max(
          12,
          Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 12),
        ),
        top: upwards ? anchor.top - 8 - Math.min(box.height, maxHeight) : anchor.bottom + 8,
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const matched = ranges.findIndex(([, high]) => side.effective <= high);
  const calculation = `${side.base}${side.modifiers.map((change) => ` ${change.amount < 0 ? '−' : '+'} ${Math.abs(change.amount)}`).join('')}`;
  const operand = agilityContestBase(side, version);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="agility-bonus-trigger"
        aria-label={`${side.name}的${side.attributeName || '敏捷'}属性加值说明`}
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            cancelHide();
            setOpen(false);
          }
        }}
      >
        <Info size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            id={id}
            role="tooltip"
            aria-label="敏捷加值表与计算过程"
            className="agility-bonus-tooltip"
            style={position ? position : { left: 12, top: 12, visibility: 'hidden' }}
            onPointerEnter={cancelHide}
            onPointerLeave={hide}
          >
            <strong>{side.attributeName || '敏捷'}属性加值表（沿用敏捷算法）</strong>
            <table>
              <thead>
                <tr>
                  <th>当前有效{side.attributeName || '敏捷'}</th>
                  <th>属性加值</th>
                </tr>
              </thead>
              <tbody>
                {ranges.map(([low, high], index) => (
                  <tr key={low} className={matched === index ? 'is-current' : undefined}>
                    <td>
                      {low}–{high}
                      {matched === index && '（本次）'}
                    </td>
                    <td>{signed(agilityBonus(low))}</td>
                  </tr>
                ))}
                <tr className={matched < 0 ? 'is-current' : undefined}>
                  <td>更高敏捷</td>
                  <td>每增加 2 点，加值 +1</td>
                </tr>
              </tbody>
            </table>
            <p>超过 20：4 + floor((敏捷 − 21) / 2)</p>
            <strong>{side.name} · 本次计算</strong>
            <p>
              有效{side.attributeName || '敏捷'}：MAX(1, {calculation}) = {side.effective}
            </p>
            <p>
              查表：{side.attributeName || '敏捷'} {side.effective} → 加值 {signed(side.bonus)}
            </p>
            {side.effective > 20 && (
              <p>
                加值计算：4 + floor(({side.effective} − 21) / 2) = {side.bonus}
              </p>
            )}
            <p>
              {version === 4 ? '最终判定' : '当时判定'}：{version === 4 && 'MAX(1, '}
              {operand} + {side.d20}
              {version === 4 && ')'} = {side.total}
            </p>
            {version === 4 && side.bonus + side.d20 <= 0 && <p>相加得 {side.bonus + side.d20} ≤ 0，按 1 计算。</p>}
            {version !== 4 && <p>历史记录沿用当时的判定公式。</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
