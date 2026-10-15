import { agilityContestBase, type AgilityContest, type ContestParticipant } from '@dnd/shared';
import AgilityBonusInfo from './AgilityBonusInfo';

function Participant({
  side,
  label,
  version,
}: {
  side: ContestParticipant;
  label: string;
  version: AgilityContest['version'];
}) {
  const calculation = `${side.base}${side.modifiers.map((change) => ` ${change.amount < 0 ? '−' : '+'} ${Math.abs(change.amount)}`).join('')}`;
  return (
    <div className="contest-side">
      <strong>
        {label}：{side.isNpc ? 'NPC ' : '玩家 '}
        {side.name}
      </strong>
      <dl>
        <div>
          <dt>基础敏捷</dt>
          <dd>{side.base}</dd>
        </div>
        {side.modifiers.map((change, index) => (
          <div key={index}>
            <dt>
              {change.itemKind ||
                { equipment: '装备', trait: '特性', buff: '状态', custom: '其他' }[change.kind || 'custom']}{' '}
              · {change.name}
            </dt>
            <dd className={change.amount < 0 ? 'text-red-300' : 'text-emerald-300'}>
              {change.amount >= 0 ? '+' : ''}
              {change.amount}
            </dd>
          </div>
        ))}
        {!side.modifiers.length && (
          <div>
            <dt>生效修正</dt>
            <dd>无</dd>
          </div>
        )}
        <div>
          <dt>当前有效敏捷</dt>
          <dd>
            {side.effective}
            {side.rawEffective < 1 && '（最低 1）'}
          </dd>
        </div>
        <div>
          <dt>
            敏捷属性加值
            <AgilityBonusInfo side={side} version={version} />
          </dt>
          <dd>
            {side.bonus >= 0 ? '+' : ''}
            {side.bonus}
          </dd>
        </div>
        <div>
          <dt>D20 点数</dt>
          <dd>{side.d20}</dd>
        </div>
      </dl>
      <p className="tiny text-sky-200 mt-2">
        敏捷计算：MAX(1, {calculation}) = {side.effective}
      </p>
      {version === 3 && (
        <p className="tiny text-sky-200 mt-2">
          判定底值：{side.effective} {side.bonus < 0 ? '−' : '+'} {Math.abs(side.bonus)} ={' '}
          {agilityContestBase(side, version)}
        </p>
      )}
      <p className="contest-equation">
        {version === 4 && 'MAX(1, '}
        {agilityContestBase(side, version)} + {side.d20}
        {version === 4 && ')'} = <strong>{side.total}</strong>
      </p>
      {version === 4 && side.bonus + side.d20 <= 0 && (
        <p className="tiny subtle">计算结果 {side.bonus + side.d20} ≤ 0，按 1 计算。</p>
      )}
    </div>
  );
}

export default function AgilityResult({ contest, recordId }: { contest: AgilityContest; recordId: string }) {
  return (
    <section
      className={`agility-result ${contest.hit ? 'is-hit' : 'is-dodge'}`}
      aria-label="战斗判定结果"
      data-record-id={recordId}
    >
      <h3>战斗判定结果：{contest.hit ? '攻击命中' : '成功闪避'}</h3>
      <div className="contest-sides">
        <Participant side={contest.attacker} label="攻击方" version={contest.version} />
        <Participant side={contest.defender} label="防御方" version={contest.version} />
      </div>
      <p className="contest-comparison">最终对抗：{contest.comparison}</p>
      <p>{contest.reason}</p>
      <p className="tiny subtle">
        {contest.version === 4
          ? '判定值 = MAX(1, 敏捷属性加值 + D20)。'
          : contest.version === 3
            ? '历史规则：判定值 = 有效敏捷 + 敏捷属性加值 + D20。'
            : contest.version === 2
              ? '历史规则：判定值 = 敏捷属性加值 + D20。'
              : '历史规则：判定值 = 完整有效敏捷 + D20。'}
        伤害与资源由 GM 人工裁决。
      </p>
      <footer className="tiny subtle">
        {new Date(contest.resolvedAt).toLocaleString()} ·{' '}
        {contest.broadcast.status === 'SENT'
          ? '广播已发出'
          : contest.broadcast.status === 'FAILED'
            ? '广播未发出，结果已保存'
            : '广播状态未确认'}
        {contest.broadcast.scope === 'GM' && '（仅 GM）'}
      </footer>
    </section>
  );
}
