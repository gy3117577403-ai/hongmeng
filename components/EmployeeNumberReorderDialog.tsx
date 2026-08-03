'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  History,
  ListOrdered,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useModalLayer } from '@/components/useModalLayer';
import type { EmployeeDTO } from '@/types';

type ExistingDraftRow = {
  key: string;
  kind: 'EXISTING';
  employeeId: string;
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  team: string;
  isActive: boolean;
  attendanceEnabled: boolean;
  hireDate: string;
};

type NewDraftRow = {
  key: string;
  kind: 'NEW';
  name: string;
  department: string;
  position: string;
  team: string;
  isActive: boolean;
  attendanceEnabled: boolean;
  hireDate: string;
};

type DraftRow = ExistingDraftRow | NewDraftRow;

type PreviewRow = {
  key: string;
  kind: 'EXISTING' | 'NEW';
  employeeId: string | null;
  oldEmployeeNo: string | null;
  newEmployeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isActive: boolean;
  attendanceEnabled: boolean;
  oldHireDate: string | null;
  hireDate: string | null;
  hireDateChanged: boolean;
  changed: boolean;
};

type ReorderRequestItem =
  | {
    kind: 'EXISTING';
    employeeId: string;
    targetEmployeeNo?: string;
    hireDate?: string | null;
  }
  | {
    kind: 'NEW';
    clientKey: string;
    name: string;
    department: string | null;
    position: string | null;
    team: string | null;
    isActive: boolean;
    attendanceEnabled: boolean;
    targetEmployeeNo?: string;
    hireDate?: string | null;
  };

type ImportSummary = {
  targetCount: number;
  matchedCount: number;
  createdCount: number;
  preservedUnlistedCount: number;
  blankHireDateCount: number;
  firstTargetEmployeeNo: string;
  lastTargetEmployeeNo: string;
  sourceFileName: string;
  sourceSheetName: string;
  headerRowNo: number;
};

type LinkSummary = {
  accountCount: number;
  attendanceCount: number;
  executionCount: number;
  laborClaimCount: number;
  dailyAssignmentCount: number;
  total: number;
};

type ReorderPreview = {
  rows: PreviewRow[];
  rosterFingerprint: string;
  employeeCount: number;
  existingCount: number;
  createdCount: number;
  changedCount: number;
  inactiveCount: number;
  hasChanges: boolean;
  nextEmployeeNo: string;
  confirmationText: string;
  warnings: string[];
  preservedLinks: LinkSummary;
};

type ReorderBatch = {
  id: string;
  employeeCount: number;
  existingCount: number;
  createdCount: number;
  changedCount: number;
  previousNextEmployeeNo: string;
  nextEmployeeNo: string;
  createdAt: string;
  createdByName: string;
  items: Array<{
    employeeId: string;
    sequence: number;
    oldEmployeeNo: string | null;
    newEmployeeNo: string;
    wasCreated: boolean;
    name: string;
    department: string | null;
    position: string | null;
    team: string | null;
    hireDate: string | null;
  }>;
};

type ApiResponse = {
  ok: boolean;
  preview?: ReorderPreview;
  batch?: ReorderBatch;
  batches?: ReorderBatch[];
  employees?: EmployeeDTO[];
  items?: ReorderRequestItem[];
  importSummary?: ImportSummary;
  replayed?: boolean;
  error?: string;
};

function newRow(initial: Partial<NewDraftRow> = {}): NewDraftRow {
  return {
    key: initial.key || crypto.randomUUID(),
    kind: 'NEW',
    name: initial.name || '',
    department: initial.department || '',
    position: initial.position || '',
    team: initial.team || '',
    hireDate: initial.hireDate || '',
    isActive: initial.isActive !== false,
    attendanceEnabled: initial.attendanceEnabled !== false,
  };
}

function existingRow(employee: EmployeeDTO): ExistingDraftRow {
  return {
    key: `existing:${employee.id}`,
    kind: 'EXISTING',
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department || '',
    position: employee.position || '',
    team: employee.team || '',
    hireDate: employee.hireDate || '',
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
  };
}

function requestItems(rows: DraftRow[]): ReorderRequestItem[] {
  return rows.map(row => row.kind === 'EXISTING'
    ? { kind: 'EXISTING' as const, employeeId: row.employeeId }
    : {
      kind: 'NEW' as const,
      clientKey: row.key,
      name: row.name,
      department: row.department,
      position: row.position,
      team: row.team,
      isActive: row.isActive,
      attendanceEnabled: row.attendanceEnabled,
      ...(row.hireDate ? { hireDate: row.hireDate } : {}),
    });
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBatch(batch: ReorderBatch): void {
  const lines = [
    ['顺序', '原员工编号', '新员工编号', '员工姓名', '入职日期', '部门', '岗位', '班组', '人员类型'],
    ...batch.items.map(item => [
      item.sequence,
      item.oldEmployeeNo || '',
      item.newEmployeeNo,
      item.name,
      item.hireDate || '',
      item.department || '',
      item.position || '',
      item.team || '',
      item.wasCreated ? '本次补录' : '现有员工',
    ]),
  ];
  const csv = `\uFEFF${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `员工编号重排-${batch.createdAt.slice(0, 10)}-${batch.id.slice(0, 8)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parsePastedRows(value: string): NewDraftRow[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const delimiter = line.includes('\t') ? '\t' : ',';
      const cells = line.split(delimiter).map(cell => cell.trim());
      if (index === 0 && /姓名/.test(cells[0] || '')) return null;
      return newRow({
        name: cells[0] || '',
        department: cells[1] || '',
        position: cells[2] || '',
        team: cells[3] || '',
        hireDate: cells[4] || '',
      });
    })
    .filter((row): row is NewDraftRow => Boolean(row?.name));
}

export default function EmployeeNumberReorderDialog({
  employees,
  backgroundRef,
  onClose,
  onApplied,
}: {
  employees: EmployeeDTO[];
  backgroundRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onApplied: (employees: EmployeeDTO[]) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => employees.map(existingRow));
  const [phase, setPhase] = useState<'edit' | 'preview' | 'success'>('edit');
  const [preview, setPreview] = useState<ReorderPreview | null>(null);
  const [importItems, setImportItems] = useState<ReorderRequestItem[] | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ReorderBatch | null>(null);
  const [recentBatches, setRecentBatches] = useState<ReorderBatch[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  useModalLayer({
    open: true,
    layerRef,
    initialFocusRef: closeRef,
    backgroundRef,
    onClose: () => { if (!committing) onClose(); },
    lockScroll: true,
    interactionEnabled: !committing,
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/employees/renumber', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as ApiResponse;
        if (response.ok) setRecentBatches(body.batches || []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const newCount = useMemo(() => rows.filter(row => row.kind === 'NEW').length, [rows]);
  const invalidNewCount = useMemo(() => rows.filter(row => row.kind === 'NEW' && !row.name.trim()).length, [rows]);

  function replaceRows(nextRows: DraftRow[]): void {
    setRows(nextRows);
    setPreview(null);
    setImportItems(null);
    setImportSummary(null);
    setPhase('edit');
    setConfirmationText('');
    setError('');
    setIdempotencyKey(crypto.randomUUID());
  }

  function moveRow(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[index], next[target]] = [next[target], next[index]];
    replaceRows(next);
  }

  function updateNewRow(key: string, patch: Partial<NewDraftRow>): void {
    replaceRows(rows.map(row => row.kind === 'NEW' && row.key === key ? { ...row, ...patch } : row));
  }

  async function createPreview(): Promise<void> {
    if (!rows.length) return setError('请先添加至少一名员工');
    if (invalidNewCount) return setError(`还有 ${invalidNewCount} 名补录人员未填写姓名`);
    setPreviewing(true);
    setError('');
    try {
      const response = await fetch('/api/employees/renumber/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: requestItems(rows) }),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.preview) throw new Error(body.error || '编号重排预览失败');
      setPreview(body.preview);
      setImportItems(null);
      setImportSummary(null);
      setPhase('preview');
      setConfirmationText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '编号重排预览失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function commit(): Promise<void> {
    if (!preview) return;
    setCommitting(true);
    setError('');
    try {
      const response = await fetch('/api/employees/renumber', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          items: importItems || requestItems(rows),
          rosterFingerprint: preview.rosterFingerprint,
          confirmationText,
        }),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.batch || !body.employees) {
        throw new Error(body.error || '员工编号重排失败');
      }
      setResult(body.batch);
      setPhase('success');
      onApplied(body.employees);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '员工编号重排失败');
    } finally {
      setCommitting(false);
    }
  }

  function applyBulkRows(): void {
    const parsed = parsePastedRows(bulkText);
    if (!parsed.length) {
      setError('没有识别到补录人员；请按“姓名、部门、岗位、班组、入职日期”粘贴');
      return;
    }
    replaceRows([...rows, ...parsed]);
    setBulkText('');
    setBulkOpen(false);
  }

  async function importTargetRoster(file: File): Promise<void> {
    setImporting(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/employees/renumber/import-preview', {
        method: 'POST',
        body: form,
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.preview || !body.items || !body.importSummary) {
        throw new Error(body.error || '目标工号名单解析失败');
      }
      setPreview(body.preview);
      setImportItems(body.items);
      setImportSummary(body.importSummary);
      setPhase('preview');
      setConfirmationText('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目标工号名单解析失败');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  function returnToEdit(): void {
    setPhase('edit');
    setImportItems(null);
    setImportSummary(null);
    setConfirmationText('');
    setError('');
  }

  return (
    <div className="hr-reorder-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !committing) onClose();
    }}>
      <div ref={layerRef} className="hr-reorder-dialog" role="dialog" aria-modal="true" aria-labelledby="hr-reorder-title" tabIndex={-1}>
        <header>
          <div>
            <span className="hr-eyebrow">人员档案 · 一次性治理</span>
            <h2 id="hr-reorder-title"><ListOrdered />员工编号重排</h2>
            <p>保持员工身份与历史数据不变，仅调整系统唯一业务编号。</p>
          </div>
          <button ref={closeRef} type="button" className="hr-icon-button" disabled={committing} aria-label="关闭编号重排" onClick={onClose}><X /></button>
        </header>

        <nav className="hr-reorder-steps" aria-label="编号重排步骤">
          <span className={phase === 'edit' ? 'active' : 'done'}><i>{phase === 'edit' ? '1' : <Check />}</i>准备名单</span>
          <b />
          <span className={phase === 'preview' ? 'active' : phase === 'success' ? 'done' : ''}><i>{phase === 'success' ? <Check /> : '2'}</i>预览确认</span>
          <b />
          <span className={phase === 'success' ? 'active done' : ''}><i>{phase === 'success' ? <Check /> : '3'}</i>完成封存</span>
        </nav>

        <div className="hr-reorder-body hm-scroll-region">
          {phase === 'edit' && <>
            <section className="hr-reorder-import">
              <span><FileSpreadsheet /></span>
              <div><strong>直接导入目标工号名单</strong><p>识别“姓名、工号、入职日期”，自动匹配现有档案、补录缺失人员，并按目标工号生成预览。</p></div>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void importTargetRoster(file);
                }}
              />
              <button type="button" className="hr-primary-button" disabled={importing} onClick={() => importInputRef.current?.click()}>
                {importing ? <Loader2 className="spin" /> : <Upload />}{importing ? '正在核对…' : '选择名单文件'}
              </button>
            </section>
            <section className="hr-reorder-guard">
              <ShieldCheck />
              <div><strong>现有员工必须全部保留</strong><p>停用员工也保留在名单中，避免历史编号被静默复用。补录人员提交前不会占用正式编号。</p></div>
              <span>{employees.length} 名现有 · {newCount} 名补录</span>
            </section>
            <section className="hr-reorder-toolbar">
              <div><b>手工编排备用方式</b><small>没有目标名单时，可从 0001 开始用上下按钮调整顺序</small></div>
              <div>
                <button type="button" className="hr-secondary-button" onClick={() => replaceRows([...rows, newRow()])}><UserPlus />补录一人</button>
                <button type="button" className="hr-secondary-button" onClick={() => setBulkOpen(value => !value)}><ClipboardPaste />批量粘贴</button>
              </div>
            </section>
            {bulkOpen && <section className="hr-reorder-bulk">
              <label><span>从 Excel 复制后直接粘贴</span><small>列顺序：姓名、部门、岗位、班组、入职日期；支持制表符或逗号。</small><textarea value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'姓名\t部门\t岗位\t班组\t入职日期\n张三\t生产部\t操作员\t装配\t2026-08-03'} /></label>
              <div><button type="button" className="hr-text-button" onClick={() => { setBulkOpen(false); setBulkText(''); }}>取消</button><button type="button" className="hr-primary-button" onClick={applyBulkRows}><Plus />加入名单</button></div>
            </section>}
            <section className="hr-reorder-table" aria-label="员工编号重排名单">
              <header><span>顺序/目标编号</span><span>原编号/类型</span><span>员工姓名</span><span>入职日期</span><span>部门</span><span>岗位</span><span>班组</span><span>调整</span></header>
              <div>
                {rows.map((row, index) => <article key={row.key} className={row.kind === 'NEW' ? 'is-new' : ''}>
                  <span><b>{index + 1}</b><strong>{String(index + 1).padStart(4, '0')}</strong></span>
                  <span>{row.kind === 'EXISTING' ? <><strong>{row.employeeNo}</strong><small className={row.isActive ? '' : 'inactive'}>{row.isActive ? '现有员工' : '停用员工'}</small></> : <><strong>待分配</strong><small>本次补录</small></>}</span>
                  {row.kind === 'EXISTING'
                    ? <span><strong>{row.name}</strong><small>{row.attendanceEnabled ? '考勤启用' : '未启用考勤'}</small></span>
                    : <label><span className="sr-only">补录员工姓名</span><input value={row.name} maxLength={80} onChange={event => updateNewRow(row.key, { name: event.target.value })} placeholder="员工姓名 *" /></label>}
                  {row.kind === 'EXISTING' ? <span>{row.hireDate || '未维护'}</span> : <input type="date" value={row.hireDate} onChange={event => updateNewRow(row.key, { hireDate: event.target.value })} />}
                  {row.kind === 'EXISTING' ? <span>{row.department || '未维护'}</span> : <input value={row.department} maxLength={80} onChange={event => updateNewRow(row.key, { department: event.target.value })} placeholder="部门" />}
                  {row.kind === 'EXISTING' ? <span>{row.position || '未维护'}</span> : <input value={row.position} maxLength={80} onChange={event => updateNewRow(row.key, { position: event.target.value })} placeholder="岗位" />}
                  {row.kind === 'EXISTING' ? <span>{row.team || '未维护'}</span> : <input value={row.team} maxLength={80} onChange={event => updateNewRow(row.key, { team: event.target.value })} placeholder="班组" />}
                  <span className="hr-reorder-row-actions">
                    <button type="button" disabled={index === 0} aria-label={`上移 ${row.name || '补录人员'}`} onClick={() => moveRow(index, -1)}><ArrowUp /></button>
                    <button type="button" disabled={index === rows.length - 1} aria-label={`下移 ${row.name || '补录人员'}`} onClick={() => moveRow(index, 1)}><ArrowDown /></button>
                    {row.kind === 'NEW' && <button type="button" className="danger" aria-label={`删除 ${row.name || '补录人员'}`} onClick={() => replaceRows(rows.filter(item => item.key !== row.key))}><Trash2 /></button>}
                  </span>
                </article>)}
                {!rows.length && <div className="hr-reorder-empty"><UserPlus /><strong>名单为空</strong><p>请补录人员后再生成编号预览。</p></div>}
              </div>
            </section>
            {recentBatches[0] && <section className="hr-reorder-history"><History /><span><b>最近一次编号重排</b><small>{new Date(recentBatches[0].createdAt).toLocaleString('zh-CN')} · {recentBatches[0].createdByName} · {recentBatches[0].employeeCount} 人</small></span><em>下一编号 {recentBatches[0].nextEmployeeNo}</em></section>}
          </>}

          {phase === 'preview' && preview && <>
            <section className="hr-reorder-preview-metrics">
              <article><span>最终人数</span><strong>{preview.employeeCount}</strong><small>{preview.existingCount} 现有 + {preview.createdCount} 补录</small></article>
              <article><span>发生变更</span><strong>{preview.changedCount}</strong><small>原号与目标号不同或新建</small></article>
              <article><span>历史关联</span><strong>{preview.preservedLinks.total}</strong><small>全部继续绑定员工 UUID</small></article>
              <article className="accent"><span>下一新员工编号</span><strong>{preview.nextEmployeeNo}</strong><small>本批次成功后自动生效</small></article>
            </section>
            {importSummary && <section className="hr-reorder-import-summary">
              <FileSpreadsheet />
              <div><b>{importSummary.sourceFileName} · {importSummary.sourceSheetName}</b><p>目标 {importSummary.targetCount} 人：匹配现有 {importSummary.matchedCount} 人，补录 {importSummary.createdCount} 人；名单外现有员工保留并顺延 {importSummary.preservedUnlistedCount} 人。</p></div>
              <span>{importSummary.firstTargetEmployeeNo}–{importSummary.lastTargetEmployeeNo}</span>
            </section>}
            <section className="hr-reorder-link-proof">
              <ShieldCheck /><div><b>关联保护检查通过</b><p>账号 {preview.preservedLinks.accountCount}、考勤 {preview.preservedLinks.attendanceCount}、生产记录 {preview.preservedLinks.executionCount}、工时领取 {preview.preservedLinks.laborClaimCount}、日计划分配 {preview.preservedLinks.dailyAssignmentCount} 条均按员工 UUID 保留。</p></div>
            </section>
            <section className="hr-reorder-preview-list">
              <header><span>顺序</span><span>员工</span><span>原编号</span><span>新编号</span><span>变化</span></header>
              <div>{preview.rows.map((row, index) => <article key={row.key}>
                <span>{index + 1}</span><span><b>{row.name}</b><small>{row.department || '部门未维护'} · 入职 {row.hireDate || '未提供'}</small></span><span>{row.oldEmployeeNo || '补录新增'}</span><strong>{row.newEmployeeNo}</strong><em className={row.changed ? 'changed' : ''}>{row.kind === 'NEW' ? '新建档案' : row.oldEmployeeNo !== row.newEmployeeNo && row.hireDateChanged ? '编号+日期' : row.oldEmployeeNo !== row.newEmployeeNo ? '编号变更' : row.hireDateChanged ? '日期更新' : '保持不变'}</em>
              </article>)}</div>
            </section>
            <section className="hr-reorder-confirm">
              <AlertTriangle /><div><b>这是一次性全量操作</b><p>提交时会锁定编号序列并在一个事务中完成；任一失败将全部回滚。请输入 <strong>{preview.confirmationText}</strong>。</p><input value={confirmationText} onChange={event => setConfirmationText(event.target.value)} placeholder={preview.confirmationText} /></div>
            </section>
          </>}

          {phase === 'success' && result && <section className="hr-reorder-success">
            <span><CheckCircle2 /></span>
            <h3>员工编号重排已完成并封存</h3>
            <p>{result.employeeCount} 名员工已按最终顺序处理，其中补录 {result.createdCount} 人；所有历史数据仍关联原员工身份。</p>
            <div><article><small>本次变更</small><strong>{result.changedCount} 人</strong></article><article><small>下一新员工编号</small><strong>{result.nextEmployeeNo}</strong></article><article><small>执行人</small><strong>{result.createdByName}</strong></article><article><small>批次</small><strong>{result.id.slice(0, 8)}</strong></article></div>
            <button type="button" className="hr-secondary-button" onClick={() => downloadBatch(result)}><Download />导出编号对照表</button>
          </section>}
        </div>

        {error && <div className="hr-reorder-error" role="alert"><AlertTriangle />{error}</div>}
        <footer>
          {phase === 'edit' && <><button type="button" className="hr-secondary-button" onClick={onClose}>取消</button><button type="button" className="hr-primary-button" disabled={importing || previewing || invalidNewCount > 0 || rows.length === 0} onClick={() => void createPreview()}>{previewing ? <Loader2 className="spin" /> : <ListOrdered />}{previewing ? '正在校验…' : '生成手工预览'}</button></>}
          {phase === 'preview' && preview && <><button type="button" className="hr-secondary-button" disabled={committing} onClick={returnToEdit}>{importSummary ? '重新选择名单' : '返回调整'}</button><button type="button" className="hr-primary-button danger" disabled={committing || confirmationText !== preview.confirmationText || !preview.hasChanges} onClick={() => void commit()}>{committing ? <Loader2 className="spin" /> : <ShieldCheck />}{committing ? '正在事务执行…' : '确认并执行重排'}</button></>}
          {phase === 'success' && <button type="button" className="hr-primary-button" onClick={onClose}><Check />完成</button>}
        </footer>
      </div>
    </div>
  );
}
