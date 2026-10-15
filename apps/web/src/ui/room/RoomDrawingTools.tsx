import type { RoomPanelProps as Props } from './types';
import DrawingHistoryControls from '../DrawingHistoryControls';

export default function Drawing({ p }: { p: Props }) {
  const active = p.snap.maps.find((m) => m.id === p.snap.room.activeMapId);
  return (
    <div>
      <p className="subtle text-sm">
        地图左下角可选画笔、橡皮擦和量尺。橡皮擦按完整笔画擦除，点击或按住拖过即可，按 Esc 取消尚未提交的擦除。
        量尺支持直线、圆形、方形、锥形；点击地图放置，拖动移动，悬停滚轮旋转。 双击显示选框、删除 × 和旋转端点；创建者或
        GM 可删除。靠近头像时原点吸附圆形边缘，不改变量尺长度。不同创建者以颜色区分，悬停查看姓名。
      </p>
      <div className="mt-4">当前地图：{active?.name || '无'}</div>
      <div className="tiny subtle mt-1">
        比例尺：{active?.scalePixels || 100} 像素 = {active?.scaleUnits || 5} 尺
      </div>
      <DrawingHistoryControls snap={p.snap} userId={p.me.id} mutate={p.mutate} />
      <p className="tiny subtle mt-2">
        撤销、重做仅作用于自己在当前地图的绘画与擦除。撤销后重新落笔或擦除，会清空重做记录；量尺不受影响。
      </p>
    </div>
  );
}
