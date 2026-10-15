import { array, object } from '../data.js';
import { fail as bad } from '../http.js';
import { json, str, required, gm, version } from './helpers.js';
import type { OperationContext } from './context.js';

export async function questOperation(context: OperationContext) {
  const { tx, member, roomId, p } = context;
  let data: any;
  switch (context.type) {
    case 'quest.create': {
      gm(member!);
      const stages = array(p.stages).map((value) => required(value, '阶段名称'));
      if (stages.length > 50) bad(400, '任务阶段过多');
      data = await tx.quest.create({
        data: {
          roomId,
          name: required(p.name, '任务名'),
          description: str(p.description).slice(0, 5000),
          privateNote: str(p.privateNote).slice(0, 5000),
          stages: json(stages),
          isPublic: p.isPublic !== false,
        },
      });
      break;
    }
    case 'quest.update': {
      gm(member!);
      const quest = await tx.quest.findFirst({ where: { id: str(p.id), roomId } });
      if (!quest) bad(404, '任务不存在');
      version(quest!.version, p.version);
      const patch = object(p.patch),
        update: any = { version: { increment: 1 } };
      for (const key of [
        'name',
        'description',
        'privateNote',
        'status',
        'progress',
        'stageIndex',
        'stages',
        'isPublic',
      ])
        if (key in patch) {
          if (key === 'name') update.name = required(patch.name, '任务名');
          else if (key === 'description') update.description = str(patch.description).slice(0, 5000);
          else if (key === 'privateNote') update.privateNote = str(patch.privateNote).slice(0, 5000);
          else if (key === 'status') {
            if (!['OPEN', 'DONE'].includes(str(patch.status))) bad(400, '任务状态无效');
            update.status = patch.status;
          } else if (key === 'progress') {
            const value = Number(patch.progress);
            if (!Number.isInteger(value) || value < 0 || value > 100) bad(400, '任务进度需在 0–100 之间');
            update.progress = value;
          } else if (key === 'stages') {
            const stages = array(patch.stages).map((value) => required(value, '阶段名称'));
            if (stages.length > 50) bad(400, '任务阶段过多');
            update.stages = json(stages);
          } else if (key === 'stageIndex') {
            const value = Number(patch.stageIndex),
              stages = 'stages' in patch ? array(patch.stages) : array(quest!.stages);
            if (!Number.isInteger(value) || value < 0 || value > Math.max(0, stages.length - 1))
              bad(400, '任务阶段超出范围');
            update.stageIndex = value;
          } else if (key === 'isPublic') update.isPublic = patch.isPublic === true;
        }
      if (
        'stages' in patch &&
        !('stageIndex' in patch) &&
        quest!.stageIndex > Math.max(0, array(patch.stages).length - 1)
      )
        update.stageIndex = Math.max(0, array(patch.stages).length - 1);
      data = await tx.quest.update({ where: { id: quest!.id }, data: update });
      break;
    }
    case 'quest.delete': {
      gm(member!);
      const quest = await tx.quest.findFirst({ where: { id: str(p.id), roomId } });
      if (!quest) bad(404, '任务不存在');
      await tx.quest.delete({ where: { id: quest!.id } });
      data = { id: quest!.id };
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
