'use client';

import {
  Archive,
  Boxes,
  Check,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  FileUp,
  FilterX,
  History,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { PdfViewer } from '@/components/PdfViewer';
import { useToastBridge } from '@/components/ToastProvider';
import type {
  CurrentUserDTO,
  EightDReportDTO,
  EightDReportIssueDTO,
  EightDReportProductDTO,
  EightDReportStatus,
  EightDReportSummaryDTO,
  EightDReportVersionDTO,
} from '@/types';

type EightDArchiveShellProps = { user: CurrentUserDTO };
type StatusFilter = 'all' | 'active' | 'archived' | 'unlinked' | 'deleted';
type BrowseMode = 'matrix' | 'product' | 'issue' | 'all';
type DetailTab = 'versions' | 'relations' | 'activity';

type ListResponse = {
  ok: boolean;
  reports: EightDReportDTO[];
  summary: EightDReportSummaryDTO;
  error?: string;
};

type OptionsResponse = {
  ok: boolean;
  products: EightDReportProductDTO[];
  issues: EightDReportIssueDTO[];
  error?: string;
};

type MutationResponse = { ok: boolean; report?: EightDReportDTO; error?: string };

type ReportForm = {
  reportNo: string;
  title: string;
  reportDate: string;
  responsibleDepartment: string;
  keywords: string;
  status: EightDReportStatus;
  productIds: string[];
  issueIds: string[];
  displayName: string;
  note: string;
};

const emptySummary: EightDReportSummaryDTO = {
  total: 0,
  active: 0,
  archived: 0,
  deleted: 0,
  productCount: 0,
  issueCount: 0,
  unlinked: 0,
};

const emptyForm: ReportForm = {
  reportNo: '',
  title: '',
  reportDate: '',
  responsibleDepartment: '',
  keywords: '',
  status: 'active',
  productIds: [],
  issueIds: [],
  displayName: '',
  note: '',
};

const statusLabels: Record<StatusFilter, string> = {
  all: '全部档案',
  active: '在用',
  archived: '已归档',
  unlinked: '待关联',
  deleted: '回收站',
};

const issueStatusLabels: Record<string, string> = {
  pending: '待受理',
  processing: '处理中',
  verifying: '待验证',
  awaiting_confirmation: '待确认',
  closed: '已完结',
};

const activityLabels: Record<string, string> = {
  created: '建立档案',
  updated: '更新档案',
  version_uploaded: '上传版本',
  current_version_changed: '切换当前版',
  version_deleted: '删除版本',
  version_restored: '恢复版本',
  deleted: '移入回收站',
  restored: '恢复档案',
};

function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

function dateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function productTitle(product: EightDReportProductDTO): string {
  return product.specification || product.productName || product.customerCode || '未命名产品';
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function reportToForm(report: EightDReportDTO): ReportForm {
  return {
    reportNo: report.reportNo,
    title: report.title,
    reportDate: dateInput(report.reportDate),
    responsibleDepartment: report.responsibleDepartment || '',
    keywords: report.keywords || '',
    status: report.status,
    productIds: report.products.map(item => item.id),
    issueIds: report.issues.map(item => item.id),
    displayName: '',
    note: '',
  };
}

export default function EightDArchiveShell({ user }: EightDArchiveShellProps) {
  const searchParams = useSearchParams();
  const initialIssueId = searchParams.get('issueId') || '';
  const initialProductId = searchParams.get('productId') || '';
  const initialReportId = searchParams.get('reportId') || '';
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [browseMode, setBrowseMode] = useState<BrowseMode>(initialIssueId ? 'issue' : initialProductId ? 'product' : 'matrix');
  const [reports, setReports] = useState<EightDReportDTO[]>([]);
  const [summary, setSummary] = useState<EightDReportSummaryDTO>(emptySummary);
  const [products, setProducts] = useState<EightDReportProductDTO[]>([]);
  const [issues, setIssues] = useState<EightDReportIssueDTO[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(initialProductId);
  const [selectedIssueId, setSelectedIssueId] = useState(initialIssueId);
  const [selectedReportId, setSelectedReportId] = useState(initialReportId);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [issueQuery, setIssueQuery] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('versions');
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<EightDReportDTO | null>(null);
  const [form, setForm] = useState<ReportForm>(emptyForm);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [relationQuery, setRelationQuery] = useState({ products: '', issues: '' });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionDisplayName, setVersionDisplayName] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [deleteReport, setDeleteReport] = useState<EightDReportDTO | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const requestSequence = useRef(0);
  useToastBridge(toast, setToast);

  const isAdmin = user.laborRole === 'ADMIN';
  const canCreate = isAdmin || user.access.capabilities.includes('QUALITY:CREATE')
    || user.access.capabilities.includes('ISSUE_MANAGEMENT:CREATE');
  const canUpdate = isAdmin || user.access.capabilities.includes('QUALITY:UPDATE')
    || user.access.capabilities.includes('ISSUE_MANAGEMENT:UPDATE');
  const canDelete = isAdmin || user.access.capabilities.includes('QUALITY:DELETE')
    || user.access.capabilities.includes('ISSUE_MANAGEMENT:DELETE');

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const data = await jsonRequest<OptionsResponse>('/api/quality/8d/options');
      setProducts(data.products || []);
      setIssues(data.issues || []);
    } catch (loadError) {
      setToast(loadError instanceof Error ? loadError.message : '关联选项加载失败');
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '400' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (selectedProductId) params.set('productId', selectedProductId);
      if (selectedIssueId) params.set('issueId', selectedIssueId);
      const data = await jsonRequest<ListResponse>(`/api/quality/8d?${params.toString()}`);
      if (requestSequence.current !== sequence) return;
      const nextReports = data.reports || [];
      setReports(nextReports);
      setSummary(data.summary || emptySummary);
      setSelectedReportId(current => nextReports.some(item => item.id === current)
        ? current
        : nextReports.some(item => item.id === initialReportId)
          ? initialReportId
          : nextReports[0]?.id || '');
    } catch (loadError) {
      if (requestSequence.current !== sequence) return;
      setError(loadError instanceof Error ? loadError.message : '8D档案加载失败');
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [initialReportId, keyword, selectedIssueId, selectedProductId, status]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadReports(); }, 220);
    return () => window.clearTimeout(timer);
  }, [loadReports]);

  const selectedReport = useMemo(
    () => reports.find(report => report.id === selectedReportId) || null,
    [reports, selectedReportId],
  );

  useEffect(() => {
    setSelectedVersionId(current => {
      if (selectedReport?.versions.some(version => version.id === current)) return current;
      return selectedReport?.currentVersionId || selectedReport?.versions.find(version => !version.deletedAt)?.id || '';
    });
  }, [selectedReport]);

  const selectedVersion = useMemo(
    () => selectedReport?.versions.find(version => version.id === selectedVersionId)
      || selectedReport?.currentVersion
      || null,
    [selectedReport, selectedVersionId],
  );

  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach(report => report.products.forEach(product => counts.set(product.id, (counts.get(product.id) || 0) + 1)));
    return counts;
  }, [reports]);

  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach(report => report.issues.forEach(issue => counts.set(issue.id, (counts.get(issue.id) || 0) + 1)));
    return counts;
  }, [reports]);

  const visibleProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter(product => [product.customerName, product.customerCode, product.productName, product.specification]
      .some(value => value?.toLowerCase().includes(query)));
  }, [productQuery, products]);

  const visibleIssues = useMemo(() => {
    const query = issueQuery.trim().toLowerCase();
    if (!query) return issues;
    return issues.filter(issue => [issue.code, issue.title, issue.workOrder?.code, issue.workOrder?.specification]
      .some(value => value?.toLowerCase().includes(query)));
  }, [issueQuery, issues]);

  function updateReport(next: EightDReportDTO): void {
    setReports(current => {
      const exists = current.some(report => report.id === next.id);
      return exists ? current.map(report => report.id === next.id ? next : report) : [next, ...current];
    });
    setSelectedReportId(next.id);
    setSelectedVersionId(next.currentVersionId || '');
  }

  function selectProduct(id: string): void {
    setSelectedProductId(current => current === id ? '' : id);
    setBrowseMode('product');
  }

  function selectIssue(id: string): void {
    setSelectedIssueId(current => current === id ? '' : id);
    setBrowseMode('issue');
  }

  function clearRelations(): void {
    setSelectedProductId('');
    setSelectedIssueId('');
  }

  function openCreate(): void {
    const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date());
    setEditingReport(null);
    setForm({
      ...emptyForm,
      reportNo: `8D-${year}-`,
      productIds: selectedProductId ? [selectedProductId] : [],
      issueIds: selectedIssueId ? [selectedIssueId] : [],
    });
    setFormFile(null);
    setFormError('');
    setRelationQuery({ products: '', issues: '' });
    setFormOpen(true);
  }

  function openEdit(): void {
    if (!selectedReport) return;
    setEditingReport(selectedReport);
    setForm(reportToForm(selectedReport));
    setFormFile(null);
    setFormError('');
    setRelationQuery({ products: '', issues: '' });
    setFormOpen(true);
  }

  function closeForm(): void {
    if (saving) return;
    setFormOpen(false);
    setEditingReport(null);
    setFormFile(null);
    setFormError('');
  }

  async function saveReport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    if (!form.reportNo.trim() || !form.title.trim()) {
      setFormError('请填写报告编号和报告标题');
      return;
    }
    if (!editingReport && !formFile) {
      setFormError('首次建立档案必须选择一份 PDF');
      return;
    }
    setSaving(true);
    try {
      let data: MutationResponse;
      if (editingReport) {
        data = await jsonRequest<MutationResponse>(`/api/quality/8d/${editingReport.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, expectedVersion: editingReport.version }),
        });
      } else {
        const payload = new FormData();
        payload.set('reportNo', form.reportNo);
        payload.set('title', form.title);
        payload.set('reportDate', form.reportDate);
        payload.set('responsibleDepartment', form.responsibleDepartment);
        payload.set('keywords', form.keywords);
        payload.set('status', form.status);
        payload.set('productIds', JSON.stringify(form.productIds));
        payload.set('issueIds', JSON.stringify(form.issueIds));
        payload.set('displayName', form.displayName);
        payload.set('note', form.note);
        payload.set('file', formFile as File);
        data = await jsonRequest<MutationResponse>('/api/quality/8d', { method: 'POST', body: payload });
      }
      if (!data.report) throw new Error('档案保存结果为空');
      updateReport(data.report);
      setFormOpen(false);
      setEditingReport(null);
      setFormFile(null);
      setToast(editingReport ? '8D档案与关联已更新' : '8D PDF档案已创建');
      void loadReports();
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '档案保存失败');
    } finally {
      setSaving(false);
    }
  }

  function openVersionUpload(): void {
    if (!selectedReport) return;
    setVersionFile(null);
    setVersionDisplayName('');
    setVersionNote('');
    setVersionOpen(true);
  }

  async function uploadVersion(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedReport || !versionFile) {
      setToast('请选择新的 PDF 版本');
      return;
    }
    setSaving(true);
    try {
      const payload = new FormData();
      payload.set('file', versionFile);
      payload.set('expectedVersion', String(selectedReport.version));
      payload.set('displayName', versionDisplayName);
      payload.set('note', versionNote);
      const data = await jsonRequest<MutationResponse>(`/api/quality/8d/${selectedReport.id}/versions`, { method: 'POST', body: payload });
      if (!data.report) throw new Error('版本上传结果为空');
      updateReport(data.report);
      setVersionOpen(false);
      setToast('新 PDF 版本已上传并设为当前版本');
      void loadReports();
    } catch (uploadError) {
      setToast(uploadError instanceof Error ? uploadError.message : '版本上传失败');
    } finally {
      setSaving(false);
    }
  }

  async function setCurrentVersion(version: EightDReportVersionDTO): Promise<void> {
    if (!selectedReport || version.deletedAt || version.id === selectedReport.currentVersionId) return;
    setSaving(true);
    try {
      const data = await jsonRequest<MutationResponse>(`/api/quality/8d/${selectedReport.id}/versions/${version.id}/current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: selectedReport.version }),
      });
      if (!data.report) throw new Error('版本切换结果为空');
      updateReport(data.report);
      setToast(`${version.versionLabel} 已设为当前版本`);
    } catch (mutationError) {
      setToast(mutationError instanceof Error ? mutationError.message : '版本切换失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteVersion(version: EightDReportVersionDTO): Promise<void> {
    if (!selectedReport || version.deletedAt) return;
    if (!window.confirm(`确认将 ${version.versionLabel} 移入回收站？对象存储中的 PDF 不会被物理删除。`)) return;
    setSaving(true);
    try {
      const data = await jsonRequest<MutationResponse>(`/api/quality/8d/${selectedReport.id}/versions/${version.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: selectedReport.version }),
      });
      if (!data.report) throw new Error('版本删除结果为空');
      updateReport(data.report);
      setToast(`${version.versionLabel} 已移入回收站`);
    } catch (mutationError) {
      setToast(mutationError instanceof Error ? mutationError.message : '版本删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(version: EightDReportVersionDTO): Promise<void> {
    if (!selectedReport || !version.deletedAt) return;
    setSaving(true);
    try {
      const data = await jsonRequest<MutationResponse>(`/api/quality/8d/${selectedReport.id}/versions/${version.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: selectedReport.version }),
      });
      if (!data.report) throw new Error('版本恢复结果为空');
      updateReport(data.report);
      setToast(`${version.versionLabel} 已恢复`);
    } catch (mutationError) {
      setToast(mutationError instanceof Error ? mutationError.message : '版本恢复失败');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteReport(): Promise<void> {
    if (!deleteReport || !deleteReason.trim()) return;
    setSaving(true);
    try {
      await jsonRequest<{ ok: boolean }>(`/api/quality/8d/${deleteReport.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: deleteReport.version, reason: deleteReason }),
      });
      setDeleteReport(null);
      setDeleteReason('');
      setSelectedReportId('');
      setToast('8D档案已移入回收站，PDF原文件仍保留');
      void loadReports();
    } catch (mutationError) {
      setToast(mutationError instanceof Error ? mutationError.message : '档案删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function restoreReport(): Promise<void> {
    if (!selectedReport?.deletedAt) return;
    setSaving(true);
    try {
      const data = await jsonRequest<MutationResponse>(`/api/quality/8d/${selectedReport.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: selectedReport.version }),
      });
      if (!data.report) throw new Error('档案恢复结果为空');
      setToast('8D档案已恢复');
      setStatus('all');
      setSelectedReportId(data.report.id);
    } catch (mutationError) {
      setToast(mutationError instanceof Error ? mutationError.message : '档案恢复失败');
    } finally {
      setSaving(false);
    }
  }

  const statusItems: Array<[StatusFilter, string, number]> = [
    ['all', '全部档案', summary.total],
    ['active', '在用', summary.active],
    ['archived', '已归档', summary.archived],
    ['unlinked', '待关联', summary.unlinked],
    ['deleted', '回收站', summary.deleted],
  ];

  const formProducts = products.filter(product => {
    const query = relationQuery.products.trim().toLowerCase();
    return !query || [product.customerName, product.productName, product.specification, product.customerCode]
      .some(value => value?.toLowerCase().includes(query));
  });
  const formIssues = issues.filter(issue => {
    const query = relationQuery.issues.trim().toLowerCase();
    return !query || [issue.code, issue.title, issue.workOrder?.code, issue.workOrder?.specification]
      .some(value => value?.toLowerCase().includes(query));
  });

  return <main className="hm-workbench-root hm-eight-d-workbench">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/quality/8d"
      subtitle="质量档案与问题追溯"
      menuItems={[{ label: '返回问题管理', href: '/workspace/issues' }]}
      hideHeader
      sidebarTriggerTargetId="eight-d-navigation-trigger"
    />
    <div className="eight-d-main">
      <WorkbenchCockpitCommand
        navigationTargetId="eight-d-navigation-trigger"
        icon={<FileArchive size={20} />}
        title="8D PDF档案库"
        subtitle="产品、质量问题与受控 PDF 版本"
        context={<><span>{summary.productCount} 个关联产品</span><span>{summary.issueCount} 个关联问题</span><span>{summary.unlinked} 份待关联</span></>}
        search={<label className="eight-d-global-search"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、标题、产品、问题或文件名" />{keyword && <button type="button" title="清空搜索" onClick={() => setKeyword('')}><X size={14} /></button>}</label>}
        actions={<>
          <button className="icon-only" type="button" title="刷新" disabled={loading} onClick={() => { void Promise.all([loadReports(), loadOptions()]); }}><RefreshCw className={loading ? 'spin' : ''} size={16} /></button>
          {canCreate && <button className="primary" type="button" onClick={openCreate}><Plus size={16} />上传8D PDF</button>}
        </>}
      />

      <section className="eight-d-summary hm-cockpit-stage-rail" aria-label="8D档案状态">
        {statusItems.map(([key, label, count]) => <button className={status === key ? 'active' : ''} type="button" key={key} onClick={() => setStatus(key)}><span>{label}</span><strong>{count}</strong></button>)}
        <div className="eight-d-mode-tabs" role="tablist" aria-label="关联浏览方式">
          {([['matrix', '关联矩阵'], ['product', '按产品'], ['issue', '按问题'], ['all', '全部']] as Array<[BrowseMode, string]>).map(([key, label]) => <button className={browseMode === key ? 'active' : ''} type="button" role="tab" aria-selected={browseMode === key} key={key} onClick={() => setBrowseMode(key)}>{label}</button>)}
        </div>
      </section>

      <section className={`eight-d-workspace mode-${browseMode}`}>
        <aside className="eight-d-relations" aria-label="产品与质量问题筛选">
          <header className="relation-panel-header">
            <div><Link2 size={15} /><strong>关联筛选</strong></div>
            {(selectedProductId || selectedIssueId) && <button type="button" onClick={clearRelations}><FilterX size={14} />清除</button>}
          </header>
          <section className="relation-group products">
            <header><span><Boxes size={14} />产品</span><em>{products.length}</em></header>
            <label><Search size={13} /><input value={productQuery} onChange={event => setProductQuery(event.target.value)} placeholder="客户、规格、产品" /></label>
            <div className="relation-list hm-scroll-region">
              {optionsLoading && <div className="relation-loading"><Loader2 className="spin" />加载产品</div>}
              {!optionsLoading && visibleProducts.map(product => <button className={selectedProductId === product.id ? 'active' : ''} type="button" key={product.id} title={`${product.customerName} · ${productTitle(product)}`} onClick={() => selectProduct(product.id)}>
                <span className="relation-avatar">{(product.customerName || '产').slice(0, 1)}</span>
                <span><strong>{productTitle(product)}</strong><small>{product.customerName || '未设置客户'}{product.productName ? ` · ${product.productName}` : ''}</small></span>
                <em>{productCounts.get(product.id) || 0}</em>
              </button>)}
              {!optionsLoading && !visibleProducts.length && <p className="relation-empty">没有匹配的产品</p>}
            </div>
          </section>
          <section className="relation-group issues">
            <header><span><ShieldAlert size={14} />质量问题</span><em>{issues.length}</em></header>
            <label><Search size={13} /><input value={issueQuery} onChange={event => setIssueQuery(event.target.value)} placeholder="问题编号、标题、工单" /></label>
            <div className="relation-list hm-scroll-region">
              {optionsLoading && <div className="relation-loading"><Loader2 className="spin" />加载问题</div>}
              {!optionsLoading && visibleIssues.map(issue => <button className={selectedIssueId === issue.id ? 'active' : ''} type="button" key={issue.id} title={`${issue.code} · ${issue.title}`} onClick={() => selectIssue(issue.id)}>
                <span className={`issue-dot priority-${issue.priority}`} />
                <span><strong>{issue.code} · {issue.title}</strong><small>{issueStatusLabels[issue.status] || issue.status}{issue.workOrder ? ` · ${issue.workOrder.specification || issue.workOrder.code}` : ''}</small></span>
                <em>{issueCounts.get(issue.id) || 0}</em>
              </button>)}
              {!optionsLoading && !visibleIssues.length && <p className="relation-empty">没有匹配的问题</p>}
            </div>
          </section>
        </aside>

        <section className="eight-d-queue" aria-label="8D档案队列">
          <header>
            <div><span>{statusLabels[status]}</span><strong>{reports.length}</strong></div>
            <small>{selectedProductId && selectedIssueId ? '产品 ∩ 问题' : selectedProductId ? '已按产品筛选' : selectedIssueId ? '已按问题筛选' : '最近更新优先'}</small>
          </header>
          <div className="eight-d-queue-list hm-scroll-region">
            {loading && <div className="eight-d-state"><Loader2 className="spin" /><strong>正在加载8D档案</strong></div>}
            {!loading && error && <div className="eight-d-state error"><ShieldAlert /><strong>{error}</strong><button type="button" onClick={() => { void loadReports(); }}>重试</button></div>}
            {!loading && !error && !reports.length && <div className="eight-d-state"><FileArchive /><strong>当前条件下没有8D档案</strong><p>可调整关联筛选，或上传一份已经制作完成的 8D PDF。</p>{canCreate && <button type="button" onClick={openCreate}>上传8D PDF</button>}</div>}
            {!loading && reports.map(report => <button className={`eight-d-card ${selectedReportId === report.id ? 'active' : ''} ${report.deletedAt ? 'deleted' : ''}`} type="button" key={report.id} onClick={() => setSelectedReportId(report.id)}>
              <header><span className={`report-state state-${report.deletedAt ? 'deleted' : report.status}`}>{report.deletedAt ? '回收站' : report.status === 'active' ? '在用' : '已归档'}</span><em>{report.currentVersion?.versionLabel || '无版本'}</em></header>
              <strong>{report.reportNo}</strong>
              <h3>{report.title}</h3>
              <div className="report-link-counts"><span><Boxes size={12} />{report.products.length} 产品</span><span><ShieldAlert size={12} />{report.issues.length} 问题</span><span><History size={12} />{report.versions.filter(version => !version.deletedAt).length} 版本</span></div>
              <footer><span>{report.responsibleDepartment || '未设置责任部门'}</span><time>{formatDate(report.updatedAt, true)}</time></footer>
              {selectedReportId === report.id && <ChevronRight className="active-arrow" size={16} />}
            </button>)}
          </div>
        </section>

        <section className="eight-d-detail" aria-label="8D PDF预览与档案详情">
          {!selectedReport ? <div className="eight-d-detail-empty"><FileText /><h2>选择一份8D档案</h2><p>右侧将显示 PDF、版本历史、产品与问题关联。</p></div> : <>
            <header className="eight-d-detail-header">
              <div><span>{selectedReport.reportNo}</span><h2>{selectedReport.title}</h2><small>{formatDate(selectedReport.reportDate)} · {selectedReport.responsibleDepartment || '责任部门未设置'}</small></div>
              <nav>
                {selectedReport.deletedAt ? <button className="restore" type="button" disabled={!canUpdate || saving} onClick={() => { void restoreReport(); }}><RotateCcw size={14} />恢复</button> : <>
                  {canUpdate && <button type="button" disabled={saving} onClick={openEdit} title="编辑档案与关联"><Pencil size={14} />编辑</button>}
                  {canUpdate && <button type="button" disabled={saving} onClick={openVersionUpload} title="上传新PDF版本"><FileUp size={14} />新版本</button>}
                  {selectedVersion && !selectedVersion.deletedAt && <a href={selectedVersion.downloadUrl} title="下载当前查看版本"><Download size={14} />下载</a>}
                  {canDelete && <button className="danger" type="button" disabled={saving} onClick={() => { setDeleteReport(selectedReport); setDeleteReason(''); }} title="移入回收站"><Trash2 size={14} /></button>}
                </>}
              </nav>
            </header>
            <div className="eight-d-preview">
              {selectedVersion && !selectedReport.deletedAt && !selectedVersion.deletedAt ? <PdfViewer
                key={selectedVersion.id}
                fileId={selectedVersion.id}
                title={`${selectedReport.reportNo} · ${selectedVersion.versionLabel} · ${selectedVersion.displayName || selectedVersion.originalName}`}
                dashboardMode
                contentUrl={selectedVersion.contentUrl}
                downloadUrl={selectedVersion.downloadUrl}
                viewUrl={selectedVersion.contentUrl}
              /> : <div className="eight-d-preview-empty"><FileText /><strong>{selectedReport.deletedAt || selectedVersion?.deletedAt ? '恢复后可预览该 PDF' : '没有可预览的 PDF 版本'}</strong></div>}
            </div>
            <div className="eight-d-detail-tabs" role="tablist">
              <button className={detailTab === 'versions' ? 'active' : ''} type="button" role="tab" onClick={() => setDetailTab('versions')}>版本记录 <em>{selectedReport.versions.length}</em></button>
              <button className={detailTab === 'relations' ? 'active' : ''} type="button" role="tab" onClick={() => setDetailTab('relations')}>关联对象 <em>{selectedReport.products.length + selectedReport.issues.length}</em></button>
              <button className={detailTab === 'activity' ? 'active' : ''} type="button" role="tab" onClick={() => setDetailTab('activity')}>操作记录 <em>{selectedReport.activities.length}</em></button>
            </div>
            <div className="eight-d-detail-drawer hm-scroll-region">
              {detailTab === 'versions' && <div className="version-list">
                {selectedReport.versions.map(version => <article className={`${selectedVersionId === version.id ? 'selected' : ''} ${version.deletedAt ? 'deleted' : ''}`} key={version.id} onClick={() => setSelectedVersionId(version.id)}>
                  <span className="version-mark">{version.versionLabel}</span>
                  <div><strong>{version.displayName || version.originalName}</strong><small>{formatBytes(version.size)} · {version.uploadedBy || '未知上传人'} · {formatDate(version.createdAt, true)}</small>{version.note && <p>{version.note}</p>}</div>
                  <nav>
                    {version.id === selectedReport.currentVersionId && !version.deletedAt && <span><Check size={12} />当前</span>}
                    {!version.deletedAt && version.id !== selectedReport.currentVersionId && canUpdate && <button type="button" disabled={saving} onClick={event => { event.stopPropagation(); void setCurrentVersion(version); }}>设为当前</button>}
                    {!version.deletedAt && canDelete && <button className="danger" type="button" disabled={saving} title="删除版本" onClick={event => { event.stopPropagation(); void deleteVersion(version); }}><Trash2 size={13} /></button>}
                    {version.deletedAt && canUpdate && <button type="button" disabled={saving} onClick={event => { event.stopPropagation(); void restoreVersion(version); }}><RotateCcw size={13} />恢复</button>}
                  </nav>
                </article>)}
              </div>}
              {detailTab === 'relations' && <div className="relation-detail-grid">
                <section><header><Boxes size={14} /><strong>关联产品</strong><em>{selectedReport.products.length}</em></header>{selectedReport.products.map(product => <button type="button" key={product.id} onClick={() => selectProduct(product.id)}><strong>{productTitle(product)}</strong><span>{product.customerName || '未设置客户'}{product.productName ? ` · ${product.productName}` : ''}</span><ChevronRight size={14} /></button>)}{!selectedReport.products.length && <p>尚未关联产品</p>}</section>
                <section><header><ShieldAlert size={14} /><strong>关联问题</strong><em>{selectedReport.issues.length}</em></header>{selectedReport.issues.map(issue => <button type="button" key={issue.id} onClick={() => selectIssue(issue.id)}><strong>{issue.code} · {issue.title}</strong><span>{issueStatusLabels[issue.status] || issue.status}{issue.workOrder ? ` · ${issue.workOrder.specification || issue.workOrder.code}` : ''}</span><ChevronRight size={14} /></button>)}{!selectedReport.issues.length && <p>尚未关联质量问题</p>}</section>
              </div>}
              {detailTab === 'activity' && <div className="activity-list">
                {selectedReport.activities.map(activity => <article key={activity.id}><span /><div><header><strong>{activityLabels[activity.action] || activity.action}</strong><time>{formatDate(activity.createdAt, true)}</time></header><p>{activity.content || '无补充说明'}</p><small>{activity.actorName}</small></div></article>)}
                {!selectedReport.activities.length && <p className="detail-empty-copy">暂无操作记录</p>}
              </div>}
            </div>
          </>}
        </section>
      </section>
    </div>

    {formOpen && <div className="eight-d-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeForm(); }}><form className="eight-d-modal report-form-modal" role="dialog" aria-modal="true" aria-labelledby="eight-d-form-title" onSubmit={event => { void saveReport(event); }}>
      <header><div><span>{editingReport ? '编辑8D档案' : '建立8D PDF档案'}</span><h2 id="eight-d-form-title">{editingReport ? `${editingReport.reportNo} · 档案与关联` : '上传已制作完成的8D报告'}</h2><p>系统保存 PDF、版本和关联关系，不在此编辑 D1–D8 正文。</p></div><button type="button" aria-label="关闭" disabled={saving} onClick={closeForm}><X size={18} /></button></header>
      <div className="eight-d-form-body hm-scroll-region">
        <section className="form-card metadata"><header><strong>01 · 档案信息</strong><span>用于检索、责任归属与归档</span></header><div className="form-grid">
          <label>报告编号<input autoFocus value={form.reportNo} maxLength={80} onChange={event => setForm(current => ({ ...current, reportNo: event.target.value }))} placeholder="如 8D-2026-001" /></label>
          <label>报告日期<input type="date" value={form.reportDate} onChange={event => setForm(current => ({ ...current, reportDate: event.target.value }))} /></label>
          <label className="wide">报告标题<input value={form.title} maxLength={180} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="一句话说明问题与报告范围" /></label>
          <label>责任部门<input value={form.responsibleDepartment} maxLength={120} onChange={event => setForm(current => ({ ...current, responsibleDepartment: event.target.value }))} placeholder="如 质量部 / 制造部" /></label>
          <label>档案状态<select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as EightDReportStatus }))}><option value="active">在用</option><option value="archived">已归档</option></select></label>
          <label className="wide">关键词<input value={form.keywords} maxLength={500} onChange={event => setForm(current => ({ ...current, keywords: event.target.value }))} placeholder="客户、失效模式、批次等，使用空格分隔" /></label>
        </div></section>

        {!editingReport && <section className="form-card upload-card"><header><strong>02 · 首版 PDF</strong><span>上传后成为 V1 和当前版本</span></header><label className={`pdf-drop ${formFile ? 'has-file' : ''}`}><input type="file" accept="application/pdf,.pdf" onChange={event => setFormFile(event.target.files?.[0] || null)} /><FileUp size={28} /><strong>{formFile ? formFile.name : '选择已经制作完成的8D PDF'}</strong><span>{formFile ? formatBytes(formFile.size) : '仅支持 PDF，文件进入 S3 兼容对象存储'}</span></label><div className="form-grid compact"><label>显示名称<input value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} placeholder="选填，默认使用原文件名" /></label><label>版本说明<input value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="如 客户确认版" /></label></div></section>}

        <section className="form-card associations"><header><strong>{editingReport ? '02' : '03'} · 多对多关联</strong><span>一份报告可关联多个产品和多个质量问题</span></header><div className="association-grid">
          <div className="association-picker"><header><span><Boxes size={14} />产品</span><em>已选 {form.productIds.length}</em></header><label><Search size={13} /><input value={relationQuery.products} onChange={event => setRelationQuery(current => ({ ...current, products: event.target.value }))} placeholder="搜索产品" /></label><div className="hm-scroll-region">{formProducts.map(product => { const checked = form.productIds.includes(product.id); return <button className={checked ? 'checked' : ''} type="button" key={product.id} onClick={() => setForm(current => ({ ...current, productIds: checked ? current.productIds.filter(id => id !== product.id) : [...current.productIds, product.id] }))}><span className="check-box">{checked && <Check size={12} />}</span><span><strong>{productTitle(product)}</strong><small>{product.customerName || '未设置客户'}{product.productName ? ` · ${product.productName}` : ''}</small></span></button>; })}{!formProducts.length && <p>没有匹配的产品</p>}</div></div>
          <div className="association-picker"><header><span><ShieldAlert size={14} />质量问题</span><em>已选 {form.issueIds.length}</em></header><label><Search size={13} /><input value={relationQuery.issues} onChange={event => setRelationQuery(current => ({ ...current, issues: event.target.value }))} placeholder="搜索问题" /></label><div className="hm-scroll-region">{formIssues.map(issue => { const checked = form.issueIds.includes(issue.id); return <button className={checked ? 'checked' : ''} type="button" key={issue.id} onClick={() => setForm(current => ({ ...current, issueIds: checked ? current.issueIds.filter(id => id !== issue.id) : [...current.issueIds, issue.id] }))}><span className="check-box">{checked && <Check size={12} />}</span><span><strong>{issue.code} · {issue.title}</strong><small>{issueStatusLabels[issue.status] || issue.status}{issue.workOrder ? ` · ${issue.workOrder.specification || issue.workOrder.code}` : ''}</small></span></button>; })}{!formIssues.length && <p>没有匹配的问题</p>}</div></div>
        </div></section>
        {formError && <div className="eight-d-form-error"><ShieldAlert size={15} />{formError}</div>}
      </div>
      <footer><span>{form.productIds.length} 个产品 · {form.issueIds.length} 个问题{editingReport ? ` · 并发版本 ${editingReport.version}` : formFile ? ` · ${formatBytes(formFile.size)}` : ''}</span><div><button type="button" disabled={saving} onClick={closeForm}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={14} />}{editingReport ? '保存档案与关联' : '创建档案并上传V1'}</button></div></footer>
    </form></div>}

    {versionOpen && selectedReport && <div className="eight-d-modal-backdrop"><form className="eight-d-modal version-modal" role="dialog" aria-modal="true" aria-labelledby="version-form-title" onSubmit={event => { void uploadVersion(event); }}><header><div><span>受控版本</span><h2 id="version-form-title">上传 {selectedReport.reportNo} 的新 PDF</h2><p>系统自动递增版本号，并将新版本设为当前版本；历史版本仍可追溯。</p></div><button type="button" disabled={saving} onClick={() => setVersionOpen(false)}><X size={18} /></button></header><div className="version-form-body"><label className={`pdf-drop ${versionFile ? 'has-file' : ''}`}><input type="file" accept="application/pdf,.pdf" onChange={event => setVersionFile(event.target.files?.[0] || null)} /><FileUp size={28} /><strong>{versionFile ? versionFile.name : '选择新的8D PDF版本'}</strong><span>{versionFile ? formatBytes(versionFile.size) : `将创建 V${Math.max(0, ...selectedReport.versions.map(item => item.versionNumber)) + 1}`}</span></label><label>显示名称<input value={versionDisplayName} maxLength={200} onChange={event => setVersionDisplayName(event.target.value)} placeholder="选填，默认使用原文件名" /></label><label>版本说明<textarea rows={3} value={versionNote} maxLength={500} onChange={event => setVersionNote(event.target.value)} placeholder="说明本次修订内容或确认状态" /></label></div><footer><span>当前 {selectedReport.currentVersion?.versionLabel || '无版本'}</span><div><button type="button" disabled={saving} onClick={() => setVersionOpen(false)}>取消</button><button className="primary" type="submit" disabled={saving || !versionFile}>{saving && <Loader2 className="spin" size={14} />}上传并设为当前版</button></div></footer></form></div>}

    {deleteReport && <div className="eight-d-modal-backdrop"><section className="eight-d-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-report-title"><Archive size={28} /><h2 id="delete-report-title">将8D档案移入回收站？</h2><p>{deleteReport.reportNo} · {deleteReport.title}</p><span>档案、关联和版本元数据会软删除；对象存储中的 PDF 原文件不会被物理删除。</span><label>删除原因<textarea autoFocus rows={3} value={deleteReason} maxLength={300} onChange={event => setDeleteReason(event.target.value)} placeholder="请说明归档错误、重复档案或其他原因" /></label><footer><button type="button" disabled={saving} onClick={() => setDeleteReport(null)}>取消</button><button className="danger" type="button" disabled={saving || !deleteReason.trim()} onClick={() => { void confirmDeleteReport(); }}>{saving && <Loader2 className="spin" size={14} />}移入回收站</button></footer></section></div>}
  </main>;
}
