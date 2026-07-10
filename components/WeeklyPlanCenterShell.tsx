'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalMenu } from '@/components/PortalMenu';
import type { CurrentUserDTO, WorkOrderDTO } from '@/types';
import type {
  WeeklyPlanDiffItem,
  WeeklyPlanDiffSummary,
  WeeklyPlanDiffType,
  WeeklyPlanWeekMeta,
} from '@/lib/weekly-plan-diff';

type DiffFilter = 'all' | WeeklyPlanDiffType;
type CenterMode = 'diff' | 'history';
type DiffPayload = {
  currentWeek: WeeklyPlanWeekMeta;
  nextWeek: WeeklyPlanWeekMeta;
  summary: WeeklyPlanDiffSummary;
  items: WeeklyPlanDiffItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type ActivateSummary = {
  weekStartDate: string;
  weekEndDate: string;
  currentArchiveCount: number;
  nextActivateCount: number;
  newCount: number;
  continuedCount: number;
  changedCount: number;
  removedCount: number;
  duplicateCount: number;
  invalidCount: number;
  blockingAnomalyCount: number;
  warningCount: number;
  drawingWithFilesCount: number;
  drawingWithoutFilesCount: number;
};
type HistoryWeek = {
  weekStartDate: string;
  weekEndDate: string;
  workOrderCount: number;
  completedCount: number;
  missingCount: number;
  archivedAt: string | null;
  archivedBy: string | null;
};
type HistoryOrder = WorkOrderDTO & { missingCategoryCount: number; completenessText: string };
type HistoryPayload = {
  weeks: HistoryWeek[];
  selectedWeekStart: string | null;
  workOrders: HistoryOrder[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const typeLabels: Record<DiffFilter, string> = {
  all: '全部',
  new: '新增',
  continued: '延续',
  changed: '有变更',
  removed: '下周取消',
  duplicate: '重复',
  invalid: '异常',
};

function dateText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function dateTimeText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function rangeText(week: WeeklyPlanWeekMeta) {
  if (!week.weekStartDate) return '尚未识别';
  return `${dateText(week.weekStartDate)} ~ ${dateText(week.weekEndDate)}`;
}

function deliveryText(order: WeeklyPlanDiffItem['current']) {
  return order?.deliveryDay || dateText(order?.plannedAt) || '-';
}

function orderTitle(item: WeeklyPlanDiffItem) {
  const order = item.next || item.current;
  return order?.specification || order?.code || '规格未设置';
}

function diffQuery(currentWeekStart: string, nextWeekStart: string, currentBatchId = '', nextBatchId = '') {
  const params = new URLSearchParams();
  if (currentWeekStart) params.set('currentWeekStart', currentWeekStart);
  if (nextWeekStart) params.set('nextWeekStart', nextWeekStart);
  if (currentBatchId) params.set('currentBatchId', currentBatchId);
  if (nextBatchId) params.set('nextBatchId', nextBatchId);
  return params;
}

export default function WeeklyPlanCenterShell({ user }: { user: CurrentUserDTO }) {
  const [mode, setMode] = useState<CenterMode>('diff');
  const [data, setData] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<DiffFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [currentWeekStart, setCurrentWeekStart] = useState('');
  const [nextWeekStart, setNextWeekStart] = useState('');
  const [currentBatchId, setCurrentBatchId] = useState('');
  const [nextBatchId, setNextBatchId] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [userMenu, setUserMenu] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);
  const [activateError, setActivateError] = useState('');
  const [activateSummary, setActivateSummary] = useState<ActivateSummary | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const initialDatesApplied = useRef(false);
  const diffRequestId = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCurrentBatchId(params.get('currentBatchId') || '');
    setNextBatchId(params.get('nextBatchId') || '');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    if (mode !== 'diff') return undefined;
    const requestId = diffRequestId.current + 1;
    diffRequestId.current = requestId;
    const controller = new AbortController();
    const params = diffQuery(currentWeekStart, nextWeekStart, currentBatchId, nextBatchId);
    params.set('type', filter);
    params.set('page', String(page));
    params.set('pageSize', '80');
    if (debouncedKeyword) params.set('keyword', debouncedKeyword);
    setLoading(true);
    setError('');
    fetch(`/api/work-orders/week/diff?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || '周计划差异加载失败');
        return body.data as DiffPayload;
      })
      .then(next => {
        if (requestId !== diffRequestId.current) return;
        setData(next);
        if (!initialDatesApplied.current) {
          initialDatesApplied.current = true;
          setCurrentWeekStart(next.currentWeek.weekStartDate || '');
          setNextWeekStart(next.nextWeek.weekStartDate || '');
        }
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId !== diffRequestId.current) return;
        setError(reason instanceof Error ? reason.message : '周计划差异加载失败');
      })
      .finally(() => {
        if (requestId === diffRequestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [mode, filter, page, debouncedKeyword, currentWeekStart, nextWeekStart, currentBatchId, nextBatchId, refreshToken]);

  const summaryCards = useMemo(() => {
    const summary = data?.summary;
    return [
      ['当前周', summary?.currentCount ?? 0, 'neutral'],
      ['下周', summary?.nextCount ?? 0, 'neutral'],
      ['新增', summary?.newCount ?? 0, 'new'],
      ['延续', summary?.continuedCount ?? 0, 'continued'],
      ['变更', summary?.changedCount ?? 0, 'changed'],
      ['下周取消', summary?.removedCount ?? 0, 'removed'],
      ['重复', summary?.duplicateCount ?? 0, 'danger'],
      ['异常', summary?.invalidCount ?? 0, 'danger'],
    ] as const;
  }, [data]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function exportDiff() {
    const params = diffQuery(currentWeekStart, nextWeekStart, currentBatchId, nextBatchId);
    location.href = `/api/work-orders/week/diff/export.csv?${params.toString()}`;
  }

  function openDrawing(item: WeeklyPlanDiffItem) {
    const order = item.next || item.current;
    if (!order) return;
    const params = new URLSearchParams();
    if (order.drawingLibraryItemId) {
      params.set('itemId', order.drawingLibraryItemId);
    } else {
      params.set('create', '1');
      params.set('customerName', order.customerName || '');
      params.set('specification', order.specification || '');
      params.set('productName', order.productName || '');
    }
    location.href = `/drawing-library?${params.toString()}`;
  }

  async function previewActivate() {
    const weekStartDate = data?.nextWeek.weekStartDate || nextWeekStart;
    if (!weekStartDate) {
      setActivateError('尚未找到下周草稿，请先导入下周计划');
      setActivateOpen(true);
      return;
    }
    setActivateOpen(true);
    setActivateLoading(true);
    setActivateError('');
    setActivateSummary(null);
    setConfirmText('');
    try {
      const response = await fetch('/api/work-orders/week/activate-next/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '启用预检失败');
      setActivateSummary(body.summary || null);
    } catch (reason) {
      setActivateError(reason instanceof Error ? reason.message : '启用预检失败');
    } finally {
      setActivateLoading(false);
    }
  }

  async function commitActivate() {
    const weekStartDate = activateSummary?.weekStartDate || data?.nextWeek.weekStartDate;
    if (!weekStartDate || confirmText.trim() !== 'START_NEXT_WEEK') return;
    setActivateLoading(true);
    setActivateError('');
    try {
      const response = await fetch('/api/work-orders/week/activate-next/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate, confirmText: confirmText.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '启用下周失败');
      location.href = '/dashboard?openOrders=1&planView=current';
    } catch (reason) {
      setActivateError(reason instanceof Error ? reason.message : '启用下周失败');
    } finally {
      setActivateLoading(false);
    }
  }

  return (
    <main className="weekly-plan-center-shell">
      <header className="weekly-center-topbar">
        <a className="home-button" href="/dashboard" aria-label="返回工单资料库">⌂</a>
        <div className="brand-block">
          <strong>周计划差异中心</strong>
          <span>下周计划对比、异常审核与安全切换</span>
        </div>
        <nav className="weekly-center-nav" aria-label="主要导航">
          <a href="/production">生产执行</a>
          <a href="/dashboard">生产工单</a>
          <a href="/drawing-library">图纸资料库</a>
          <a href="/connector-parameters">连接器参数</a>
        </nav>
        <div className="user-wrap">
          <button ref={userButtonRef} className="user-button" type="button" onClick={() => setUserMenu(value => !value)}>
            <span>♙</span><b>{user.displayName || user.username}</b><em>⌄</em>
          </button>
          <PortalMenu open={userMenu} anchorRef={userButtonRef} className="user-menu app-user-menu" width={176}>
            <button type="button" onClick={() => { location.href = '/dashboard?openWeeklyImport=1'; }}>导入下周计划</button>
            <button type="button" onClick={logout}>退出登录</button>
          </PortalMenu>
        </div>
      </header>

      <section className="weekly-center-toolbar">
        <div className="weekly-center-mode-tabs">
          <button className={mode === 'diff' ? 'active' : ''} type="button" onClick={() => setMode('diff')}>差异审核</button>
          <button className={mode === 'history' ? 'active' : ''} type="button" onClick={() => setMode('history')}>历史周</button>
        </div>
        {mode === 'diff' && (
          <div className="weekly-center-actions">
            <button type="button" onClick={() => { location.href = '/dashboard?openWeeklyImport=1'; }}>导入下周</button>
            <button type="button" onClick={exportDiff} disabled={!data?.summary.nextCount}>导出下周差异</button>
            <button className="primary-button" type="button" onClick={previewActivate} disabled={!data?.summary.nextCount}>预检并启用下周</button>
          </div>
        )}
      </section>

      {mode === 'history' ? <HistoryWeekPanel /> : (
        <>
          <section className="weekly-period-bar">
            <label><span>当前周</span><input type="date" value={currentWeekStart} onChange={event => { setCurrentWeekStart(event.target.value); setCurrentBatchId(''); setPage(1); }} /></label>
            <strong>{data ? rangeText(data.currentWeek) : '-'}</strong>
            <i>对比</i>
            <label><span>下周草稿</span><input type="date" value={nextWeekStart} onChange={event => { setNextWeekStart(event.target.value); setNextBatchId(''); setPage(1); }} /></label>
            <strong>{data ? rangeText(data.nextWeek) : '-'}</strong>
            <button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新检查</button>
          </section>

          <section className="weekly-diff-summary" aria-label="差异摘要">
            {summaryCards.map(([label, value, tone]) => <article className={tone} key={label}><span>{label}</span><strong>{value}</strong></article>)}
          </section>

          <section className={`weekly-safety-banner ${(data?.summary.blockingAnomalyCount || 0) > 0 ? 'blocked' : 'ready'}`}>
            <div>
              <strong>{(data?.summary.blockingAnomalyCount || 0) > 0 ? '存在阻断异常，暂不可启用下周' : '启用门禁检查通过'}</strong>
              <span>阻断 {data?.summary.blockingAnomalyCount || 0} 项 · 警告 {data?.summary.warningCount || 0} 项 · 有图纸资料 {data?.summary.drawingWithFilesCount || 0} 单 · 无图纸资料 {data?.summary.drawingWithoutFilesCount || 0} 单</span>
            </div>
            <button type="button" onClick={() => { setFilter((data?.summary.blockingAnomalyCount || 0) > 0 ? 'invalid' : 'all'); setPage(1); }}>
              {(data?.summary.blockingAnomalyCount || 0) > 0 ? '查看阻断项' : '查看全部'}
            </button>
          </section>

          <section className="weekly-diff-workspace">
            <div className="weekly-diff-filterbar">
              <div className="weekly-diff-tabs">
                {(Object.keys(typeLabels) as DiffFilter[]).map(item => (
                  <button key={item} className={filter === item ? 'active' : ''} type="button" onClick={() => { setFilter(item); setPage(1); }}>{typeLabels[item]}</button>
                ))}
              </div>
              <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名 / 异常" />
            </div>

            {error && <div className="weekly-center-error">{error}</div>}
            <div className="weekly-diff-table-wrap">
              <table className="weekly-diff-table">
                <thead>
                  <tr>
                    <th>类型</th><th>规格 / 图纸资料</th><th>客户 / 品名</th><th>当前交期</th><th>下周交期</th><th>当前未交</th><th>下周未交</th><th>图纸</th><th>配料</th><th>变更 / 异常</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map(item => {
                    const display = item.next || item.current;
                    return (
                      <tr className={`diff-row-${item.type}`} key={item.id}>
                        <td><span className={`weekly-diff-badge ${item.type}`}>{typeLabels[item.type]}</span>{item.type !== item.baseType && <small>{typeLabels[item.baseType]}</small>}</td>
                        <td>
                          <button className="weekly-spec-link" type="button" onClick={() => openDrawing(item)} title={orderTitle(item)}>{orderTitle(item)}</button>
                          <small>{display?.drawingLibraryLinked ? `资料 ${display.drawingLibraryCompleteness} · 文件 ${display.drawingLibraryFileCount} 个` : '尚未建立图纸资料 · 点击创建'}</small>
                        </td>
                        <td><strong>{display?.customerName || '客户未设置'}</strong><small>{display?.productName || '品名未设置'}</small></td>
                        <td>{deliveryText(item.current)}</td>
                        <td>{deliveryText(item.next)}</td>
                        <td>{item.current?.uncompletedQty || '-'}</td>
                        <td>{item.next?.uncompletedQty || '-'}</td>
                        <td>{item.current?.drawingStatus || '-'}{item.current && item.next && item.current.drawingStatus !== item.next.drawingStatus ? <><b> → </b>{item.next.drawingStatus || '-'}</> : ''}</td>
                        <td>{item.current?.materialStatus || '-'}{item.current && item.next && item.current.materialStatus !== item.next.materialStatus ? <><b> → </b>{item.next.materialStatus || '-'}</> : ''}</td>
                        <td>
                          <div className="weekly-change-list">
                            {item.changes.map(change => <span key={change.field}><b>{change.label}</b>{change.before} → {change.after}</span>)}
                            {item.blockers.map(problem => <span className="blocking" key={problem.code}><b>阻断</b>{problem.message}</span>)}
                            {item.warnings.map(problem => <span className="warning" key={problem.code}><b>警告</b>{problem.message}</span>)}
                            {!item.changes.length && !item.blockers.length && !item.warnings.length && <em>无变化</em>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && !data?.items.length && <tr><td colSpan={10}><div className="weekly-empty">当前筛选没有差异记录</div></td></tr>}
                </tbody>
              </table>
              {loading && <div className="weekly-table-loading">正在计算周计划差异...</div>}
            </div>
            {data && data.pagination.totalPages > 1 && (
              <div className="weekly-pagination">
                <span>共 {data.pagination.total} 条</span>
                <button type="button" disabled={data.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button>
                <b>{data.pagination.page} / {data.pagination.totalPages}</b>
                <button type="button" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button>
              </div>
            )}
          </section>
        </>
      )}

      {activateOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="week-action-dialog weekly-activate-dialog" role="dialog" aria-modal="true" aria-label="启用下周安全预检">
            <div className="dialog-title"><div><strong>启用下周安全预检</strong><small>当前周将归档，下周草稿将成为当前周</small></div><button type="button" onClick={() => setActivateOpen(false)}>×</button></div>
            {activateLoading && !activateSummary && <div className="weekly-empty">正在执行启用前检查...</div>}
            {activateError && <div className="form-error">{activateError}</div>}
            {activateSummary && (
              <>
                <div className="week-action-summary">
                  <span><b>归档当前周</b><em>{activateSummary.currentArchiveCount}</em></span>
                  <span><b>启用下周</b><em>{activateSummary.nextActivateCount}</em></span>
                  <span><b>新增</b><em>{activateSummary.newCount}</em></span>
                  <span><b>延续</b><em>{activateSummary.continuedCount}</em></span>
                  <span><b>变更</b><em>{activateSummary.changedCount}</em></span>
                  <span><b>下周取消</b><em>{activateSummary.removedCount}</em></span>
                  <span className={activateSummary.blockingAnomalyCount ? 'danger' : ''}><b>阻断异常</b><em>{activateSummary.blockingAnomalyCount}</em></span>
                  <span><b>警告</b><em>{activateSummary.warningCount}</em></span>
                  <span><b>有图纸资料</b><em>{activateSummary.drawingWithFilesCount}</em></span>
                  <span><b>无图纸资料</b><em>{activateSummary.drawingWithoutFilesCount}</em></span>
                </div>
                {activateSummary.blockingAnomalyCount > 0 ? (
                  <div className="weekly-block-message">阻断异常未解决，系统不会启用下周。请关闭弹窗并在“异常 / 重复”中处理。</div>
                ) : (
                  <>
                    {activateSummary.warningCount > 0 && <div className="weekly-warning-message">仍有 {activateSummary.warningCount} 项警告。警告不阻断切换，但请确认已知悉。</div>}
                    <label className="danger-confirm-inline"><span>确认请输入 START_NEXT_WEEK</span><input value={confirmText} onChange={event => setConfirmText(event.target.value)} placeholder="START_NEXT_WEEK" /></label>
                  </>
                )}
                <p className="tool-note muted">不会删除生产文件、图纸资料库、连接器参数或 S3 对象。</p>
                <div className="dialog-actions">
                  <button type="button" onClick={() => setActivateOpen(false)}>取消</button>
                  <button className="primary-button" type="button" disabled={activateLoading || activateSummary.blockingAnomalyCount > 0 || confirmText.trim() !== 'START_NEXT_WEEK'} onClick={commitActivate}>{activateLoading ? '处理中...' : '确认启用下周'}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function HistoryWeekPanel() {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedKeyword(keyword.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: '80' });
    if (selectedWeek) params.set('weekStartDate', selectedWeek);
    if (debouncedKeyword) params.set('keyword', debouncedKeyword);
    setLoading(true);
    setError('');
    fetch(`/api/work-orders/week/history?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || '历史周加载失败');
        return body.data as HistoryPayload;
      })
      .then(next => {
        if (requestId !== requestIdRef.current) return;
        setData(next);
        if (!selectedWeek && next.selectedWeekStart) setSelectedWeek(next.selectedWeekStart);
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId !== requestIdRef.current) return;
        setError(reason instanceof Error ? reason.message : '历史周加载失败');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedWeek, debouncedKeyword, page]);

  return (
    <section className="weekly-history-layout">
      <aside className="weekly-history-weeks">
        <div className="weekly-history-heading"><strong>历史生产周</strong><span>{data?.weeks.length || 0} 周</span></div>
        {data?.weeks.map(week => (
          <button key={week.weekStartDate} className={selectedWeek === week.weekStartDate ? 'active' : ''} type="button" onClick={() => { setSelectedWeek(week.weekStartDate); setPage(1); }}>
            <strong>{dateText(week.weekStartDate)} ~ {dateText(week.weekEndDate)}</strong>
            <span>工单 {week.workOrderCount} · 完成 {week.completedCount} · 缺资料 {week.missingCount}</span>
            <small>{dateTimeText(week.archivedAt)} · {week.archivedBy || '操作人未记录'}</small>
          </button>
        ))}
        {!loading && !data?.weeks.length && <div className="weekly-empty">暂无历史周</div>}
      </aside>
      <div className="weekly-history-orders">
        <div className="weekly-history-toolbar">
          <div><strong>历史周工单</strong><span>只读查看，不混入当前生产列表</span></div>
          <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名" />
        </div>
        {error && <div className="weekly-center-error">{error}</div>}
        <div className="weekly-history-table-wrap">
          <table>
            <thead><tr><th>规格</th><th>客户</th><th>品名</th><th>未交量</th><th>交期</th><th>图纸</th><th>配料</th><th>资料</th><th>状态</th></tr></thead>
            <tbody>
              {data?.workOrders.map(order => (
                <tr key={order.id}>
                  <td><strong>{order.specification || order.code}</strong><small>内部编号 {order.code}</small></td>
                  <td>{order.customerName || '未设置'}</td><td>{order.productName || '-'}</td><td>{order.uncompletedQty || '-'}</td><td>{order.deliveryDay || dateText(order.plannedAt)}</td><td>{order.drawingStatus || '-'}</td><td>{order.materialStatus || '-'}</td><td>{order.completenessText}</td><td>{order.stageText || order.stage}</td>
                </tr>
              ))}
              {!loading && !data?.workOrders.length && <tr><td colSpan={9}><div className="weekly-empty">该历史周没有匹配工单</div></td></tr>}
            </tbody>
          </table>
          {loading && <div className="weekly-table-loading">历史周加载中...</div>}
        </div>
        {data && data.pagination.totalPages > 1 && <div className="weekly-pagination"><span>共 {data.pagination.total} 条</span><button type="button" disabled={data.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{data.pagination.page} / {data.pagination.totalPages}</b><button type="button" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
      </div>
    </section>
  );
}
