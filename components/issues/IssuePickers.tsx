'use client';

import { Check, ChevronDown, Copy, Loader2, Plus, Search, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EmployeeDTO, IssueWorkOrderDraftDTO, IssueWorkOrderOptionDTO } from '@/types';

type BasePickerProps = {
  disabled?: boolean;
};

function workOrderCode(order: IssueWorkOrderOptionDTO): string {
  return order.displayCode || order.businessCode || order.code;
}

function workOrderTitle(order: IssueWorkOrderOptionDTO): string {
  const copyCode = workOrderCode(order);
  return [order.businessCode, order.productName, order.code]
    .map(value => value?.trim())
    .find(value => value && value !== copyCode) || copyCode;
}

function searchText(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

const emptyWorkOrderDraft: IssueWorkOrderDraftDTO = {
  code: '', productName: '', customerName: '', specification: '', sourceOrderNo: '', remark: '',
};

const branchLabels: Record<string, string> = {
  REWORK: '返工支线',
  SCRAP_REPLENISH: '报废补单',
  QUALITY_PENDING: '质量待定',
};

function workOrderScopeText(order: IssueWorkOrderOptionDTO): string {
  const scope = order.planClearedAt ? '历史已归档' : order.planActive === false ? '非当前计划' : order.planActive ? '当前有效' : '已关联';
  return order.branchType ? `${scope} · ${branchLabels[order.branchType] || '支线工单'}` : scope;
}

type WorkOrderSearchResponse = {
  ok: boolean;
  items: IssueWorkOrderOptionDTO[];
  selected?: IssueWorkOrderOptionDTO | null;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function useOutsideClose(open: boolean, close: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, open]);
  return rootRef;
}

export function WorkOrderPicker({
  value,
  onChange,
  onCopied,
  initialSelected,
  newWorkOrderDraft,
  onNewWorkOrderDraftChange,
  allowCreate = true,
  disabled,
}: BasePickerProps & {
  value: string;
  onChange: (id: string) => void;
  onCopied?: (message: string) => void;
  initialSelected?: IssueWorkOrderOptionDTO | null;
  newWorkOrderDraft: IssueWorkOrderDraftDTO | null;
  onNewWorkOrderDraftChange: (draft: IssueWorkOrderDraftDTO | null) => void;
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<IssueWorkOrderOptionDTO[]>([]);
  const [selected, setSelected] = useState<IssueWorkOrderOptionDTO | null>(initialSelected || null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [creating, setCreating] = useState(false);
  const [draftForm, setDraftForm] = useState<IssueWorkOrderDraftDTO>(emptyWorkOrderDraft);
  const [draftError, setDraftError] = useState('');
  const listboxId = useId();
  const requestVersionRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const close = useCallback((): void => {
    setOpen(false);
    setQuery('');
    setCreating(false);
    setDraftError('');
  }, []);
  const rootRef = useOutsideClose(open, close);
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (initialSelected?.id === value && selected?.id !== value) setSelected(initialSelected);
  }, [initialSelected, selected?.id, value]);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ selectedId: value, selectedOnly: 'true', pageSize: '1' });
    void fetch(`/api/issues/work-orders?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as WorkOrderSearchResponse;
        if (!response.ok) throw new Error(data.error || '已选工单加载失败');
        setSelected(data.selected || null);
      })
      .catch(error => {
        if ((error as { name?: string }).name !== 'AbortError') setLoadError(error instanceof Error ? error.message : '已选工单加载失败');
      });
    return () => controller.abort();
  }, [selected?.id, value]);

  useEffect(() => {
    if (!open || creating) return;
    const controller = new AbortController();
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setLoadError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (normalizedQuery) params.set('keyword', normalizedQuery);
      if (value) params.set('selectedId', value);
      void fetch(`/api/issues/work-orders?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const data = await response.json().catch(() => ({})) as WorkOrderSearchResponse;
          if (!response.ok) throw new Error(data.error || '关联工单加载失败');
          if (requestVersion !== requestVersionRef.current) return;
          setItems(data.items || []);
          setTotal(data.pagination?.total || 0);
          setPage(data.pagination?.page || 1);
          setTotalPages(data.pagination?.totalPages || 1);
          setActiveIndex(data.items?.length ? 0 : -1);
          if (data.selected) setSelected(data.selected);
        })
        .catch(error => {
          if ((error as { name?: string }).name !== 'AbortError' && requestVersion === requestVersionRef.current) {
            setLoadError(error instanceof Error ? error.message : '关联工单加载失败');
          }
        })
        .finally(() => {
          if (requestVersion === requestVersionRef.current) setLoading(false);
        });
    }, normalizedQuery ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [creating, normalizedQuery, open, refreshVersion, value]);

  const selectOrder = (order: IssueWorkOrderOptionDTO): void => {
    setSelected(order);
    onNewWorkOrderDraftChange(null);
    onChange(order.id);
    close();
  };

  const loadMore = async (): Promise<void> => {
    if (loading || loadingMore || page >= totalPages) return;
    const requestVersion = requestVersionRef.current;
    const queryAtStart = queryRef.current.trim();
    setLoadingMore(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(page + 1), pageSize: '50' });
      if (queryAtStart) params.set('keyword', queryAtStart);
      const response = await fetch(`/api/issues/work-orders?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as WorkOrderSearchResponse;
      if (!response.ok) throw new Error(data.error || '更多工单加载失败');
      if (requestVersion !== requestVersionRef.current || queryAtStart !== queryRef.current.trim()) return;
      setItems(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...(data.items || []).filter(item => !known.has(item.id))];
      });
      setPage(data.pagination.page);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '更多工单加载失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const startCreate = (): void => {
    setDraftForm({ ...emptyWorkOrderDraft, code: normalizedQuery });
    setDraftError('');
    setCreating(true);
  };

  const commitDraft = (): void => {
    const draft = {
      code: draftForm.code.trim(),
      productName: draftForm.productName.trim(),
      customerName: draftForm.customerName.trim(),
      specification: draftForm.specification.trim(),
      sourceOrderNo: draftForm.sourceOrderNo.trim(),
      remark: draftForm.remark.trim(),
    };
    if (!draft.code) { setDraftError('请填写工单号'); return; }
    if (!draft.productName) { setDraftError('请填写产品名称'); return; }
    setSelected(null);
    onChange('');
    onNewWorkOrderDraftChange(draft);
    close();
  };

  const displayValue = open
    ? creating ? draftForm.code : query
    : newWorkOrderDraft
      ? `${newWorkOrderDraft.productName} · ${newWorkOrderDraft.code}（待创建）`
      : selected
        ? `${workOrderTitle(selected)} · ${workOrderCode(selected)}`
        : value ? '正在加载已选工单…' : '';

  const copySelected = async (): Promise<void> => {
    const code = newWorkOrderDraft?.code || (selected ? workOrderCode(selected) : '');
    if (!code) return;
    await copyToClipboard(code);
    onCopied?.(`已复制工单编号：${code}`);
  };

  const openPicker = (): void => {
    setOpen(true);
    setLoadError('');
    if (newWorkOrderDraft) {
      setDraftForm(newWorkOrderDraft);
      setCreating(true);
    } else {
      setCreating(false);
      setQuery('');
    }
  };

  return <div className={`issue-picker ${open ? 'open' : ''}`} ref={rootRef}>
    <div className="issue-picker-control">
      <Search aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-label="搜索并选择关联工单"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={!creating && activeIndex >= 0 && items[activeIndex] ? `${listboxId}-option-${items[activeIndex].id}` : undefined}
        autoComplete="off"
        disabled={disabled || creating}
        value={displayValue}
        placeholder="输入工单号、产品规格、客户或订单号"
        onFocus={openPicker}
        onChange={event => { setOpen(true); setCreating(false); setQuery(event.target.value); }}
        onKeyDown={event => {
          if (event.key === 'Escape') close();
          if (event.key === 'ArrowDown' && open && items.length) {
            event.preventDefault();
            setActiveIndex(current => Math.min(items.length - 1, Math.max(0, current + 1)));
          }
          if (event.key === 'ArrowUp' && open && items.length) {
            event.preventDefault();
            setActiveIndex(current => Math.max(0, current - 1));
          }
          if (event.key === 'Enter' && open && items[activeIndex]) {
            event.preventDefault();
            selectOrder(items[activeIndex]);
          }
        }}
      />
      {(selected || newWorkOrderDraft) && <button type="button" className="copy" title="复制工单编号" aria-label="复制工单编号" onClick={() => { void copySelected(); }}><Copy /></button>}
      {(selected || newWorkOrderDraft || value) && <button type="button" className="clear" title="取消关联工单" aria-label="取消关联工单" onClick={() => { setSelected(null); onChange(''); onNewWorkOrderDraftChange(null); close(); }}><X /></button>}
      <button type="button" className="toggle" title="展开工单列表" aria-label="展开工单列表" onClick={() => { if (open) close(); else openPicker(); }}><ChevronDown /></button>
    </div>
    {open && <div className="issue-picker-popover work-orders" id={listboxId} role={creating ? 'dialog' : 'listbox'} aria-label={creating ? '新建待补资料工单' : undefined} aria-busy={!creating && loading}>
      <header><strong>{creating ? '新建待补资料工单' : '选择关联工单'}</strong><span>{creating ? '与问题一次保存' : loading ? '正在检索…' : `共 ${total} 条 · 已显示 ${items.length} 条`}</span></header>
      {creating ? <div className="issue-work-order-draft" onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setCreating(false);
          setDraftError('');
        } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}>
        <p>只创建工单，不会自动生成图纸档案；图纸、工序和工时可后续补充。</p>
        <div className="issue-work-order-draft-grid">
          <label><span>工单号 *</span><input value={draftForm.code} maxLength={80} onChange={event => setDraftForm(current => ({ ...current, code: event.target.value }))} /></label>
          <label><span>产品名称 *</span><input autoFocus value={draftForm.productName} maxLength={120} onChange={event => setDraftForm(current => ({ ...current, productName: event.target.value }))} placeholder="例如：电源线束" /></label>
          <label><span>客户名称</span><input value={draftForm.customerName} maxLength={120} onChange={event => setDraftForm(current => ({ ...current, customerName: event.target.value }))} /></label>
          <label><span>规格 / 型号</span><input value={draftForm.specification} maxLength={180} onChange={event => setDraftForm(current => ({ ...current, specification: event.target.value }))} /></label>
          <label className="wide"><span>来源订单号</span><input value={draftForm.sourceOrderNo} maxLength={120} onChange={event => setDraftForm(current => ({ ...current, sourceOrderNo: event.target.value }))} /></label>
          <label className="wide"><span>备注</span><textarea rows={2} value={draftForm.remark} maxLength={500} onChange={event => setDraftForm(current => ({ ...current, remark: event.target.value }))} /></label>
        </div>
        {draftError && <p className="draft-error" role="alert">{draftError}</p>}
        <footer><button type="button" onClick={() => { setCreating(false); setDraftError(''); }}>返回搜索</button><button type="button" className="primary" onClick={commitDraft}><Plus />使用并随问题创建</button></footer>
      </div> : <>
      {!normalizedQuery && <button type="button" className={`issue-picker-option none ${!value && !newWorkOrderDraft ? 'selected' : ''}`} onClick={() => { setSelected(null); onChange(''); onNewWorkOrderDraftChange(null); close(); }}><span>不关联工单</span><small>用于无法对应具体生产工单的问题</small>{!value && !newWorkOrderDraft && <Check />}</button>}
      {items.map((order, index) => {
        const code = workOrderCode(order);
        return <div id={`${listboxId}-option-${order.id}`} className={`issue-picker-option ${order.id === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`} role="option" aria-selected={order.id === value} key={order.id}>
          <button type="button" className="option-main" disabled={loading} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectOrder(order)}>
            <strong>{workOrderTitle(order)}</strong>
            <span>{code}</span>
            <small>{order.customerName || '客户未设置'} · {order.productName} · {workOrderScopeText(order)}</small>
          </button>
          <button type="button" className="option-copy" aria-label={`复制工单编号 ${code}`} title="复制工单编号" onClick={() => { void copyToClipboard(code).then(() => onCopied?.(`已复制工单编号：${code}`)); }}><Copy /></button>
          {order.id === value && <Check className="option-check" />}
        </div>;
      })}
      {loading && <div className="issue-picker-loading" role="status"><Loader2 /><span>正在查询所有未删除工单…</span></div>}
      {!loading && !items.length && !loadError && <div className="issue-picker-empty issue-picker-empty-action"><strong>{normalizedQuery ? `未找到“${normalizedQuery}”` : '暂无可用工单'}</strong><p>{allowCreate && normalizedQuery ? '可先创建待补资料工单，图纸等后续补充。' : '可换工单号、规格、客户或订单号重试。'}</p><div>{allowCreate && normalizedQuery && <button type="button" className="primary" onClick={startCreate}><Plus />新建待补资料工单</button>}<button type="button" onClick={() => { setSelected(null); onChange(''); onNewWorkOrderDraftChange(null); close(); }}>暂不关联工单</button></div></div>}
      {loadError && <div className="issue-picker-empty issue-picker-load-error" role="alert"><strong>工单加载失败</strong><p>{loadError}</p><button type="button" onClick={() => setRefreshVersion(current => current + 1)}>重试</button></div>}
      {!loading && items.length > 0 && page < totalPages && <button type="button" className="issue-picker-more" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore && <Loader2 />}{loadingMore ? '正在加载…' : `加载更多（剩余 ${Math.max(0, total - items.length)} 条）`}</button>}
      </>}
    </div>}
  </div>;
}

function employeeLabel(employee: EmployeeDTO): string {
  return `${employee.name} · ${employee.employeeNo}`;
}

function filterEmployees(employees: EmployeeDTO[], query: string): EmployeeDTO[] {
  const normalized = searchText(query);
  const active = employees.filter(employee => employee.isActive);
  if (!normalized) return active;
  return active.filter(employee => [
    employee.employeeNo, employee.name, employee.department, employee.position, employee.team,
  ].some(item => searchText(item).includes(normalized)));
}

function groupEmployees(employees: EmployeeDTO[]): Array<{ department: string; employees: EmployeeDTO[] }> {
  const groups = new Map<string, EmployeeDTO[]>();
  employees.forEach(employee => {
    const department = employee.department?.trim() || '未设置部门';
    const list = groups.get(department) || [];
    list.push(employee);
    groups.set(department, list);
  });
  return Array.from(groups.entries())
    .sort(([first], [second]) => first.localeCompare(second, 'zh-CN'))
    .map(([department, list]) => ({
      department,
      employees: list.sort((first, second) => first.employeeNo.localeCompare(second.employeeNo, 'zh-CN')),
    }));
}

export function EmployeePicker({
  employees,
  value,
  onChange,
  disabled,
  placeholder = '搜索姓名、工号、部门或岗位',
}: BasePickerProps & {
  employees: EmployeeDTO[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listboxId = useId();
  const selected = useMemo(() => employees.find(employee => employee.id === value) || null, [employees, value]);
  const close = (): void => { setOpen(false); setQuery(''); };
  const rootRef = useOutsideClose(open, close);
  const grouped = useMemo(() => groupEmployees(filterEmployees(employees, query)), [employees, query]);
  const matchCount = grouped.reduce((total, group) => total + group.employees.length, 0);
  const displayValue = open ? query : selected ? employeeLabel(selected) : '';

  return <div className={`issue-picker employee-picker ${open ? 'open' : ''}`} ref={rootRef}>
    <div className="issue-picker-control">
      <UserRound aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-label="搜索并选择负责人"
        aria-expanded={open}
        aria-controls={listboxId}
        autoComplete="off"
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={event => { setOpen(true); setQuery(event.target.value); }}
        onKeyDown={event => { if (event.key === 'Escape') close(); }}
      />
      {selected && <button type="button" className="clear" aria-label="清除负责人" title="清除负责人" onClick={() => { onChange(''); close(); }}><X /></button>}
      <button type="button" className="toggle" aria-label="展开员工列表" title="展开员工列表" onClick={() => setOpen(current => !current)}><ChevronDown /></button>
    </div>
    {open && <div className="issue-picker-popover employees" id={listboxId} role="listbox">
      <header><strong>按部门选择负责人</strong><span>{matchCount} 人</span></header>
      {!query && <button type="button" className={`issue-picker-option none ${!value ? 'selected' : ''}`} onClick={() => { onChange(''); close(); }}><span>暂不分派</span><small>创建后可在责任信息中补充分派</small>{!value && <Check />}</button>}
      {grouped.map(group => <section className="employee-group" key={group.department}>
        <h4>{group.department}<span>{group.employees.length}</span></h4>
        {group.employees.map(employee => <button type="button" role="option" aria-selected={employee.id === value} className={`employee-option ${employee.id === value ? 'selected' : ''}`} key={employee.id} onClick={() => { onChange(employee.id); close(); }}>
          <span>{employee.name.slice(0, 1)}</span>
          <div><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || employee.team || '岗位未设置'}</small></div>
          {employee.id === value && <Check />}
        </button>)}
      </section>)}
      {!matchCount && <p className="issue-picker-empty">没有匹配员工，请尝试姓名、工号、部门或岗位。</p>}
    </div>}
  </div>;
}

export function EmployeeMultiPicker({
  employees,
  values,
  onChange,
  excludeIds = [],
  disabled,
}: BasePickerProps & {
  employees: EmployeeDTO[];
  values: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listboxId = useId();
  const close = (): void => { setOpen(false); setQuery(''); };
  const rootRef = useOutsideClose(open, close);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selected = useMemo(() => values.map(id => employees.find(employee => employee.id === id)).filter((item): item is EmployeeDTO => !!item), [employees, values]);
  const grouped = useMemo(() => groupEmployees(filterEmployees(employees, query)), [employees, query]);
  const matchCount = grouped.reduce((total, group) => total + group.employees.length, 0);

  const toggleEmployee = (employeeId: string): void => {
    if (excluded.has(employeeId)) return;
    onChange(values.includes(employeeId) ? values.filter(id => id !== employeeId) : [...values, employeeId]);
  };

  return <div className={`issue-picker employee-picker multi ${open ? 'open' : ''}`} ref={rootRef}>
    {!!selected.length && <div className="employee-chips">{selected.map(employee => <span key={employee.id}>{employee.name}<small>{employee.employeeNo}</small><button type="button" aria-label={`移除协同人 ${employee.name}`} onClick={() => toggleEmployee(employee.id)}><X /></button></span>)}</div>}
    <div className="issue-picker-control">
      <UserRound aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-label="搜索并选择协同人员"
        aria-expanded={open}
        aria-controls={listboxId}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder="搜索姓名、工号、部门；可选择多人"
        onFocus={() => setOpen(true)}
        onChange={event => { setOpen(true); setQuery(event.target.value); }}
        onKeyDown={event => { if (event.key === 'Escape') close(); }}
      />
      {!!values.length && <button type="button" className="clear" aria-label="清空协同人员" title="清空协同人员" onClick={() => onChange([])}><X /></button>}
      <button type="button" className="toggle" aria-label="展开员工列表" title="展开员工列表" onClick={() => setOpen(current => !current)}><ChevronDown /></button>
    </div>
    {open && <div className="issue-picker-popover employees multi-options" id={listboxId} role="listbox" aria-multiselectable="true">
      <header><strong>按部门选择协同人员</strong><span>已选 {values.length} 人</span></header>
      {grouped.map(group => <section className="employee-group" key={group.department}>
        <h4>{group.department}<span>{group.employees.length}</span></h4>
        {group.employees.map(employee => {
          const isExcluded = excluded.has(employee.id);
          const isSelected = values.includes(employee.id);
          return <button type="button" role="option" aria-selected={isSelected} disabled={isExcluded} className={`employee-option ${isSelected ? 'selected' : ''}`} key={employee.id} onClick={() => toggleEmployee(employee.id)}>
            <span>{employee.name.slice(0, 1)}</span>
            <div><strong>{employee.name}</strong><small>{employee.employeeNo} · {isExcluded ? '已设为负责人' : employee.position || employee.team || '岗位未设置'}</small></div>
            <i className="employee-checkbox">{isSelected && <Check />}</i>
          </button>;
        })}
      </section>)}
      {!matchCount && <p className="issue-picker-empty">没有匹配员工。</p>}
      <footer><span>负责人不会重复加入协同人</span><button type="button" onClick={close}>完成</button></footer>
    </div>}
  </div>;
}
