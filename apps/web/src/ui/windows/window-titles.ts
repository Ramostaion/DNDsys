import type { WindowType } from '../../store';

export const titles: Record<WindowType, string> = {
  'private-clues': '私密线索',
  'clue-reader': '私密线索详情',
  'clue-sent': '线索投递回执',
  'clue-image': '私密线索图片',
  characters: '角色',
  character: '人物卡',
  sheet: '字段管理',
  maps: '地图管理',
  portal: '地图入口',
  items: '物品库',
  item: '物品卡',
  inventory: '背包',
  equipment: '装备',
  templates: '能力模板库',
  quests: '任务与日志',
  drawing: '绘画与量尺',
  settings: '房间设置',
  logs: '活动日志',
  combat: '战斗',
  dice: '骰子',
  presentation: '剧情导演台',
  'character-tags': '角色标签',
  'tag-detail': '标签详情',
  'tag-library': '标签库',
  'tag-overview': '角色标签总览',
};

export const windowTitle = (type: WindowType, isGM: boolean) => (type === 'templates' && !isGM ? '能力' : titles[type]);
