'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import type { CurrentUserDTO } from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type QuickFilter = 'today' | 'overdue' | 'urgent' | 'drawing' | 'material' | 'documents' | 'mine' | 'completed';
type DetailTab = 'production' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_owner' | 'set_workstation' | 'set_priority' | 'set_stage' | 'add_remark';

type ProductionOrder = {
  id: string;
  code: string;
  specification?: string | null;
  customerName?: string | null;
  productName: string;
  stage: StageKey;
  stageText: string;
  priority: string;
  plannedAt?: string | null;
  deliveryDay?: string | null;
  uncompletedQty?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  completedQty?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastProgressAt?: string | null;
  latestProgressRemark?: string | null;
  lastProgressBy?: string | null;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  drawingLibraryItemId?: string | null;
  documentCompleteness: string;
  documentFilledCount: number;
  documentTotalCount: number;
  documentsComplete: boolean;
  documentCategoryCodes: string[];
  exceptionCodes: string[];
  exceptionLabels: string[];
  processName?: string | null;
  orderDate?: string | null;
  salesperson?: string | null;
  customerLevel?: string | null;
  sourceOrderNo?: string | null;
  importBatchId?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo?: number | null;
  drawingIssuedAt?: string | null;
  drawingIssueNote?: string | null;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  remark?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  updatedAt: string;
};

type ProductionSummary = {
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  total: number;
  dueToday: number;
  overdue: number;
  notIssuedDrawing: number;
  materialNotReady: number;
  incompleteDocuments: number;
  urgent: number;
  completed: number;
  stageCounts: Record<StageKey, number>;
};

type BoardPayload = {
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  stageCounts: Record<StageKey, number>;
  items: ProductionOrder[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type ProgressLog = {
  id: string;
  previousStage?: string | null;
  previousStageText?: string | null;
  stage: string;
  stageText: string;
  completedQty?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  remark?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

type AdvancedFilters = {
  customer: string;
  specification: string;
  productName: string;
  productionOwner: string;
  workstation: string;
  stage: string;
  priority: string;
  deliveryFrom: string;
  deliveryTo: string;
  completeness: string;
};

type UpdateForm = {
  stage: StageKey;
  productionOwner: string;
  workstation: string;
  completedQty: string;
  remark: string;
};

const stages: Array<{ key: StageKey; label: string }> = [
  { key: 'not_issued', label: '未发图' },
  { key: 'frontend', label: '在前端' },
  { key: 'backend', label: '在后端' },
  { key: 'completed', label: '已完成' },
];

const quickFilters: Array<{ key: QuickFilter; label: string }> = [
  { key: 'today', label: '今日任务' },
  { key: 'overdue', label: '已逾期' },
  { key: 'urgent', label: '紧急' },
  { key: 'drawing', label: '缺图纸' },
  { key: 'material', label: '配料未齐' },
  { key: 'documents', label: '资料不完整' },
  { key: 'mine', label: '我的任务' },
  { key: 'completed', label: '已完成' },
];

const categoryLabels: Array<{ code: string; label: string }> = [
  { code: 'drawing', label: '原图' },
  { code: 'sop', label: 'SOP指导书' },
  { code: 'product', label: '成品图' },
  { code: 'material', label: '辅料规格' },
  { code: 'notice', label: '注意事项' },
];

const emptyAdvanced: AdvancedFilters = {
  customer: '', specification: '', productName: '', productionOwner: '', workstation: '',
  stage: '', priority: '', deliveryFrom: '', deliveryTo: '', completeness: '',
};

function dateText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(date);
}

function dateTimeText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function priorityText(priority: string) {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}

function deliveryText(order: ProductionOrder) {
  return order.deliveryDay || dateText(order.plannedAt);
}

function specText(order: ProductionOrder) {
  return order.specification?.trim() || order.code;
}

function updateFormFor(order: ProductionOrder, stage = order.stage): UpdateForm {
  return {
    stage,
    productionOwner: order.productionOwner || '',
    workstation: order.workstation || '',
    completedQty: order.completedQty || '',
    remark: '',
  };
}

export default function ProductionExecutionCenter({ user }: { user: CurrentUserDTO }) {
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [view, setView] = useState<ViewKey>('board');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [quick, setQuick] = useState<QuickFilter[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<ProductionOrder | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('production');
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [updateOrder, setUpdateOrder] = useState<ProductionOrder | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchOperation, setBatchOperation] = useState<BatchOperation>('set_owner');
  const [batchValue, setBatchValue] = useState('');
  const [batchRemark, setBatchRemark] = useState('');
  const [batchConfirm, setBatchConfirm] = useState('');
  const [userMenu, setUserMenu] = useState(false);
  const [statusMenuOrder, setStatusMenuOrder] = useState<ProductionOrder | null>(null);
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/production-summary', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产摘要加载失败');
        return body.data as ProductionSummary;
      })
      .then(data => { if (active) setSummary(data); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '生产摘要加载失败'); });
    return () => { active = false; };
  }, [refreshToken]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    const params = new URLSearchParams({ view, page: String(page), pageSize: '120' });
    if (debouncedKeyword) params.set('keyword', debouncedKeyword);
    if (quick.length) params.set('quick', quick.join(','));
    for (const [key, value] of Object.entries(advanced)) if (value) params.set(key, value);
    setLoading(true);
    setError('');
    fetch(`/api/work-orders/execution?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产看板加载失败');
        return body.data as BoardPayload;
      })
      .then(data => {
        if (requestId !== requestRef.current) return;
        setBoard(data);
        setSelected(current => current.filter(id => data.items.some(item => item.id === id)));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '生产看板加载失败');
      })
      .finally(() => { if (requestId === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [advanced, debouncedKeyword, page, quick, refreshToken, view]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const grouped = useMemo(() => {
    const result: Record<StageKey, ProductionOrder[]> = { not_issued: [], frontend: [], backend: [], completed: [] };
    for (const item of board?.items || []) result[item.stage].push(item);
    return result;
  }, [board]);

  const activeFilterCount = Object.values(advanced).filter(Boolean).length;

  function toggleQuick(key: QuickFilter) {
    setQuick(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
    setPage(1);
  }

  function toggleSelected(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function openUpdate(order: ProductionOrder, stage = order.stage) {
    setStatusMenuOrder(null);
    setUpdateOrder(order);
    setUpdateForm(updateFormFor(order, stage));
    setFormError('');
  }

  async function saveUpdate() {
    if (!updateOrder || !updateForm) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/work-orders/${updateOrder.id}/execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '进度更新失败');
      setUpdateOrder(null);
      setUpdateForm(null);
      setToast('生产进度已更新');
      setRefreshToken(value => value + 1);
      if (detailOrder?.id === updateOrder.id && body.data) setDetailOrder(body.data as ProductionOrder);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '进度更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function loadProgress(orderId: string) {
    setProgressLoading(true);
    try {
      const response = await fetch(`/api/work-orders/${orderId}/progress-logs?pageSize=50`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '进度记录加载失败');
      setProgressLogs(Array.isArray(body.data?.items) ? body.data.items : []);
    } catch (reason) {
      setProgressLogs([]);
      setToast(reason instanceof Error ? reason.message : '进度记录加载失败');
    } finally {
      setProgressLoading(false);
    }
  }

  function openDetail(order: ProductionOrder) {
    setDetailOrder(order);
    setDetailTab('production');
    setProgressLogs([]);
  }

  function switchDetailTab(tab: DetailTab) {
    setDetailTab(tab);
    if (tab === 'progress' && detailOrder) loadProgress(detailOrder.id);
  }

  function openDrawing(order: ProductionOrder) {
    const params = new URLSearchParams();
    if (order.drawingLibraryItemId) params.set('itemId', order.drawingLibraryItemId);
    else {
      params.set('create', '1');
      params.set('customerName', order.customerName || '');
      params.set('specification', order.specification || '');
      params.set('productName', order.productName || '');
    }
    location.href = `/drawing-library?${params.toString()}`;
  }

  function openBatch(operation: BatchOperation) {
    setBatchOperation(operation);
    setBatchValue('');
    setBatchRemark('');
    setBatchConfirm('');
    setFormError('');
    setBatchOpen(true);
  }

  async function saveBatch() {
    if (!selected.length) return;
    setSaving(true);
    setFormError('');
    const confirmText = batchOperation === 'set_stage' && batchValue !== 'completed' ? 'CONFIRM' : batchConfirm;
    try {
      const response = await fetch('/api/work-orders/batch-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, operation: batchOperation, value: batchValue, remark: batchRemark, confirmText }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '批量更新失败');
      setBatchOpen(false);
      setSelected([]);
      setToast(`已更新 ${body.data?.updated || 0} 个工单`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '批量更新失败');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (debouncedKeyword) params.set('keyword', debouncedKeyword);
    if (quick.length) params.set('quick', quick.join(','));
    for (const [key, value] of Object.entries(advanced)) if (value) params.set(key, value);
    location.href = `/api/export/production-execution.csv?${params.toString()}`;
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="production-page">
      <header className="production-topbar">
        <div className="production-brand"><strong>生产执行中心</strong><span>本周任务、异常与进度闭环</span></div>
        <nav className="production-main-nav" aria-label="主要导航">
          <a className="active" href="/production">生产执行</a>
          <a href="/dashboard">生产工单</a>
          <a href="/weekly-plan-center">周计划</a>
          <a href="/drawing-library">图纸资料库</a>
          <a href="/connector-parameters">连接器参数</a>
          <a href="/connector-assembly-manuals">组装说明书</a>
          <a href="/dashboard?openSettings=1">系统设置</a>
        </nav>
        <div className="user-wrap">
          <button ref={userButtonRef} className="user-button" type="button" onClick={() => setUserMenu(value => !value)}><span>♙</span><b>{user.displayName || user.username}</b><em>⌄</em></button>
          <PortalMenu open={userMenu} anchorRef={userButtonRef} className="user-menu app-user-menu" width={176}>
            <button type="button" onClick={() => { location.href = '/dashboard?openSettings=1'; }}>系统设置</button>
            <button type="button" onClick={logout}>退出登录</button>
          </PortalMenu>
        </div>
      </header>

      <section className="production-summary" aria-label="当前周生产摘要">
        <div className="production-week-label"><span>当前启用周</span><strong>{summary?.weekStartDate ? `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}` : '尚未启用周计划'}</strong></div>
        {[
          ['工单', summary?.total ?? 0, 'neutral'], ['今日交期', summary?.dueToday ?? 0, 'blue'], ['已逾期', summary?.overdue ?? 0, 'red'],
          ['未发图', summary?.notIssuedDrawing ?? 0, 'gray'], ['配料未齐', summary?.materialNotReady ?? 0, 'orange'],
          ['资料不完整', summary?.incompleteDocuments ?? 0, 'amber'], ['紧急', summary?.urgent ?? 0, 'red'], ['已完成', summary?.completed ?? 0, 'green'],
        ].map(([label, value, tone]) => <article className={String(tone)} key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}
      </section>

      <section className="production-toolbar">
        <div className="production-view-tabs">
          <button className={view === 'board' ? 'active' : ''} type="button" onClick={() => { setView('board'); setPage(1); }}>生产看板</button>
          <button className={view === 'today' ? 'active' : ''} type="button" onClick={() => { setView('today'); setPage(1); }}>今日任务</button>
          <button className={view === 'exceptions' ? 'active' : ''} type="button" onClick={() => { setView('exceptions'); setPage(1); }}>异常任务</button>
        </div>
        <label className="production-search"><span>⌕</span><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名 / 负责人" /></label>
        <button type="button" onClick={() => { setDraftAdvanced(advanced); setFiltersOpen(true); }}>高级筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
        <button type="button" onClick={exportCsv}>导出 CSV</button>
      </section>

      <section className="production-quick-filters" aria-label="快捷筛选">
        <button className={!quick.length ? 'active' : ''} type="button" onClick={() => { setQuick([]); setPage(1); }}>全部</button>
        {quickFilters.map(item => <button className={quick.includes(item.key) ? 'active' : ''} key={item.key} type="button" onClick={() => toggleQuick(item.key)}>{item.label}</button>)}
      </section>

      {error && <div className="production-error">{error}</div>}
      {!summary?.weekStartDate && !loading && <div className="production-empty-week"><strong>当前没有启用的周计划</strong><span>请先在周计划中心审核并启用下周草稿。</span><a href="/weekly-plan-center">进入周计划中心</a></div>}

      {view === 'board' ? (
        <section className="production-board-scroll" aria-label="四状态生产看板">
          <div className="production-board">
            {stages.map(column => (
              <section className={`production-column ${column.key}`} key={column.key}>
                <header><strong>{column.label}</strong><span>{board?.stageCounts[column.key] || 0}</span></header>
                <div className="production-column-list">
                  {grouped[column.key].map(order => <ProductionCard key={order.id} order={order} selected={selected.includes(order.id)} toggleSelected={toggleSelected} openDetail={openDetail} openUpdate={openUpdate} openDrawing={openDrawing} openStatusMenu={(event, item) => { statusButtonRef.current = event.currentTarget; setStatusMenuOrder(item); }} />)}
                  {!loading && !grouped[column.key].length && <div className="production-column-empty">暂无工单</div>}
                </div>
              </section>
            ))}
          </div>
          {loading && <div className="production-loading">正在加载生产看板...</div>}
        </section>
      ) : (
        <section className="production-task-view">
          <div className="production-task-heading"><div><strong>{view === 'today' ? '今日任务' : '异常任务'}</strong><span>{view === 'today' ? '紧急、逾期、今日交期与今日进度' : '只提示异常，不自动修改数据'}</span></div><em>{board?.pagination.total || 0} 项</em></div>
          <div className="production-task-grid">
            {board?.items.map(order => <ProductionCard key={order.id} order={order} selected={selected.includes(order.id)} toggleSelected={toggleSelected} openDetail={openDetail} openUpdate={openUpdate} openDrawing={openDrawing} openStatusMenu={(event, item) => { statusButtonRef.current = event.currentTarget; setStatusMenuOrder(item); }} showExceptions={view === 'exceptions'} />)}
            {!loading && !board?.items.length && <div className="production-task-empty">当前没有匹配任务</div>}
          </div>
          {loading && <div className="production-loading">正在加载任务...</div>}
        </section>
      )}

      {board && board.pagination.totalPages > 1 && <div className="production-pagination"><span>共 {board.pagination.total} 单</span><button type="button" disabled={board.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{board.pagination.page} / {board.pagination.totalPages}</b><button type="button" disabled={board.pagination.page >= board.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}

      {!!selected.length && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong><button type="button" onClick={() => openBatch('set_owner')}>设置负责人</button><button type="button" onClick={() => openBatch('set_workstation')}>设置工位</button><button type="button" onClick={() => openBatch('set_priority')}>设置优先级</button><button type="button" onClick={() => openBatch('set_stage')}>修改状态</button><button type="button" onClick={() => openBatch('add_remark')}>添加进度备注</button><button type="button" onClick={() => setSelected([])}>取消选择</button></div>}

      <PortalMenu open={!!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu" width={164}>
        {statusMenuOrder && stages.map(stage => <button className={statusMenuOrder.stage === stage.key ? 'active' : ''} type="button" key={stage.key} onClick={() => openUpdate(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      {filtersOpen && <AdvancedFilterDialog value={draftAdvanced} setValue={setDraftAdvanced} close={() => setFiltersOpen(false)} apply={() => { setAdvanced(draftAdvanced); setFiltersOpen(false); setPage(1); }} clear={() => setDraftAdvanced(emptyAdvanced)} />}
      {updateOrder && updateForm && <UpdateDialog order={updateOrder} value={updateForm} setValue={setUpdateForm} saving={saving} error={formError} close={() => { setUpdateOrder(null); setUpdateForm(null); }} save={saveUpdate} />}
      {detailOrder && <DetailDialog order={detailOrder} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} update={() => openUpdate(detailOrder)} drawing={() => openDrawing(detailOrder)} />}
      {batchOpen && <BatchDialog count={selected.length} operation={batchOperation} value={batchValue} remark={batchRemark} confirm={batchConfirm} saving={saving} error={formError} setValue={setBatchValue} setRemark={setBatchRemark} setConfirm={setBatchConfirm} close={() => setBatchOpen(false)} save={saveBatch} />}
      {toast && <div className="production-toast" role="status">{toast}</div>}
    </main>
  );
}

function ProductionCard({ order, selected, toggleSelected, openDetail, openUpdate, openDrawing, openStatusMenu, showExceptions = false }: {
  order: ProductionOrder;
  selected: boolean;
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
  openUpdate: (order: ProductionOrder) => void;
  openDrawing: (order: ProductionOrder) => void;
  openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  showExceptions?: boolean;
}) {
  return (
    <article className={`production-card ${order.stage} ${selected ? 'selected' : ''}`}>
      <div className="production-card-title"><label><input type="checkbox" checked={selected} onChange={() => toggleSelected(order.id)} /><span title={specText(order)}>{specText(order)}</span></label><em className={order.priority}>{priorityText(order.priority)}</em></div>
      <div className="production-card-customer"><strong>{order.customerName || '客户未设置'}</strong><span>{order.productName || '品名未设置'}</span></div>
      <dl className="production-card-metrics"><div><dt>交期</dt><dd>{deliveryText(order)}</dd></div><div><dt>未交</dt><dd>{order.uncompletedQty || '-'}</dd></div><div><dt>完成</dt><dd>{order.completedQty || '-'}</dd></div></dl>
      <dl className="production-card-people"><div><dt>负责人</dt><dd>{order.productionOwner || '未指派'}</dd></div><div><dt>工位</dt><dd>{order.workstation || '未设置'}</dd></div></dl>
      <div className="production-card-health"><span>图纸 {order.drawingStatus || '未设置'}</span><span>配料 {order.materialStatus || '未设置'}</span><button type="button" onClick={() => openDrawing(order)}>资料 {order.documentCompleteness}</button></div>
      {showExceptions && order.exceptionLabels.length > 0 && <div className="production-card-exceptions">{order.exceptionLabels.map(label => <span key={label}>{label}</span>)}</div>}
      <p title={order.latestProgressRemark || ''}>{order.latestProgressRemark || '暂无进度备注'}{order.lastProgressBy ? ` · ${order.lastProgressBy}` : ''}</p>
      <footer><button type="button" onClick={() => openDetail(order)}>详情</button><button className="primary" type="button" onClick={() => openUpdate(order)}>更新进度</button><button type="button" onClick={event => openStatusMenu(event, order)}>状态⌄</button></footer>
    </article>
  );
}

function UpdateDialog({ order, value, setValue, saving, error, close, save }: { order: ProductionOrder; value: UpdateForm; setValue: (value: UpdateForm) => void; saving: boolean; error: string; close: () => void; save: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog update" role="dialog" aria-modal="true" aria-label="更新工单进度">
      <div className="dialog-title"><div><strong>更新生产进度</strong><small>{specText(order)} · {order.customerName || '客户未设置'}</small></div><button type="button" onClick={close}>×</button></div>
      <div className="production-reference"><span>品名 <b>{order.productName || '-'}</b></span><span>交期 <b>{deliveryText(order)}</b></span><span>未交 <b>{order.uncompletedQty || '-'}</b></span><span>图纸 <b>{order.drawingStatus || '-'}</b></span><span>配料 <b>{order.materialStatus || '-'}</b></span><span>资料 <b>{order.documentCompleteness}</b></span></div>
      <div className="production-form-grid">
        <label><span>当前状态</span><input value={order.stageText} readOnly /></label>
        <label><span>新状态</span><select value={value.stage} onChange={event => setValue({ ...value, stage: event.target.value as StageKey })}>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>
        <label><span>负责人</span><input value={value.productionOwner} onChange={event => setValue({ ...value, productionOwner: event.target.value })} placeholder="例如：张三" /></label>
        <label><span>工位</span><input value={value.workstation} onChange={event => setValue({ ...value, workstation: event.target.value })} placeholder="例如：压接工位1" /></label>
        <label className="wide"><span>完成数量</span><input value={value.completedQty} onChange={event => setValue({ ...value, completedQty: event.target.value })} placeholder="累计完成数量，不允许负数" /></label>
        <label className="wide"><span>进度备注</span><div className="production-voice-field"><textarea value={value.remark} onChange={event => setValue({ ...value, remark: event.target.value })} rows={3} placeholder="记录首件、批量生产、异常处理等现场进度" /><VoiceInputButton value={value.remark} onChange={remark => setValue({ ...value, remark })} label="进度备注语音输入" /></div></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存进度'}</button></div>
    </section></div>
  );
}

function DetailDialog({ order, tab, setTab, progressLogs, progressLoading, close, update, drawing }: { order: ProductionOrder; tab: DetailTab; setTab: (tab: DetailTab) => void; progressLogs: ProgressLog[]; progressLoading: boolean; close: () => void; update: () => void; drawing: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog detail" role="dialog" aria-modal="true" aria-label="生产工单详情">
      <div className="dialog-title"><div><strong>{specText(order)}</strong><small>{order.customerName || '客户未设置'} · {order.productName || '品名未设置'}</small></div><button type="button" onClick={close}>×</button></div>
      <div className="production-detail-tabs">{([['production', '生产信息'], ['drawing', '图纸资料'], ['progress', '进度记录'], ['source', '来源信息']] as Array<[DetailTab, string]>).map(item => <button className={tab === item[0] ? 'active' : ''} type="button" key={item[0]} onClick={() => setTab(item[0])}>{item[1]}</button>)}</div>
      <div className="production-detail-body">
        {tab === 'production' && <InfoGrid items={[
          ['状态', order.stageText], ['优先级', priorityText(order.priority)], ['负责人', order.productionOwner || '未指派'], ['工位', order.workstation || '未设置'],
          ['未交量', order.uncompletedQty || '-'], ['完成数量', order.completedQty || '-'], ['交期', deliveryText(order)], ['图纸', order.drawingStatus || '-'],
          ['配料', order.materialStatus || '-'], ['开始时间', dateTimeText(order.startedAt)], ['完成时间', dateTimeText(order.completedAt)], ['最近更新', dateTimeText(order.lastProgressAt)],
          ['最近进度', order.latestProgressRemark || '暂无进度备注'],
        ]} />}
        {tab === 'drawing' && <div className="production-drawing-detail"><div className="production-drawing-score"><span>图纸资料完整度</span><strong>{order.documentCompleteness}</strong></div><div className="production-category-status">{categoryLabels.map(category => <span className={order.documentCategoryCodes.includes(category.code) ? 'ready' : 'missing'} key={category.code}><i />{category.label}<b>{order.documentCategoryCodes.includes(category.code) ? '已有资料' : '待补充'}</b></span>)}</div><button className="primary-button" type="button" onClick={drawing}>{order.drawingLibraryItemId ? '查看图纸资料库' : '创建图纸资料'}</button></div>}
        {tab === 'progress' && <div className="production-progress-list">{progressLoading && <div className="production-loading">进度记录加载中...</div>}{progressLogs.map(log => <article key={log.id}><time>{dateTimeText(log.createdAt)}</time><strong>{log.createdBy || '操作人未记录'}</strong><span>状态：{log.previousStageText && log.previousStage !== log.stage ? `${log.previousStageText} → ` : ''}{log.stageText}</span><span>完成：{log.completedQty || '-'}</span><span>负责人：{log.productionOwner || '未指派'} · 工位：{log.workstation || '未设置'}</span><p>{log.remark || '未填写备注'}</p></article>)}{!progressLoading && !progressLogs.length && <div className="production-task-empty">暂无进度记录</div>}</div>}
        {tab === 'source' && <InfoGrid items={[
          ['订单日期', dateText(order.orderDate)], ['业务员', order.salesperson || '-'], ['客户等级', order.customerLevel || '-'], ['来源订单号', order.sourceOrderNo || '-'],
          ['导入批次', order.importBatchId || '-'], ['来源工作表', order.sourceSheetName || '-'], ['来源行号', order.sourceRowNo ? String(order.sourceRowNo) : '-'], ['内部编号', order.code],
          ['工序', order.processName || '-'], ['单位工时', order.unitWorkHours || '-'], ['总工时', order.totalWorkHours || '-'], ['图纸说明', order.drawingIssueNote || '-'],
        ]} />}
      </div>
      <div className="dialog-actions"><button type="button" onClick={drawing}>图纸资料</button><button className="primary-button" type="button" onClick={update}>更新进度</button><button type="button" onClick={close}>关闭</button></div>
    </section></div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return <div className="production-info-grid">{items.map(([label, value]) => <div className={label === '最近进度' ? 'wide' : ''} key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>;
}

function AdvancedFilterDialog({ value, setValue, close, apply, clear }: { value: AdvancedFilters; setValue: (value: AdvancedFilters) => void; close: () => void; apply: () => void; clear: () => void }) {
  return <div className="modal-backdrop"><section className="production-dialog filters" role="dialog" aria-modal="true" aria-label="生产看板高级筛选"><div className="dialog-title"><div><strong>高级筛选</strong><small>组合客户、规格、负责人和交期条件</small></div><button type="button" onClick={close}>×</button></div><div className="production-form-grid">
    <label><span>客户</span><input value={value.customer} onChange={event => setValue({ ...value, customer: event.target.value })} /></label><label><span>规格</span><input value={value.specification} onChange={event => setValue({ ...value, specification: event.target.value })} /></label><label><span>品名</span><input value={value.productName} onChange={event => setValue({ ...value, productName: event.target.value })} /></label><label><span>负责人</span><input value={value.productionOwner} onChange={event => setValue({ ...value, productionOwner: event.target.value })} /></label><label><span>工位</span><input value={value.workstation} onChange={event => setValue({ ...value, workstation: event.target.value })} /></label><label><span>状态</span><select value={value.stage} onChange={event => setValue({ ...value, stage: event.target.value })}><option value="">全部</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label><label><span>优先级</span><select value={value.priority} onChange={event => setValue({ ...value, priority: event.target.value })}><option value="">全部</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label><label><span>资料完整度</span><select value={value.completeness} onChange={event => setValue({ ...value, completeness: event.target.value })}><option value="">全部</option><option value="complete">完整 5/5</option><option value="incomplete">不完整</option></select></label><label><span>交期开始</span><input type="date" value={value.deliveryFrom} onChange={event => setValue({ ...value, deliveryFrom: event.target.value })} /></label><label><span>交期结束</span><input type="date" value={value.deliveryTo} onChange={event => setValue({ ...value, deliveryTo: event.target.value })} /></label>
  </div><div className="dialog-actions"><button type="button" onClick={clear}>清空</button><button type="button" onClick={close}>取消</button><button className="primary-button" type="button" onClick={apply}>应用筛选</button></div></section></div>;
}

function BatchDialog({ count, operation, value, remark, confirm, saving, error, setValue, setRemark, setConfirm, close, save }: { count: number; operation: BatchOperation; value: string; remark: string; confirm: string; saving: boolean; error: string; setValue: (value: string) => void; setRemark: (value: string) => void; setConfirm: (value: string) => void; close: () => void; save: () => void }) {
  const labels: Record<BatchOperation, string> = { set_owner: '批量设置负责人', set_workstation: '批量设置工位', set_priority: '批量设置优先级', set_stage: '批量修改状态', add_remark: '批量添加进度备注' };
  return <div className="modal-backdrop"><section className="production-dialog batch" role="dialog" aria-modal="true" aria-label={labels[operation]}><div className="dialog-title"><div><strong>{labels[operation]}</strong><small>将更新已选的 {count} 个当前周工单</small></div><button type="button" onClick={close}>×</button></div><div className="production-batch-form">
    {operation === 'set_owner' && <label><span>负责人</span><input value={value} onChange={event => setValue(event.target.value)} placeholder="负责人姓名" /></label>}
    {operation === 'set_workstation' && <label><span>工位</span><input value={value} onChange={event => setValue(event.target.value)} placeholder="工位 / 线体 / 设备" /></label>}
    {operation === 'set_priority' && <label><span>优先级</span><select value={value} onChange={event => setValue(event.target.value)}><option value="">请选择</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>}
    {operation === 'set_stage' && <label><span>新状态</span><select value={value} onChange={event => { setValue(event.target.value); setConfirm(''); }}><option value="">请选择</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>}
    <label><span>{operation === 'add_remark' ? '进度备注' : '附加进度备注（可选）'}</span><div className="production-voice-field"><textarea value={remark} onChange={event => setRemark(event.target.value)} rows={3} /><VoiceInputButton value={remark} onChange={setRemark} label="批量进度备注语音输入" /></div></label>
    {operation === 'set_stage' && value === 'completed' && <label className="danger-confirm-inline"><span>批量完成不可误触，请输入 COMPLETE_BATCH</span><input value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="COMPLETE_BATCH" /></label>}
  </div>{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className={operation === 'set_stage' && value === 'completed' ? 'danger-button' : 'primary-button'} type="button" disabled={saving || (operation !== 'add_remark' && !value) || (operation === 'add_remark' && !remark.trim()) || (operation === 'set_stage' && value === 'completed' && confirm.trim() !== 'COMPLETE_BATCH')} onClick={save}>{saving ? '处理中...' : '确认批量更新'}</button></div></section></div>;
}
