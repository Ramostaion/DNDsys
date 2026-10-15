import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import type { Snapshot } from '../api';

type Props = {
  snap: Snapshot;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};

function QuestCard({ quest, isGM, mutate }: { quest: any; isGM: boolean; mutate: Props['mutate'] }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(quest.name);
  const [description, setDescription] = useState(quest.description);
  const [privateNote, setPrivateNote] = useState(quest.privateNote || '');
  const [stages, setStages] = useState<string[]>(quest.stages || []);
  const [progress, setProgress] = useState(String(quest.progress));
  const [isPublic, setIsPublic] = useState(quest.isPublic);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) {
      setName(quest.name);
      setDescription(quest.description);
      setPrivateNote(quest.privateNote || '');
      setStages(quest.stages || []);
      setProgress(String(quest.progress));
      setIsPublic(quest.isPublic);
    }
  }, [quest.version, editing]);
  const current = (quest.stages || [])[quest.stageIndex];
  async function update(patch: Record<string, unknown>) {
    try {
      setError('');
      await mutate('quest.update', { id: quest.id, version: quest.version, patch });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function save() {
    if (!name.trim()) {
      setError('请输入任务名称');
      return;
    }
    const value = Number(progress);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      setError('任务进度需在 0–100 之间');
      return;
    }
    if (stages.some((s) => !s.trim())) {
      setError('阶段名称不能为空');
      return;
    }
    if (
      await update({
        name: name.trim(),
        description,
        privateNote,
        stages: stages.map((s) => s.trim()),
        progress: value,
        isPublic,
      })
    )
      setEditing(false);
  }
  return (
    <article className={`quest-card ${quest.status === 'DONE' ? 'quest-complete' : ''}`}>
      <div className="flex justify-between gap-3 items-start">
        <div>
          <div className="eyebrow">
            {quest.status === 'DONE' ? 'QUEST COMPLETE' : quest.isPublic ? 'PARTY QUEST' : 'GM ONLY'}
          </div>
          <h3 className="display-title text-xl mt-1">{quest.name}</h3>
        </div>
        <span className="badge">{quest.status === 'DONE' ? '已完成' : '进行中'}</span>
      </div>
      <p className="text-sm subtle mt-3 whitespace-pre-wrap">{quest.description || '这个故事尚未写下说明。'}</p>
      {isGM && quest.privateNote && (
        <div className="grid-card tiny mt-3">
          <strong className="text-amber-300">GM 私密备注</strong>
          <p className="whitespace-pre-wrap mt-1">{quest.privateNote}</p>
        </div>
      )}
      {quest.stages?.length > 0 && (
        <div className="quest-stage">
          <span className="tiny text-amber-300">
            第 {quest.stageIndex + 1} / {quest.stages.length} 阶段
          </span>
          <strong>{current || '尚未开始'}</strong>
        </div>
      )}
      <div className="quest-progress">
        <div style={{ width: `${Math.max(0, Math.min(100, quest.progress))}%` }} />
      </div>
      <div className="tiny subtle text-right mt-1">进度 {quest.progress}%</div>
      {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
      {isGM && (
        <>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="btn" onClick={() => setEditing(!editing)}>
              {editing ? '收起编辑' : '编辑任务'}
            </button>
            <button
              className="btn"
              disabled={quest.stageIndex <= 0}
              onClick={() => void update({ stageIndex: quest.stageIndex - 1 })}
            >
              <ChevronLeft size={14} /> 上一阶段
            </button>
            <button
              className="btn"
              disabled={quest.stageIndex >= quest.stages.length - 1}
              onClick={() => void update({ stageIndex: quest.stageIndex + 1 })}
            >
              下一阶段 <ChevronRight size={14} />
            </button>
            <button className="btn" onClick={() => void update({ status: quest.status === 'DONE' ? 'OPEN' : 'DONE' })}>
              {quest.status === 'DONE' ? (
                <>
                  <RotateCcw size={14} /> 重新开启
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} /> 标记完成
                </>
              )}
            </button>
          </div>
          {editing && (
            <div className="quest-editor mt-4 space-y-3">
              <label className="block">
                <span className="label">任务名称</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">任务说明</span>
                <textarea
                  className="input min-h-20"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">GM 私密备注（玩家不会收到）</span>
                <textarea
                  className="input min-h-20"
                  value={privateNote}
                  onChange={(e) => setPrivateNote(e.target.value)}
                />
              </label>
              <div>
                <span className="label">阶段列表</span>
                {stages.map((stage, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input
                      className="input"
                      value={stage}
                      onChange={(e) => setStages(stages.map((s, i) => (i === index ? e.target.value : s)))}
                    />
                    <button
                      className="btn"
                      title="删除阶段"
                      onClick={() => setStages(stages.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button className="btn" onClick={() => setStages([...stages, ''])}>
                  <Plus size={14} /> 添加阶段
                </button>
              </div>
              <div className="flex items-end gap-3">
                <label className="block w-28">
                  <span className="label">进度 %</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => setProgress(e.target.value)}
                  />
                </label>
                <label className="flex gap-2 items-center pb-2 text-sm">
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                  玩家可见
                </label>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={() => void save()}>
                  保存任务
                </button>
                <button
                  className="btn btn-danger ml-auto"
                  onClick={() => confirm(`删除任务“${quest.name}”？`) && void mutate('quest.delete', { id: quest.id })}
                >
                  删除
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export default function QuestJournal({ p }: { p: Props }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const visible = p.snap.quests.filter((q) => q.isPublic || p.isGM);
  return (
    <div className="space-y-4">
      <div className="eyebrow">ADVENTURE JOURNAL</div>
      <p className="subtle text-sm">记录目标、剧情阶段与小队进度。</p>
      {p.isGM && (
        <div className="panel rounded-lg p-3 flex gap-2">
          <input className="input" placeholder="新的任务名称" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                setError('');
                await p.mutate('quest.create', { name: name.trim(), stages: [] });
                setName('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Plus size={15} /> 创建
          </button>
        </div>
      )}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <div className="space-y-3">
        {visible.map((q) => (
          <QuestCard key={q.id} quest={q} isGM={p.isGM} mutate={p.mutate} />
        ))}
      </div>
      {visible.length === 0 && <div className="empty-note">任务手册还是空白的。</div>}
    </div>
  );
}
