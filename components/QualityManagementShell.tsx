'use client';

import { AlertTriangle, ArrowRight, FileArchive, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { QualityModuleTabs } from '@/components/QualityModuleTabs';
import type { CurrentUserDTO, EightDReportSummaryDTO, InternalQualityRiskSummaryDTO } from '@/types';

const emptyRisk: InternalQualityRiskSummaryDTO = { total: 0, draft: 0, revising: 0, archived: 0, deleted: 0, critical: 0, activeAlerts: 0, unlinked: 0 };
const emptyEightD: EightDReportSummaryDTO = { total: 0, active: 0, archived: 0, deleted: 0, productCount: 0, issueCount: 0, unlinked: 0 };

export default function QualityManagementShell({ user }: { user: CurrentUserDTO }) {
  const [risk, setRisk] = useState(emptyRisk);
  const [eightD, setEightD] = useState(emptyEightD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [riskResponse, eightDResponse] = await Promise.all([
        fetch('/api/quality/internal-risks?limit=1', { cache: 'no-store' }),
        fetch('/api/quality/8d?limit=1', { cache: 'no-store' }),
      ]);
      const [riskBody, eightDBody] = await Promise.all([riskResponse.json(), eightDResponse.json()]);
      if (!riskResponse.ok) throw new Error(riskBody.error || '重大异常概况加载失败');
      if (!eightDResponse.ok) throw new Error(eightDBody.error || '8D档案概况加载失败');
      setRisk(riskBody.summary || emptyRisk);
      setEightD(eightDBody.summary || emptyEightD);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '质量管理概况加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <main className="hm-workbench-root quality-home-shell">
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality" subtitle="异常、风险预知与受控质量档案" menuItems={[]} hideHeader sidebarTriggerTargetId="quality-home-navigation-trigger" />
    <div className="quality-home-frame">
      <WorkbenchCockpitCommand
        navigationTargetId="quality-home-navigation-trigger"
        icon={<ShieldAlert size={20} />}
        title="质量管理"
        subtitle="问题事实、内部风险汇总与8D证据分层管理"
        context={<><span>{risk.activeAlerts} 条工单预警</span><span>{risk.critical} 个重大风险</span><span>{eightD.total} 份8D档案</span></>}
        actions={<button type="button" disabled={loading} onClick={() => { void load(); }}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>}
      />
      <QualityModuleTabs active="overview" riskCount={risk.total} eightDCount={eightD.total} />
      {error && <div className="quality-home-error"><AlertTriangle size={16} />{error}</div>}
      <section className="quality-home-kpis" aria-label="质量管理关键指标">
        <article className="danger"><span>活动工单预警</span><strong>{risk.activeAlerts}</strong><small>来自已归档异常版本</small></article>
        <article><span>待完善草稿</span><strong>{risk.draft}</strong><small>{risk.unlinked} 份关联不完整</small></article>
        <article className="warning"><span>修订进行中</span><strong>{risk.revising}</strong><small>旧归档预警继续有效</small></article>
        <article className="success"><span>已归档异常</span><strong>{risk.archived}</strong><small>可追溯不可覆盖</small></article>
        <article><span>8D受控档案</span><strong>{eightD.total}</strong><small>{eightD.productCount} 产品 · {eightD.issueCount} 问题</small></article>
      </section>
      <section className="quality-home-modules">
        <Link className="risk-module" href="/workspace/quality/internal-risks">
          <header><span><ShieldAlert size={20} /></span><em>内部闭环</em></header>
          <h2>内部重大异常风险汇总</h2>
          <p>汇总车间不良与重大质量问题，完善发生原因、流出原因、根因、措施和结论，归档后原子同步到关联工单。</p>
          <dl><div><dt>草稿/修订</dt><dd>{risk.draft + risk.revising}</dd></div><div><dt>已归档</dt><dd>{risk.archived}</dd></div><div><dt>回收站</dt><dd>{risk.deleted}</dd></div></dl>
          <footer><span><Sparkles size={14} />支持同产品历史风险建议</span><b>进入工作台 <ArrowRight size={15} /></b></footer>
        </Link>
        <Link className="eight-d-module" href="/workspace/quality/8d">
          <header><span><FileArchive size={20} /></span><em>外部证据</em></header>
          <h2>8D PDF档案库</h2>
          <p>保存已经制作完成的8D PDF、受控版本、产品与质量问题多对多关联；不在系统内重复编辑D1–D8正文。</p>
          <dl><div><dt>在用</dt><dd>{eightD.active}</dd></div><div><dt>已归档</dt><dd>{eightD.archived}</dd></div><div><dt>待关联</dt><dd>{eightD.unlinked}</dd></div></dl>
          <footer><span>PDF存入S3兼容对象存储</span><b>打开档案库 <ArrowRight size={15} /></b></footer>
        </Link>
      </section>
      <section className="quality-home-flow" aria-label="质量闭环数据流">
        <div><b>01</b><span><strong>问题管理</strong><small>记录单个问题事实与处理</small></span></div><ArrowRight />
        <div><b>02</b><span><strong>内部重大异常</strong><small>聚合原因、结论与适用范围</small></span></div><ArrowRight />
        <div><b>03</b><span><strong>确认归档</strong><small>冻结版本并执行门禁</small></span></div><ArrowRight />
        <div><b>04</b><span><strong>工单质量预警</strong><small>直接关联或同产品确认后同步</small></span></div>
      </section>
    </div>
  </main>;
}
