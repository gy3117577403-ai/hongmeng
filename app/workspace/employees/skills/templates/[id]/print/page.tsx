import { notFound } from 'next/navigation';
import SkillPrintToolbar from '@/components/SkillPrintToolbar';
import { requirePageAccess } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import '../../../skill-print.css';

export const dynamic = 'force-dynamic';

function formatDate(value: Date | null | undefined): string {
  if (!value) return '____年__月__日';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export default async function SkillTemplatePrintPage({
  params,
}: {
  params: { id: string };
}) {
  const next = `/workspace/employees/skills/templates/${params.id}/print`;
  const user = await requirePageAccess(next);

  const template = await prisma.skillAssessmentTemplate.findUnique({
    where: { id: params.id },
    include: {
      skill: true,
      items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!template) notFound();

  return (
    <>
      <SkillPrintToolbar />
      <main className="skill-print-page">
        <header className="skill-print-header">
          <div>
            <p className="skill-print-brand">杭连电子 · 人事管理</p>
            <h1>员工岗位技能考核记录表</h1>
            <p>{template.name} · 空白现场版</p>
          </div>
          <div className="skill-print-code">
            <small>表单编号 / 版本</small>
            <strong>{template.code} · V{template.version}</strong>
          </div>
        </header>

        <section className="skill-print-meta">
          <div><small>部门</small><strong>{template.department}</strong></div>
          <div><small>岗位</small><strong>{template.position}</strong></div>
          <div><small>班组</small><strong>{template.team || '不限班组'}</strong></div>
          <div><small>考核技能</small><strong>{template.skill?.name || '综合岗位技能'}</strong></div>
          <div><small>目标等级</small><strong>L{template.targetLevel}</strong></div>
          <div><small>合格线 / 有效期</small><strong>{template.passScore} 分 / {template.validityMonths} 个月</strong></div>
          <div><small>被考核员工</small><strong>________________</strong></div>
          <div><small>员工编号</small><strong>________________</strong></div>
          <div><small>考核日期</small><strong>{formatDate(null)}</strong></div>
          <div><small>现场考核人</small><strong>________________</strong></div>
          <div><small>审核人</small><strong>________________</strong></div>
          <div><small>考核地点 / 设备</small><strong>________________</strong></div>
        </section>

        <section className="skill-print-section">
          <div className="skill-print-section-heading">
            <h2>考核项目与评分记录</h2>
            <span>红线项必须通过；总分达到合格线后提交独立审核</span>
          </div>
          {template.instructions && <p className="skill-print-instructions">{template.instructions}</p>}
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
              {template.items.map((item, index) => (
                <tr key={item.id}>
                  <td className="center">{index + 1}</td>
                  <td>{item.section}</td>
                  <td>
                    {item.title}
                    {item.description && <><br /><small>{item.description}</small></>}
                  </td>
                  <td className="center">{item.weight}%</td>
                  <td className="center">{item.maxScore}</td>
                  <td />
                  <td className="center">{item.isCritical ? '□ 通过　□ 未通过' : '—'}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="skill-print-section">
          <div className="skill-print-section-heading"><h2>考核结论</h2></div>
          <div className="skill-print-result">
            <div><small>总分</small><strong>________ / 100</strong></div>
            <div><small>建议技能等级</small><strong>□ L1　□ L2　□ L3　□ L4</strong></div>
            <div><small>结果</small><strong>□ 通过　□ 不通过　□ 补考</strong></div>
          </div>
          <div className="skill-print-result">
            <div style={{ gridColumn: '1 / -1' }}><small>审核意见 / 改进要求</small><strong>________________________________________________________________________________</strong></div>
          </div>
        </section>

        <section className="skill-print-signatures">
          <div>被考核人签字：<br />日期：</div>
          <div>现场考核人签字：<br />日期：</div>
          <div>审核人签字：<br />日期：</div>
        </section>

        <footer className="skill-print-footer">
          <span>模板生效状态：{template.status === 'ACTIVE' ? '有效' : template.status}</span>
          <span>模板创建日期：{formatDate(template.createdAt)}</span>
          <span>打印件须与系统版本号一致</span>
        </footer>
      </main>
    </>
  );
}
