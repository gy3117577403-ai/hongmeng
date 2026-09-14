'use client';

import { AlertTriangle, ArrowRight, FileArchive, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { QualityModuleTabs } from '@/components/QualityModuleTabs';
import type { CurrentUserDTO, EightDReportSummaryDTO, InternalQualityRiskSummaryDTO } from '@/types';

const emptyRisk: InternalQualityRiskSummaryDTO = { total: 0, draft: 0, submitted: 0, collaborating: 0, verifying: 0, pendingClose: 0, revising: 0, archived: 0, deleted: 0, critical: 0, activeAlerts: 0, unlinked: 0, overdueTasks: 0 };
const emptyEightD: EightDReportSummaryDTO = { total: 0, active: 0, archived: 0, deleted: 0, productCount: 0, issueCount: 0, unlinked: 0 };

export default function QualityManagementShell({ user }: { user: CurrentUserDTO }) {
  const [phases, setPhases] = useState<Record<string, number>>({});
  const [risk, setRisk] = useState(emptyRisk);
  const [eightD, setEightD] = useState(emptyEightD);
  const [quick, setQuick] = useState({total:0,active:0});
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
      setPhases(riskBody.workflowCounts || {});
      setRisk(riskBody.summary || emptyRisk);
      setEightD(eightDBody.summary || emptyEightD);
      if(user.access.capabilities.includes('QUALITY:READ')) { const qr=await fetch('/api/quality-quick/summary',{cache:'no-store'});const qb=await qr.json();if(!qr.ok)throw new Error(qb.error||'快处概况加载失败');setQuick(qb); }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '质量管理概况加载失败');
    } finally {
      setLoading(false);
    }
  }, [user.access.capabilities]);

  useEffect(() => { void load(); }, [load]);

  return <main className="hm-workbench-root hm-cockpit-root quality-home-shell">
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
      <QualityModuleTabs canViewQuick={user.access.capabilities.includes('QUALITY:READ')} active="overview" riskCount={risk.total} eightDCount={eightD.total} canViewData={user.access.capabilities.includes('QUALITY_DATA:READ')} />
      {error && <div className="quality-home-error"><AlertTriangle size={16} />{error}</div>}
      <nav className="quality-entry-shortcuts"><Link href="/workspace/quality-tasks">我的责任任务</Link><Link href="/workspace/quality-confirmation">品质确认 · {phases.VERIFYING || 0} 份待确认</Link><Link href="/workspace/approvals">重大事项审批</Link><span>待接单 {phases.SUBMITTED || 0} · 处理中 {phases.COLLABORATING || 0} · 待归档 {phases.PENDING_CLOSE || 0}</span></nav>
      <section className="quality-home-kpis" aria-label="质量管理关键指标">
        <article className="danger"><span>活动工单预警</span><strong>{risk.activeAlerts}</strong><small>来自已归档异常版本</small></article>
        <article><span>待完善草稿</span><strong>{risk.draft}</strong><small>{risk.unlinked} 份关联不完整</small></article>
        <article className="warning"><span>修订进行中</span><strong>{risk.revising}</strong><small>旧归档预警继续有效</small></article>
        <article className="success"><span>已归档异常</span><strong>{risk.archived}</strong><small>可追溯不可覆盖</small></article>
        <article><span>8D受控档案</span><strong>{eightD.total}</strong><small>{eightD.productCount} 产品 · {eightD.issueCount} 问题</small></article>
      </section>
      {user.access.capabilities.includes('QUALITY:READ')&&<div className="quality-entry-shortcuts"><Link href="/workspace/quality/quick">异常快处 · {quick.total} 条记录</Link><span>{quick.active} 条快处警示正在生效</span></div>}
      <section className="quality-home-modules">
        <Link className="risk-module" href="/workspace/quality/internal-risks">
          <header><span><ShieldAlert size={20} /></span><em>内部闭环</em></header>
          <h2>重大异常协同工作台</h2>
          <p>汇总车间不良与重大质量问题，完善发生原因、流出原因、根因、措施和结论，归档后原子同步到关联工单。</p>
          <dl><div><dt>草稿/修订</dt><dd>{risk.draft + risk.revising}</dd></div><div><dt>已归档</dt><dd>{risk.archived}</dd></div><div><dt>回收站</dt><dd>{risk.deleted}</dd></div></dl>
          <footer><span><Sparkles size={14} />支持同产品历史风险建议</span><b>进入工作台 <ArrowRight size={15} /></b></footer>
        </Link>
        <Link className="eight-d-module" href="/workspace/quality/8d">
          <header><span><FileArchive size={20} /></span><em>外部证据</em></header>
          <h2>8D PDF档案库</h2>
          <p>保存已经制作完成的8D PDF、受控版本、产品与质量问题多对多关联；不在系统内重复编辑D1–D8正文。</p>
          <dl><div><dt>在用</dt><dd>{eightD.active}</dd></div><div><dt>已归档</dt><dd>{eightD.archived}</dd></div><div><dt>待关联</dt><dd>{eightD.unlinked}</dd></div></dl>
          <footer><span>保留原始 PDF 和每次受控版本</span><b>打开档案库 <ArrowRight size={15} /></b></footer>
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
