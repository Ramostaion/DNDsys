import type { Snapshot } from '../api';
const labels: Record<string, string> = {
  'character.create': '创建角色',
  'character.update': '修改人物卡',
  'character.copy': '复制角色',
  'character.delete': '删除角色',
  'character.field.set': '修改人物字段',
  'character.field.adjust': '调整人物数值',
  'sheet.health.configure': '设置生命与生命上限',
  'sheet.field.upsert': '保存人物卡字段',
  'sheet.field.remove': '删除人物卡字段',
  'map.create': '创建地图',
  'map.update': '修改地图',
  'map.delete': '删除地图',
  'map.activate': '切换当前地图',
  'portal.create': '创建地图入口',
  'portal.update': '修改地图入口',
  'portal.delete': '删除地图入口',
  'token.create': '放置角色棋子',
  'token.copy': '复制角色棋子',
  'token.move': '移动角色棋子',
  'token.delete': '不显示当前地图人物',
  'item.create': '创建物品',
  'item.update': '修改物品',
  'item.delete': '删除物品',
  'inventory.add': '物品加入背包',
  'inventory.move': '整理背包格子',
  'inventory.update': '调整背包物品数量',
  'inventory.instance.update': '修改背包物品备注',
  'inventory.transfer': '转移背包物品',
  'inventory.loot': '拾取归零角色物品',
  'trade.offer': '发起交易',
  'trade.accept': '接受交易',
  'trade.decline': '拒绝交易',
  'trade.cancel': '取消交易',
  'equipment.set': '调整装备',
  'template.create': '创建能力或状态模板',
  'template.update': '修改能力或状态模板',
  'template.delete': '删除模板',
  'template.apply': '安装能力或状态',
  'template.enable': '启用或停用能力或状态',
  'template.remove': '移除能力或状态',
  'quest.create': '创建任务',
  'quest.update': '更新任务',
  'quest.delete': '删除任务',
  'drawing.add': '添加地图绘画或量尺',
  'drawing.undo': '撤回地图绘画',
  'drawing.erase': '擦除完整笔画',
  'drawing.history.undo': '撤销地图绘画或擦除',
  'drawing.history.redo': '重做地图绘画或擦除',
  'drawing.update': '调整地图量尺',
  'dice.roll': '掷骰',
  'combat.start': '建立遭遇',
  'combat.advance': '推进行动焦点',
  'combat.initiative': '调整旧版先攻',
  'combat.focus': '选择行动角色',
  'combat.order': '调整行动顺序',
  'combat.round': '调整遭遇轮次',
  'combat.add': '角色加入遭遇',
  'combat.remove': '角色离开遭遇',
  'combat.end': '结束遭遇',
  'combat.hp': '记录生命变化',
  'combat.attack': '记录旧版攻击',
  'combat.record': '追加人工裁决记录',
  'combat.correct': '更正裁决记录',
  'tagDefinition.create': '新建标签定义',
  'tagDefinition.update': '修改标签定义',
  'tagDefinition.delete': '删除标签定义',
  'tagDefinition.archive': '归档标签定义',
  'tagDefinition.restore': '恢复标签定义',
  'characterTag.create': '添加角色标签',
  'characterTag.attach': '添加角色标签',
  'characterTag.attachBatch': '批量添加角色标签',
  'characterTag.detach': '移除角色标签',
  'characterTag.update': '修改角色标签备注',
  'characterTag.delete': '移除角色标签',
};
export const activityLabel = (action: string) => labels[action] || '更新房间内容';
export default function ActivityLogs({ snap }: { snap: Snapshot }) {
  return (
    <div className="activity-logs space-y-2">
      {snap.logs.map((log) => {
        const actor = snap.members.find((member) => member.userId === log.userId)?.user.username || '已离开的成员';
        const entity = [
          ...snap.characters,
          ...snap.maps,
          ...snap.items,
          ...snap.templates,
          ...snap.quests,
          ...snap.tagDefinitions,
          ...snap.portals,
        ].find((entity) => entity.id === log.entityId);
        const token = snap.tokens.find((token) => token.id === log.entityId),
          character = token && snap.characters.find((character) => character.id === token.characterId);
        const name = entity?.name || entity?.title || entity?.label || character?.name;
        const field = snap.room.sheetSchema?.find((field: any) => field.fieldId === log.data?.fieldId);
        return (
          <details key={log.id} className="grid-card text-sm activity-event">
            <summary>
              <span className="activity-chevron" aria-hidden="true">
                ›
              </span>
              <span className="flex-1">{activityLabel(log.action)}</span>
              <time className="tiny subtle">{new Date(log.createdAt).toLocaleTimeString()}</time>
            </summary>
            <div className="activity-detail">
              <p>
                {actor} · {activityLabel(log.action)}
                {name ? `：${name}` : ''}
              </p>
              {field && <p>字段：{field.name}</p>}
              {log.data?.previousValue !== undefined && log.data?.newValue !== undefined && (
                <p>
                  原值：{String(log.data.previousValue)} → 新值：{String(log.data.newValue)}
                </p>
              )}
              {log.data?.reason && <p>原因：{log.data.reason}</p>}
              <time className="tiny subtle">{new Date(log.createdAt).toLocaleString()}</time>
            </div>
          </details>
        );
      })}
      {!snap.logs.length && <p className="subtle">暂时没有活动记录。</p>}
    </div>
  );
}
