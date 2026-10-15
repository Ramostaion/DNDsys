import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dieGeometry, previewDice, resultOrientation, rolledDice } from './dice-geometry';
import DiceStage, { type VisibleRoll } from './DiceStage';

describe('3D 骰子的真实结果展示', () => {
  for (const sides of [4, 6, 8, 10, 12, 20])
    it(`D${sides} 有 ${sides} 个面，任意结果面都朝向镜头`, () => {
      const faces = dieGeometry(sides);
      expect(faces).toHaveLength(sides);
      for (const face of faces) {
        const matrix = resultOrientation(face).slice(9, -1).split(',').map(Number);
        const projected = [0, 1, 2].map((row) =>
          face.normal.reduce((sum, n, column) => sum + n * matrix[column * 4 + row], 0),
        );
        expect(projected[0]).toBeCloseTo(0);
        expect(projected[1]).toBeCloseTo(0);
        expect(projected[2]).toBeCloseTo(1);
        expect(face.transform).not.toContain('NaN');
        expect(face.polygon).not.toContain('NaN');
      }
    });
  it('解析服务器的每颗骰子，保留减号，不把修正值当成骰子', () => {
    expect(
      rolledDice([
        { kind: 'dice', label: '2d6', sign: 1, value: 8, rolls: [2, 6] },
        { kind: 'constant', label: '3', sign: 1, value: 3 },
        { kind: 'dice', label: '1D37', sign: -1, value: 19, rolls: [19] },
      ]),
    ).toEqual([
      { sides: 6, value: 2, sign: 1 },
      { sides: 6, value: 6, sign: 1 },
      { sides: 37, value: 19, sign: -1 },
    ]);
    expect(previewDice('2d6 + 力量 - 1d37')).toEqual([
      { sides: 6, sign: 1 },
      { sides: 6, sign: 1 },
      { sides: 37, sign: -1 },
    ]);
    expect(previewDice('100d1000')).toHaveLength(6);
    expect(previewDice('1d1001')).toEqual([]);
  });
  const roll: VisibleRoll = {
    id: 'roll',
    userId: 'player',
    expression: '2d6+3',
    reason: '测试',
    total: 11,
    details: [
      { kind: 'dice', label: '2d6', sign: 1, value: 8, rolls: [2, 6] },
      { kind: 'constant', label: '3', sign: 1, value: 3 },
    ],
    visibility: 'PUBLIC',
  };
  it('点数与服务器细节一致，等待时不伪造数字', () => {
    const html = renderToStaticMarkup(
      <DiceStage roll={roll} expression={roll.expression} pending={false} animated reveal />,
    );
    expect(html).toContain('aria-label="D6：2，D6：6"');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('<strong>6</strong>');
    const pending = renderToStaticMarkup(<DiceStage roll={roll} expression="1d20" pending animated reveal={false} />);
    expect(pending).toContain('等待服务器结果');
    expect(pending).not.toContain('<strong>');
    expect(pending).toContain('✧');
  });
  it('大量骰子限制绘制数量，常数表达式不制造骰子', () => {
    const many = {
      ...roll,
      details: [{ kind: 'dice' as const, label: '100d6', sign: 1 as const, value: 600, rolls: Array(100).fill(6) }],
    };
    const html = renderToStaticMarkup(<DiceStage roll={many} expression="100d6" pending={false} animated reveal />);
    expect(html.match(/class="die-seat"/g)).toHaveLength(6);
    expect(html).toContain('共 100 颗');
    const constant = renderToStaticMarkup(
      <DiceStage roll={{ ...roll, details: [], total: 5 }} expression="5" pending={false} animated={false} reveal />,
    );
    expect(constant).toContain('没有骰子');
    expect(constant).not.toContain('class="die-seat"');
  });
});
