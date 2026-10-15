import type { CSSProperties } from 'react';
import { dieGeometry, previewDice, resultOrientation, rolledDice } from './dice-geometry';
import type { DicePart } from '@dnd/shared';
import './dice-stage.css';

export type VisibleRoll = {
  id: string;
  userId: string;
  expression: string;
  reason: string;
  total: number;
  details: DicePart[];
  visibility: string;
  rollerName?: string;
  rollerRole?: string;
};
type Props = {
  roll: VisibleRoll | null;
  expression: string;
  pending: boolean;
  animated: boolean;
  reveal: boolean;
  compact?: boolean;
};

export default function DiceStage({ roll, expression, pending, animated, reveal, compact = false }: Props) {
  const dice = pending || !roll ? previewDice(expression) : rolledDice(roll.details || []);
  const description = pending
    ? '骰子翻滚中，等待服务器结果'
    : roll
      ? dice.map((d) => `D${d.sides}：${d.value}`).join('，') || `结果 ${roll.total}`
      : '等待掷骰';
  return (
    <div
      className={`dice-stage ${pending ? 'is-rolling' : reveal && roll ? 'is-landing' : ''} ${animated ? '' : 'is-still'} ${compact ? 'is-compact' : ''}`}
      data-pending={pending}
    >
      <div className="dice-stage-heading">
        <span>✦ 命运骰盘 ✦</span>
        <span>{pending ? '等待落定' : roll ? '已落定' : '准备掷骰'}</span>
      </div>
      <div className="dice-table" role="img" aria-label={description}>
        {roll && !pending && !dice.length && (
          <div className="dice-no-dice">
            ✦<span>本次仅计算修正值，没有骰子</span>
          </div>
        )}
        {(dice.length ? dice.slice(0, 6) : roll && !pending ? [] : [{ sides: 20, value: undefined, sign: 1 }]).map(
          (die, index) => {
            const faces = dieGeometry(die.sides),
              standard = faces.length === die.sides;
            const front = die.value === undefined ? 0 : standard ? die.value - 1 : 0;
            const orientation = resultOrientation(faces[front]);
            return (
              <div
                className="die-seat"
                key={index}
                style={{ '--die-delay': `${index * 55}ms`, '--die-tilt': `${index % 2 ? 9 : -9}deg` } as CSSProperties}
              >
                <div className="die-shadow" />
                <div className="die-space">
                  <div className="die-flight">
                    <div className="die-tumble">
                      <div className="die-orientation" style={{ transform: orientation }}>
                        {faces.map((face, i) => (
                          <div
                            className={`die-face ${i === front ? 'die-face-result' : ''}`}
                            aria-hidden="true"
                            key={i}
                            style={{
                              transform: face.transform,
                              clipPath: face.polygon,
                              background: `linear-gradient(135deg,hsl(36 57% ${face.shade + 9}%),hsl(27 46% ${face.shade - 8}%))`,
                            }}
                          >
                            <span>{pending || !roll ? '✧' : standard ? i + 1 : i === front ? die.value : '✧'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="die-label">
                  {die.sign < 0 ? '− ' : ''}D{die.sides}
                  {die.value !== undefined && !pending && <strong>{die.value}</strong>}
                </div>
              </div>
            );
          },
        )}
      </div>
      <p className="dice-stage-caption">
        {dice.length > 6
          ? `展示前 6 颗，共 ${dice.length} 颗；完整点数见下方结果`
          : pending
            ? '点数由服务器决定…'
            : roll
              ? '每颗点数来自本次掷骰，修正值计入下方总和'
              : '选择骰子，掷出你的命运'}
      </p>
    </div>
  );
}
