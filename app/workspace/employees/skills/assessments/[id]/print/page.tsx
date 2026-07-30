import { notFound, redirect } from 'next/navigation';
import SkillPrintToolbar from '@/components/SkillPrintToolbar';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { skillAssessmentInclude } from '@/lib/skills';
import '../../../skill-print.css';

export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  RETURNED: '已退回',
  APPROVED: '已通过',
  CANCELLED: '已取消',
};

const resultLabel: Record<string, string> = {
  PENDING: '待形成',
  PASSED: '通过',
  FAILED: '未通过',
};

function formatDate(value: Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(value);
}

export default async function SkillAssessmentPrintPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await currentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/workspace/employees/skills/assessments/${params.id}/print`)}`);
  }

  const assessment = await prisma.skillAssessment.findUnique({
    where: { id: params.id },
    include: skillAssessmentInclude,
  });
  if (!assessment) notFound();

  const relatedEmployees = await prisma.employee.findMany({
    where: { id: { in: [assessment.assessorId, assessment.reviewerId] } },
  });
  const assessor = relatedEmployees.find(employee => employee.id === assessment.assessorId);
  const reviewer = relatedEmployees.find(employee => employee.id === assessment.reviewerId);
  const answersByItem = new Map(assessment.answers.map(answer => [answer.itemId, answer]));

  return (
    <>
      <SkillPrintToolbar />
      <main className="skill-print-page">
        <header className="skill-print-header">
          <div>
            <p className="skill-print-brand">杭连电子 · 人事管理</p>
            <h1>员工岗位技能考核记录表</h1>
            <p>{assessment.template.name} · 系统归档版</p>
          </div>
          <div className="skill-print-code">
            <small>考核编号 / 模板版本</small>
            <strong>{assessment.code} · V{assessment.templateVersion}</strong>
          </div>
        </header>

        <section className="skill-print-meta">
          <div><small>部门</small><strong>{assessment.employee.department || assessment.template.department}</strong></div>
          <div><small>岗位</small><strong>{assessment.employee.position || assessment.template.position}</strong></div>
          <div><small>班组</small><strong>{assessment.employee.team || assessment.template.team || '—'}</strong></div>
          <div><small>考核技能</small><strong>{assessment.skill.name}</strong></div>
          <div><small>目标等级</small><strong>L{assessment.proposedLevel}</strong></div>
          <div><small>合格线 / 有效期</small><strong>{assessment.template.passScore} 分 / {assessment.template.validityMonths} 个月</strong></div>
          <div><small>被考核员工</small><strong>{assessment.employee.name}</strong></div>
          <div><small>员工编号</small><strong>{assessment.employee.employeeNo}</strong></div>
          <div><small>提交日期</small><strong>{formatDate(assessment.submittedAt)}</strong></div>
          <div><small>现场考核人</small><strong>{assessor?.name || '人员记录缺失'}</strong></div>
          <div><small>审核人</small><strong>{reviewer?.name || '人员记录缺失'}</strong></div>
          <div><small>审核日期</small><strong>{formatDate(assessment.reviewedAt)}</strong></div>
        </section>

        <section className="skill-print-section">
          <div className="skill-print-section-heading">
            <h2>考核项目与评分记录</h2>
            <span>系统记录生成，评分修改应保留流程痕迹</span>
          </div>
          {assessment.template.instructions && <p className="skill-print-instructions">{assessment.template.instructions}</p>}
          <table className="skill-print-table">
            <colgroup>
              <col style={{ width: '10mm' }} />
              <col style={{ width: '24mm' }} />
              <col />
              <col style={{ width: '14mm' }} />
              <col style={{ width: '14mm' }} />
              <col style={{ width: '17mm' }} />
              <col style={{ width: '28mm' }} />
              <col style={{ width: '58mm' }} />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>考核分区</th>
                <th>考核项目与评分标准</th>
                <th>权重</th>
                <th>满分</th>
                <th>实得分</th>
                <th>红线项</th>
                <th>考核评语</th>
              </tr>
            </thead>
            <tbody>
              {assessment.template.items.map((item, index) => {
                const answer = answersByItem.get(item.id);
                return (
                  <tr key={item.id}>
                    <td className="center">{index + 1}</td>
                    <td>{item.section}</td>
                    <td>
                      {item.title}
                      {item.description && <><br /><small>{item.description}</small></>}
                    </td>
                    <td className="center">{item.weight}%</td>
                    <td className="center">{item.maxScore}</td>
                    <td className="center">{answer?.score ?? '—'}</td>
                    <td className="center">{item.isCritical ? (answer?.passed === false ? '未通过' : answer?.passed === true ? '通过' : '待确认') : '—'}</td>
                    <td>{answer?.comment || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="skill-print-section">
          <div className="skill-print-section-heading"><h2>考核结论</h2></div>
          <div className="skill-print-result">
            <div><small>总分</small><strong>{assessment.totalScore ?? '—'} / 100</strong></div>
            <div><small>建议技能等级</small><strong>L{assessment.proposedLevel}</strong></div>
            <div><small>状态 / 结果</small><strong>{statusLabel[assessment.status] || assessment.status} / {resultLabel[assessment.result] || assessment.result}</strong></div>
          </div>
          <div className="skill-print-result">
            <div style={{ gridColumn: '1 / -1' }}><small>审核意见 / 改进要求</small><strong>{assessment.reviewComment || '无'}</strong></div>
          </div>
        </section>

        <section className="skill-print-signatures">
          <div>被考核人：{assessment.employee.name}<br />签字 / 日期：</div>
          <div>现场考核人：{assessor?.name || '—'}<br />签字 / 日期：</div>
          <div>审核人：{reviewer?.name || '—'}<br />签字 / 日期：</div>
        </section>

        <section className="skill-print-section">
          <div className="skill-print-section-heading"><h2>流程记录</h2><span>最近 {assessment.activities.length} 条</span></div>
          <ul className="skill-print-audit">
            {assessment.activities.length ? assessment.activities.map(activity => (
              <li key={activity.id}>
                <strong>{activity.action}</strong>
                <span>{activity.content || `${activity.fromStatus || '—'} → ${activity.toStatus || '—'}`}</span>
                <time>{formatDate(activity.createdAt, true)}</time>
              </li>
            )) : <li><strong>暂无记录</strong><span>当前考核尚未发生流程操作</span><time>—</time></li>}
          </ul>
        </section>

        <footer className="skill-print-footer">
          <span>认证有效期：{formatDate(assessment.validFrom)} 至 {formatDate(assessment.expiresAt)}</span>
          <span>记录更新：{formatDate(assessment.updatedAt, true)}</span>
          <span>打印件须与系统记录一致</span>
        </footer>
      </main>
    </>
  );
}
