'use client';

import { Check, ChevronDown, Copy, Search, UserRound, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EmployeeDTO, WorkOrderDTO } from '@/types';

type BasePickerProps = {
  disabled?: boolean;
};

function workOrderCode(order: WorkOrderDTO): string {
  return order.displayCode || order.businessCode || order.code;
}

function workOrderTitle(order: WorkOrderDTO): string {
  const copyCode = workOrderCode(order);
  return [order.businessCode, order.productName, order.code]
    .map(value => value?.trim())
    .find(value => value && value !== copyCode) || copyCode;
}

function searchText(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

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
  orders,
  value,
  onChange,
  onCopied,
  disabled,
}: BasePickerProps & {
  orders: WorkOrderDTO[];
  value: string;
  onChange: (id: string) => void;
  onCopied?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listboxId = useId();
  const selected = useMemo(() => orders.find(order => order.id === value) || null, [orders, value]);
  const close = (): void => { setOpen(false); setQuery(''); };
  const rootRef = useOutsideClose(open, close);
  const normalizedQuery = searchText(query);
  const filtered = useMemo(() => {
    const sorted = orders.slice().sort((first, second) => workOrderTitle(first).localeCompare(workOrderTitle(second), 'zh-CN'));
    if (!normalizedQuery) return sorted.slice(0, 80);
    return sorted.filter(order => [
      workOrderCode(order), order.code, order.businessCode, order.specification,
      order.customerName, order.productName, order.sourceOrderNo,
    ].some(item => searchText(item).includes(normalizedQuery))).slice(0, 80);
  }, [normalizedQuery, orders]);

  const displayValue = open ? query : selected
    ? `${workOrderTitle(selected)} · ${workOrderCode(selected)}`
    : '';

  const copySelected = async (): Promise<void> => {
    if (!selected) return;
    const code = workOrderCode(selected);
    await copyToClipboard(code);
    onCopied?.(`已复制工单编号：${code}`);
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
        autoComplete="off"
        disabled={disabled}
        value={displayValue}
        placeholder="输入工单号、产品规格、客户或订单号"
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={event => { setOpen(true); setQuery(event.target.value); }}
        onKeyDown={event => {
          if (event.key === 'Escape') close();
          if (event.key === 'Enter' && open && filtered[0]) {
            event.preventDefault();
            onChange(filtered[0].id);
            close();
          }
        }}
      />
      {selected && <button type="button" className="copy" title="复制工单编号" aria-label="复制工单编号" onClick={() => { void copySelected(); }}><Copy /></button>}
      {selected && <button type="button" className="clear" title="取消关联工单" aria-label="取消关联工单" onClick={() => { onChange(''); close(); }}><X /></button>}
      <button type="button" className="toggle" title="展开工单列表" aria-label="展开工单列表" onClick={() => setOpen(current => !current)}><ChevronDown /></button>
    </div>
    {open && <div className="issue-picker-popover work-orders" id={listboxId} role="listbox">
      <header><strong>选择关联工单</strong><span>{filtered.length} 条匹配</span></header>
      {!normalizedQuery && <button type="button" className={`issue-picker-option none ${!value ? 'selected' : ''}`} onClick={() => { onChange(''); close(); }}><span>不关联工单</span><small>用于无法对应具体生产工单的问题</small>{!value && <Check />}</button>}
      {filtered.map(order => {
        const code = workOrderCode(order);
        return <div className={`issue-picker-option ${order.id === value ? 'selected' : ''}`} role="option" aria-selected={order.id === value} key={order.id}>
          <button type="button" className="option-main" onClick={() => { onChange(order.id); close(); }}>
            <strong>{workOrderTitle(order)}</strong>
            <span>{code}</span>
            <small>{order.customerName || '客户未设置'} · {order.productName}</small>
          </button>
          <button type="button" className="option-copy" aria-label={`复制工单编号 ${code}`} title="复制工单编号" onClick={() => { void copyToClipboard(code).then(() => onCopied?.(`已复制工单编号：${code}`)); }}><Copy /></button>
          {order.id === value && <Check className="option-check" />}
        </div>;
      })}
      {!filtered.length && <p className="issue-picker-empty">没有匹配工单，请换工单号、规格或客户名称搜索。</p>}
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
