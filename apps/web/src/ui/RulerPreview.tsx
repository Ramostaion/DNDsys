import { forwardRef } from 'react';
import { Group, Line, Circle, Rect, Wedge, Text } from 'react-konva';
import type Konva from 'konva';

export default forwardRef<
  Konva.Group,
  { shape: string; length: number; angle: number; distance: number; scale: number }
>(function RulerPreview({ shape, length, angle, distance, scale }, ref) {
  const common = {
    stroke: '#ebc98b',
    strokeWidth: 1.5 / scale,
    dash: [5 / scale, 4 / scale],
    fill: '#c6a76a16',
    listening: false,
  };
  const side = length / Math.SQRT2;
  return (
    <Group ref={ref} name="ruler-preview" visible={false} listening={false} opacity={0.75}>
      {shape === 'LINE' && <Line points={[0, 0, length, 0]} {...common} />}
      {shape === 'CIRCLE' && <Circle radius={length / 2} {...common} />}
      {shape === 'SQUARE' && <Rect x={-side / 2} y={-side / 2} width={side} height={side} {...common} />}
      {shape === 'CONE' && <Wedge radius={length} angle={angle} rotation={-angle / 2} {...common} />}
      <Circle radius={4 / scale} fill="#ebc98b" />
      <Text
        text={`${distance} 尺 · 点击放置`}
        x={8 / scale}
        y={8 / scale}
        fontSize={11 / scale}
        fill="#f3d9a7"
        shadowColor="#000"
        shadowBlur={3}
      />
    </Group>
  );
});
