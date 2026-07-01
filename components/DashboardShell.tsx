'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { CurrentUserDTO, FieldSummaryDTO, OperationLogDTO, ResourceCategoryDTO, ResourceFileDTO, TrashDTO, UserDTO, WorkOrderDTO } from '@/types';

type WorkOrderForm = {
  code: string;
  productName: string;
  stage: string;
  priority: string;
  status: string;
  progress: number;
  remark: string;
};

type WorkOrderModal = { mode: 'create' | 'edit'; order?: WorkOrderDTO } | null;
type UploadJob = { id: string; name: string; status: 'waiting' | 'uploading' | 'success' | 'failed'; message?: string };
type FileForm = { displayName: string; remark: string; workOrderId: string; categoryId: string };
type ImportRow = { row: number; code: string; status: 'created' | 'updated' | 'skipped' | 'failed'; message: string };
type ImportResult = { summary: { created: number; updated: number; skipped: number; failed: number; total: number }; results: ImportRow[] };
type UserForm = { username: string; displayName: string; password: string };
type AccountEdit = { id: string; displayName: string; isActive: boolean } | null;
type PasswordReset = { id: string; username: string; password: string } | null;
type SearchResult = { workOrders: WorkOrderDTO[]; resourceFiles: ResourceFileDTO[] };
type SystemStatus = {
  ok: boolean;
  app: { name: string; version: string; mode: string };
  data: { mode: string; permissions: string };
  database: { ok: boolean; type: string };
  storage: { ok: boolean; type: string; bucketConfigured: boolean; publicEndpointConfigured: boolean };
  upload: { maxUploadSizeMb: number; supportedTypes: string[] };
  serverTime: string;
};
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const k = n / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  return `${(k / 1024).toFixed(2)} MB`;
}

function dt(v: string, withTime = true) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!withTime) return day;
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortName(name: string) {
  return name.length > 22 ? `${name.slice(0, 11)}...${name.slice(-8)}` : name;
}

function sameDay(value: string) {
  const d = new Date(value);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function inRecentWeek(value: string) {
  const d = new Date(value).getTime();
  return Number.isFinite(d) && d >= Date.now() - 6 * 24 * 60 * 60 * 1000;
}

function displayFileName(file?: ResourceFileDTO | null) {
  return file?.displayName || file?.originalName || '-';
}

function fileExtOk(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && ['pdf', 'jpg', 'jpeg', 'png'].includes(ext);
}

const priorityText: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };
const statusText: Record<string, string> = { pending: '待处理', processing: '进行中', done: '已完成', uploaded: '已上传', deleted: '已删除' };
const actionText: Record<string, string> = {
  login: '登录',
  logout: '退出登录',
  upload: '上传文件',
  delete: '软删除文件',
  change_password: '修改密码',
  create_work_order: '新建工单',
  update_work_order: '编辑工单',
  delete_work_order: '删除工单',
  download: '下载文件',
  download_work_order_package: '下载资料包',
  update_resource_file: '编辑文件信息',
  export_work_orders: '导出工单',
  export_resource_files: '导出文件清单',
  export_operation_logs: '导出操作日志',
  export_metadata: '导出元数据',
  import_work_orders: '导入工单',
  create_user: '新增账号',
  update_user: '编辑账号',
  disable_user: '禁用账号',
  reset_user_password: '重置密码',
  restore_work_order: '恢复工单',
  restore_resource_file: '恢复文件',
  move_resource_file: '移动文件',
  copy_work_order_link: '复制工单链接',
  print_work_order_qr: '打印工单二维码',
  export_diagnostics: '导出诊断信息',
};
const categoryIcons: Record<string, string> = { drawing: '原', sop: 'SOP', product: '成', material: '辅', notice: '注' };
const fileTypeText: Record<string, string> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG', jpeg: 'JPG' };
const requiredCategoryCodes = new Set(['drawing', 'sop', 'product']);
const emptyForm: WorkOrderForm = { code: '', productName: '', stage: '未发图', priority: 'normal', status: 'pending', progress: 0, remark: '' };
const logFilters = [
  ['all', '全部'],
  ['upload', '上传'],
  ['delete', '删除'],
  ['download', '下载'],
  ['download_all', '下载全部'],
  ['create_work_order', '新建工单'],
  ['update_work_order', '编辑工单'],
  ['delete_work_order', '删除工单'],
  ['change_password', '修改密码'],
  ['update_resource_file', '编辑文件信息'],
  ['move_resource_file', '移动文件'],
  ['restore', '恢复'],
  ['user', '账号'],
  ['export', '导出'],
  ['import', '导入'],
  ['field', '现场'],
];

function completionOf(categories: ResourceCategoryDTO[], counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return { key: 'empty', text: '空工单' };
  const missingRequired = categories.some(c => requiredCategoryCodes.has(c.code) && !counts[c.id]);
  return missingRequired ? { key: 'missing', text: '缺资料' } : { key: 'complete', text: '完整' };
}

function toForm(order?: WorkOrderDTO): WorkOrderForm {
  if (!order) return emptyForm;
  return {
    code: order.code,
    productName: order.productName,
    stage: order.stage,
    priority: order.priority,
    status: order.status,
    progress: order.progress,
    remark: order.remark || '',
  };
}

export default function DashboardShell({
  user,
  initialWorkOrders,
  categories,
}: {
  user: CurrentUserDTO;
  initialWorkOrders: WorkOrderDTO[];
  categories: ResourceCategoryDTO[];
}) {
  const [orders, setOrders] = useState(initialWorkOrders);
  const [kw, setKw] = useState('');
  const [orderFilter, setOrderFilter] = useState('all');
  const [wo, setWo] = useState(initialWorkOrders[0]?.id || '');
  const [cat, setCat] = useState(categories[0]?.id || '');
  const [files, setFiles] = useState<ResourceFileDTO[]>([]);
  const [allFiles, setAllFiles] = useState<ResourceFileDTO[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerCategory, setManagerCategory] = useState('all');
  const [sel, setSel] = useState('');
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>(initialWorkOrders[0]?.categoryFileCounts || {});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [msg, setMsg] = useState('');
  const [lib, setLib] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [deleteTarget, setDeleteTarget] = useState<ResourceFileDTO | null>(null);
  const [orderDeleteTarget, setOrderDeleteTarget] = useState<WorkOrderDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [orderModal, setOrderModal] = useState<WorkOrderModal>(null);
  const [orderForm, setOrderForm] = useState<WorkOrderForm>(emptyForm);
  const [orderFormError, setOrderFormError] = useState('');
  const [orderSaving, setOrderSaving] = useState(false);
  const [fileEditTarget, setFileEditTarget] = useState<ResourceFileDTO | null>(null);
  const [fileForm, setFileForm] = useState<FileForm>({ displayName: '', remark: '', workOrderId: '', categoryId: '' });
  const [fileOrderKw, setFileOrderKw] = useState('');
  const [fileFormError, setFileFormError] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<OperationLogDTO[]>([]);
  const [logFilter, setLogFilter] = useState('all');
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [globalKw, setGlobalKw] = useState('');
  const [globalSearch, setGlobalSearch] = useState<SearchResult>({ workOrders: [], resourceFiles: [] });
  const [searchOpen, setSearchOpen] = useState(false);
  const [fieldSummary, setFieldSummary] = useState<FieldSummaryDTO | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [userForm, setUserForm] = useState<UserForm>({ username: '', displayName: '', password: '' });
  const [accountEdit, setAccountEdit] = useState<AccountEdit>(null);
  const [passwordReset, setPasswordReset] = useState<PasswordReset>(null);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashDTO>({ workOrders: [], resourceFiles: [] });
  const [trashTab, setTrashTab] = useState<'workOrders' | 'files'>('workOrders');
  const [helpOpen, setHelpOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLink, setQrLink] = useState('');

  const pdf = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const csvImport = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const text = kw.trim().toLowerCase();
    return orders.filter(o => {
      const matchesText = !text || o.code.toLowerCase().includes(text) || o.productName.toLowerCase().includes(text);
      if (!matchesText) return false;
      if (orderFilter === 'today') return sameDay(o.createdAt);
      if (orderFilter === 'week') return inRecentWeek(o.createdAt);
      if (orderFilter === 'done') return o.status === 'done';
      if (orderFilter === 'processing') return o.status === 'processing';
      return true;
    });
  }, [orders, kw, orderFilter]);

  const order = orders.find(o => o.id === wo) || orders[0];
  const category = categories.find(c => c.id === cat) || categories[0];
  const file = files.find(f => f.id === sel) || files[0];
  const latestFileId = files[0]?.id || '';
  const accountName = user.displayName || user.username;
  const currentCounts = order?.id === wo ? categoryCounts : order?.categoryFileCounts || {};
  const completedCategories = categories.filter(c => (currentCounts[c.id] || 0) > 0).length;
  const completion = completionOf(categories, currentCounts);
  const completionText = categories.length ? `${completion.text} · ${completedCategories}/${categories.length}` : '未配置分类';
  const visibleToday = list.filter(o => sameDay(o.createdAt));
  const visibleWeek = list.filter(o => inRecentWeek(o.createdAt));
  const managerFiles = managerCategory === 'all' ? allFiles : allFiles.filter(f => f.categoryId === managerCategory);
  const fileOrderOptions = useMemo(() => {
    const text = fileOrderKw.trim().toLowerCase();
    return orders.filter(o => !text || o.code.toLowerCase().includes(text) || o.productName.toLowerCase().includes(text)).slice(0, 30);
  }, [orders, fileOrderKw]);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeinstallprompt', onInstall);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workOrderId = params.get('workOrderId');
    const workOrderCode = params.get('workOrderCode') || params.get('workOrder');
    const storedWorkOrderId = window.localStorage.getItem('hongmeng:lastWorkOrderId');
    const storedCategoryId = window.localStorage.getItem('hongmeng:lastCategoryId');
    const target = workOrderId
      ? orders.find(o => o.id === workOrderId)
      : workOrderCode
        ? orders.find(o => o.code === workOrderCode)
        : storedWorkOrderId
          ? orders.find(o => o.id === storedWorkOrderId)
          : null;
    if (target) setWo(target.id);
    else if (workOrderId || workOrderCode) setMsg('未找到直达链接对应的工单');
    if (storedCategoryId && categories.some(c => c.id === storedCategoryId)) setCat(storedCategoryId);
    loadFieldSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wo) window.localStorage.setItem('hongmeng:lastWorkOrderId', wo);
    if (cat) window.localStorage.setItem('hongmeng:lastCategoryId', cat);
  }, [wo, cat]);

  useEffect(() => {
    const text = globalKw.trim();
    if (!text) {
      setGlobalSearch({ workOrders: [], resourceFiles: [] });
      setSearchOpen(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?keyword=${encodeURIComponent(text)}`, { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          setGlobalSearch({ workOrders: d.workOrders || [], resourceFiles: d.resourceFiles || [] });
          setSearchOpen(true);
        }
      } catch {
        setMsg('全局搜索失败');
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [globalKw]);

  function mergeOrder(next: WorkOrderDTO) {
    setOrders(v => {
      const exists = v.some(o => o.id === next.id);
      return exists ? v.map(o => (o.id === next.id ? next : o)) : [next, ...v];
    });
  }

  function mergeFile(next: ResourceFileDTO) {
    setFiles(v => v.map(f => (f.id === next.id ? next : f)));
    setAllFiles(v => v.map(f => (f.id === next.id ? next : f)));
  }

  async function refreshOrders(preferredId?: string) {
    const r = await fetch('/api/work-orders', { cache: 'no-store' });
    if (!r.ok) throw new Error('refresh work orders failed');
    const d = await r.json();
    const nextOrders: WorkOrderDTO[] = Array.isArray(d.workOrders) ? d.workOrders : [];
    setOrders(nextOrders);
    const nextId = preferredId && nextOrders.some(o => o.id === preferredId) ? preferredId : nextOrders[0]?.id || '';
    setWo(v => (v && nextOrders.some(o => o.id === v) ? v : nextId));
    return nextOrders;
  }

  async function loadFiles(w = order?.id, c = category?.id, preferredFileId?: string) {
    if (!w || !c) {
      setFiles([]);
      setSel('');
      return [];
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/resource-files?workOrderId=${w}&categoryId=${c}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load files failed');
      const d = await r.json();
      const nextFiles: ResourceFileDTO[] = Array.isArray(d.files) ? d.files : [];
      setFiles(nextFiles);
      setSel(preferredFileId && nextFiles.some(f => f.id === preferredFileId) ? preferredFileId : nextFiles[0]?.id || '');
      setCategoryCounts(v => ({ ...v, [c]: nextFiles.length }));
      return nextFiles;
    } catch {
      setMsg('文件加载失败，请检查网络后重试');
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function loadAllFiles(w = order?.id) {
    if (!w) {
      setAllFiles([]);
      return [];
    }
    try {
      const r = await fetch(`/api/resource-files?workOrderId=${w}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load all files failed');
      const d = await r.json();
      const nextFiles: ResourceFileDTO[] = Array.isArray(d.files) ? d.files : [];
      setAllFiles(nextFiles);
      return nextFiles;
    } catch {
      setMsg('上传管理加载失败');
      return [];
    }
  }

  async function loadCategoryCounts(w = order?.id) {
    if (!w) {
      setCategoryCounts({});
      return {};
    }
    try {
      const all = await loadAllFiles(w);
      const counts: Record<string, number> = {};
      for (const item of all) counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
      setCategoryCounts(counts);
      setOrders(v => v.map(o => (o.id === w ? { ...o, categoryFileCounts: counts, totalFileCount: all.length } : o)));
      return counts;
    } catch {
      setCategoryCounts({});
      return {};
    }
  }

  async function loadFieldSummary() {
    try {
      const r = await fetch('/api/dashboard/field-summary', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setFieldSummary(d);
    } catch {
      setMsg('现场概览加载失败');
    }
  }

  async function openWorkOrder(targetId: string, targetCategoryId?: string, targetFileId?: string) {
    setManagerOpen(false);
    setWo(targetId);
    if (targetCategoryId) setCat(targetCategoryId);
    window.history.replaceState(null, '', `/dashboard?workOrderId=${encodeURIComponent(targetId)}`);
    await loadFiles(targetId, targetCategoryId || cat, targetFileId);
    await loadAllFiles(targetId);
    setSearchOpen(false);
  }

  async function openFileResult(target: ResourceFileDTO) {
    await openWorkOrder(target.workOrderId, target.categoryId, target.id);
  }

  async function loadUsers() {
    try {
      const r = await fetch('/api/users', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAccountError(d.error || d.message || '账号加载失败');
        return;
      }
      setUsers(Array.isArray(d.users) ? d.users : []);
    } catch {
      setAccountError('账号加载失败');
    }
  }

  async function openAccounts() {
    setUserMenu(false);
    setAccountsOpen(true);
    setAccountError('');
    await loadUsers();
  }

  async function saveNewUser(e: React.FormEvent) {
    e.preventDefault();
    setAccountError('');
    if (!userForm.username.trim()) return setAccountError('账号不能为空');
    if (userForm.password.length < 6) return setAccountError('初始密码至少 6 位');
    setAccountSaving(true);
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAccountError(d.error || d.message || '新增账号失败');
        return;
      }
      setUserForm({ username: '', displayName: '', password: '' });
      await loadUsers();
      setMsg('账号已新增');
    } catch {
      setAccountError('新增账号失败');
    } finally {
      setAccountSaving(false);
    }
  }

  async function saveAccountEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountEdit) return;
    setAccountSaving(true);
    setAccountError('');
    try {
      const r = await fetch(`/api/users/${accountEdit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: accountEdit.displayName, isActive: accountEdit.isActive }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAccountError(d.error || d.message || '保存账号失败');
        return;
      }
      setAccountEdit(null);
      await loadUsers();
      setMsg(accountEdit.isActive ? '账号已更新' : '账号已禁用');
    } catch {
      setAccountError('保存账号失败');
    } finally {
      setAccountSaving(false);
    }
  }

  async function resetUserPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordReset) return;
    if (passwordReset.password.length < 6) return setAccountError('新密码至少 6 位');
    setAccountSaving(true);
    setAccountError('');
    try {
      const r = await fetch(`/api/users/${passwordReset.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordReset.password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAccountError(d.error || d.message || '重置密码失败');
        return;
      }
      setPasswordReset(null);
      setMsg('密码已重置');
    } catch {
      setAccountError('重置密码失败');
    } finally {
      setAccountSaving(false);
    }
  }

  async function loadTrash() {
    try {
      const r = await fetch('/api/trash', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || d.message || '回收站加载失败');
        return;
      }
      setTrash({ workOrders: d.workOrders || [], resourceFiles: d.resourceFiles || [] });
    } catch {
      setMsg('回收站加载失败');
    }
  }

  async function openTrash() {
    setUserMenu(false);
    setTrashOpen(true);
    await loadTrash();
  }

  async function restoreWorkOrder(id: string) {
    const r = await fetch(`/api/work-orders/${id}/restore`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || d.message || '恢复工单失败');
      return;
    }
    await refreshOrders(d.workOrder?.id);
    await loadTrash();
    setMsg('工单已恢复');
  }

  async function restoreFile(id: string) {
    const r = await fetch(`/api/resource-files/${id}/restore`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || d.message || '恢复文件失败');
      return;
    }
    await loadTrash();
    if (d.file?.workOrderId === order?.id) {
      await loadFiles(order.id, d.file.categoryId, d.file.id);
      await loadCategoryCounts(order.id);
    }
    setMsg('文件已恢复');
  }

  useEffect(() => {
    setCategoryCounts(order?.categoryFileCounts || {});
    loadFiles(order?.id, category?.id);
    loadAllFiles(order?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, cat]);

  useEffect(() => {
    loadCategoryCounts(order?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo]);

  async function uploadMany(fileList: File[]) {
    if (!order) {
      setMsg('未选择工单');
      return;
    }
    if (!category) {
      setMsg('未选择分类');
      return;
    }
    if (!fileList.length) return;
    if (uploading) return;

    const jobs = fileList.map((f, index) => ({
      id: `${Date.now()}-${index}`,
      name: f.name,
      status: fileExtOk(f) ? 'waiting' as const : 'failed' as const,
      message: fileExtOk(f) ? '等待上传' : '文件格式不支持',
    }));
    setUploadJobs(jobs);
    setUploading(true);
    let ok = 0;
    let failed = jobs.filter(j => j.status === 'failed').length;
    let lastSuccessId = '';

    for (let i = 0; i < fileList.length; i += 1) {
      const f = fileList[i];
      const job = jobs[i];
      if (job.status === 'failed') continue;
      setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'uploading', message: '上传中' } : j)));
      const fd = new FormData();
      fd.append('file', f);
      fd.append('workOrderId', order.id);
      fd.append('categoryId', category.id);
      try {
        const r = await fetch('/api/resource-files/upload', { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          failed += 1;
          setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'failed', message: d.message || '上传失败' } : j)));
          continue;
        }
        ok += 1;
        lastSuccessId = d.file?.id || lastSuccessId;
        setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'success', message: d.file?.version ? `上传成功 · ${d.file.version}` : '上传成功' } : j)));
      } catch {
        failed += 1;
        setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'failed', message: '网络异常或对象存储异常' } : j)));
      }
    }

    await loadFiles(order.id, category.id, lastSuccessId || undefined);
    await loadCategoryCounts(order.id);
    setMsg(`批量上传完成：成功 ${ok} 个，失败 ${failed} 个`);
    setUploading(false);
    if (pdf.current) pdf.current.value = '';
    if (img.current) img.current.value = '';
    if (camera.current) camera.current.value = '';
  }

  async function refresh() {
    try {
      await refreshOrders(order?.id);
      await loadFiles();
      await loadCategoryCounts();
      setMsg('已刷新');
    } catch {
      setMsg('刷新失败，请稍后重试');
    }
  }

  function openOrderModal(mode: 'create' | 'edit', target?: WorkOrderDTO) {
    setOrderModal({ mode, order: target });
    setOrderForm(toForm(target));
    setOrderFormError('');
  }

  async function saveWorkOrder(e: React.FormEvent) {
    e.preventDefault();
    setOrderFormError('');
    if (!orderForm.code.trim()) return setOrderFormError('工单号不能为空');
    if (!orderForm.productName.trim()) return setOrderFormError('产品名称不能为空');
    if (orderForm.progress < 0 || orderForm.progress > 100) return setOrderFormError('进度必须在 0-100 之间');

    setOrderSaving(true);
    try {
      const isEdit = orderModal?.mode === 'edit' && orderModal.order;
      const r = await fetch(isEdit ? `/api/work-orders/${orderModal.order!.id}` : '/api/work-orders', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setOrderFormError(d.message || '保存工单失败');
        return;
      }
      mergeOrder(d.workOrder);
      setWo(d.workOrder.id);
      setOrderModal(null);
      setMsg(isEdit ? '工单已更新' : '工单已新建');
    } catch {
      setOrderFormError('网络异常，请稍后重试');
    } finally {
      setOrderSaving(false);
    }
  }

  function openFileEdit(target: ResourceFileDTO) {
    setFileEditTarget(target);
    setFileForm({ displayName: target.displayName || '', remark: target.remark || '', workOrderId: target.workOrderId, categoryId: target.categoryId });
    setFileOrderKw('');
    setFileFormError('');
  }

  async function saveFileInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!fileEditTarget) return;
    setFileSaving(true);
    setFileFormError('');
    try {
      const r = await fetch(`/api/resource-files/${fileEditTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFileFormError(d.error || d.message || '文件信息保存失败');
        return;
      }
      const movedAway = d.file?.workOrderId !== order?.id || d.file?.categoryId !== category?.id;
      if (movedAway) {
        await loadFiles(order?.id, category?.id);
        await loadCategoryCounts(order?.id);
      } else {
        mergeFile(d.file);
      }
      setFileEditTarget(null);
      setMsg(movedAway ? '文件已移动到目标工单或分类' : '文件信息已保存');
    } catch {
      setFileFormError('网络异常，请稍后重试');
    } finally {
      setFileSaving(false);
    }
  }

  async function confirmDeleteFile() {
    if (!deleteTarget) return;
    const deletedCategoryId = deleteTarget.categoryId;
    setDeleting(true);
    try {
      const r = await fetch(`/api/resource-files/${deleteTarget.id}/delete`, { method: 'POST' });
      if (!r.ok) {
        setMsg('删除失败，请稍后重试');
        return;
      }
      setMsg('删除成功');
      setDeleteTarget(null);
      await loadFiles(order?.id, deletedCategoryId);
      await loadCategoryCounts();
    } catch {
      setMsg('网络错误，删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteOrder() {
    if (!orderDeleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/work-orders/${orderDeleteTarget.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.message || '删除工单失败');
        return;
      }
      setOrders(v => v.filter(o => o.id !== orderDeleteTarget.id));
      setOrderDeleteTarget(null);
      setMsg('工单已删除');
      await refreshOrders();
    } catch {
      setMsg('网络错误，删除工单失败');
    } finally {
      setDeleting(false);
    }
  }

  async function downloadAll() {
    if (!order) return;
    if (!order.totalFileCount && Object.values(currentCounts).reduce((sum, count) => sum + count, 0) === 0) {
      setMsg('当前工单暂无可下载文件');
      return;
    }
    setDownloadingAll(true);
    setMsg('正在打包资料，请稍候');
    try {
      const r = await fetch(`/api/work-orders/${order.id}/download-all`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.message || '下载全部失败');
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.code}-资料包.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg('资料包下载已开始');
    } catch {
      setMsg('下载全部失败，请稍后重试');
    } finally {
      setDownloadingAll(false);
    }
  }

  async function selectManagedFile(target: ResourceFileDTO) {
    setManagerOpen(false);
    setCat(target.categoryId);
    await loadFiles(target.workOrderId, target.categoryId, target.id);
  }

  async function openUploadManager() {
    setManagerOpen(true);
    await loadAllFiles(order?.id);
  }

  async function loadLogs(nextFilter = logFilter) {
    setLogsOpen(true);
    setLogsLoading(true);
    setLogFilter(nextFilter);
    try {
      const r = await fetch(`/api/operation-logs?limit=100&action=${encodeURIComponent(nextFilter)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.message || '操作日志加载失败');
        return;
      }
      setLogs(Array.isArray(d.logs) ? d.logs : []);
    } catch {
      setMsg('操作日志加载失败');
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadSystemStatus() {
    setSystemLoading(true);
    try {
      const r = await fetch('/api/system/status', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || d.message || '系统状态加载失败');
        return;
      }
      setSystemStatus(d);
    } catch {
      setMsg('系统状态加载失败');
    } finally {
      setSystemLoading(false);
    }
  }

  async function openSystemSettings() {
    setUserMenu(false);
    setSystemOpen(true);
    await loadSystemStatus();
  }

  function downloadName(headers: Headers, fallback: string) {
    const value = headers.get('Content-Disposition') || '';
    const m = value.match(/filename\*=UTF-8''([^;]+)/);
    return m ? decodeURIComponent(m[1]) : fallback;
  }

  async function downloadExport(path: string, label: string, fallback: string) {
    setExporting(label);
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || d.message || `${label}失败`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(r.headers, fallback);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`${label}已开始下载`);
    } catch {
      setMsg(`${label}失败，请稍后重试`);
    } finally {
      setExporting('');
    }
  }

  async function importWorkOrders(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/import/work-orders', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || d.message || '导入失败');
        return;
      }
      setImportResult(d);
      await refreshOrders(order?.id);
      setMsg(`导入完成：新增 ${d.summary?.created || 0}，更新 ${d.summary?.updated || 0}，失败 ${d.summary?.failed || 0}`);
    } catch {
      setMsg('导入失败，请检查 CSV 格式');
    } finally {
      setImporting(false);
      if (csvImport.current) csvImport.current.value = '';
    }
  }

  async function installApp() {
    if (!installPrompt) {
      setMsg('请在浏览器菜单中选择“添加到桌面 / 安装应用”');
      return;
    }
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  function printSummary() {
    if (!order) return;
    setMsg('正在打开打印摘要');
    window.setTimeout(() => window.print(), 120);
  }

  function workOrderLink(target = order) {
    if (!target) return '';
    return `${location.origin}/dashboard?workOrderId=${encodeURIComponent(target.id)}`;
  }

  async function writeClientLog(action: string, targetType?: string, targetId?: string, detail?: unknown) {
    await fetch('/api/operation-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, targetType, targetId, detail }),
    }).catch(() => undefined);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  async function copy() {
    if (!order) return;
    const u = workOrderLink(order);
    try {
      await navigator.clipboard.writeText(u);
      setMsg('当前工单链接已复制');
    } catch {
      setMsg(u);
    }
    await writeClientLog('copy_work_order_link', 'work_order', order.id, { code: order.code });
  }

  async function openQrDialog() {
    if (!order) return;
    const link = workOrderLink(order);
    setQrLink(link);
    setQrDataUrl(await QRCode.toDataURL(link, { margin: 1, width: 220 }));
    setQrOpen(true);
  }

  async function printQr() {
    if (!order) return;
    await writeClientLog('print_work_order_qr', 'work_order', order.id, { code: order.code });
    window.setTimeout(() => window.print(), 120);
  }

  function openPasswordDialog() {
    setUserMenu(false);
    setPasswordError('');
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordOpen(true);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    if (!passwordForm.currentPassword) return setPasswordError('当前密码不能为空');
    if (passwordForm.newPassword.length < 6) return setPasswordError('新密码格式不正确，至少 6 位');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return setPasswordError('两次密码不一致');

    setPasswordSaving(true);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPasswordError(d.message || '修改密码失败');
        return;
      }
      alert(d.message || '密码修改成功，请重新登录');
      location.href = '/login';
    } catch {
      setPasswordError('网络异常，请稍后重试');
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <main className="tablet-shell">
      <header className="topbar">
        <button className="home-button" type="button" aria-label="首页">⌂</button>
        <div className="brand-block">
          <strong>工单资料库</strong>
          <span>鸿蒙平板生产资料管理系统</span>
        </div>
        <div className="top-search">
          <input value={globalKw} onFocus={() => globalKw.trim() && setSearchOpen(true)} onChange={e => setGlobalKw(e.target.value)} placeholder="全局搜索工单 / 文件" />
          <b>⌕</b>
          {searchOpen && globalKw.trim() && (
            <div className="global-search-panel">
              <div className="search-group-title">工单</div>
              {globalSearch.workOrders.map(item => (
                <button key={item.id} type="button" onClick={() => openWorkOrder(item.id)}>
                  <strong>{item.code}</strong>
                  <span>{item.productName}</span>
                </button>
              ))}
              {!globalSearch.workOrders.length && <div className="search-empty">未找到工单</div>}
              <div className="search-group-title">文件</div>
              {globalSearch.resourceFiles.map(item => (
                <button key={item.id} type="button" onClick={() => openFileResult(item)}>
                  <strong>{displayFileName(item)}</strong>
                  <span>{item.workOrderCode || '-'} · {item.categoryName || '-'} · {item.version || 'V1.0'}</span>
                </button>
              ))}
              {!globalSearch.resourceFiles.length && <div className="search-empty">未找到文件</div>}
            </div>
          )}
        </div>
        <div className="top-actions">
          <button className="notice-button" type="button" aria-label="通知">◇<span /></button>
          <button className="language-button" type="button">CN</button>
          <button className="log-button" type="button" onClick={() => loadLogs('all')}>操作日志</button>
          <div className="library-wrap">
            <button className="library-button" type="button" onClick={() => setLib(!lib)}>▱ 资料库</button>
            {lib && (
              <div className="library-menu">
                <button type="button">⚒ 治具资料</button>
                <button className="active" type="button">▤ 生产资料 ✓</button>
              </div>
            )}
          </div>
          <div className="user-wrap">
            <button className="user-button" type="button" onClick={() => setUserMenu(!userMenu)}>
              <span>♙</span>
              <b title={accountName}>{accountName}</b>
              <em>⌄</em>
            </button>
            {userMenu && (
              <div className="user-menu">
                <button type="button" onClick={openSystemSettings}>系统设置</button>
                <button type="button" onClick={openAccounts}>账号管理</button>
                <button type="button" onClick={openTrash}>回收站</button>
                <button type="button" onClick={() => { setUserMenu(false); setHelpOpen(true); }}>使用帮助</button>
                <button type="button" onClick={openPasswordDialog}>修改密码</button>
                <button type="button" onClick={logout}>退出登录</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="orders-panel">
          <div className="panel-head">
            <div>
              <span>生产工单</span>
              <strong>{list.length} 单</strong>
            </div>
            <div className="panel-head-actions">
              <button className="import-order-button" type="button" onClick={openSystemSettings}>批量导入</button>
              <button className="new-order-button" type="button" onClick={() => openOrderModal('create')}>新建工单</button>
            </div>
          </div>
          <div className="panel-search">
            <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索工单号 / 产品名称" />
          </div>
          <div className="filter-tabs">
            {[
              ['all', '全部'],
              ['today', '今日'],
              ['week', '本周'],
              ['done', '已完成'],
              ['processing', '进行中'],
            ].map(([key, label]) => (
              <button key={key} className={orderFilter === key ? 'active' : ''} type="button" onClick={() => setOrderFilter(key)}>{label}</button>
            ))}
          </div>
          <div className="order-stats">
            <div><span>今日订单</span><strong>{visibleToday.length}</strong></div>
            <div><span>本周订单</span><strong>{visibleWeek.length}</strong></div>
          </div>
          {fieldSummary && (
            <section className="field-summary">
              <div className="field-summary-metrics">
                <button type="button" onClick={() => setOrderFilter('all')}><span>缺资料</span><b>{fieldSummary.counts.missingWorkOrders}</b></button>
                <button type="button" onClick={() => setOrderFilter('all')}><span>完整</span><b>{fieldSummary.counts.completeWorkOrders}</b></button>
                <button type="button"><span>最近文件</span><b>{fieldSummary.counts.recentFiles}</b></button>
                <button type="button" onClick={() => setOrderFilter('today')}><span>今日新增</span><b>{fieldSummary.counts.todayWorkOrders}</b></button>
              </div>
              <details>
                <summary>缺资料 Top 5 / 最近更新</summary>
                <div className="field-summary-list">
                  {fieldSummary.missingWorkOrders.map(item => (
                    <button key={item.id} type="button" onClick={() => openWorkOrder(item.id)}>
                      <strong>{item.code}</strong><span>{item.productName}</span>
                    </button>
                  ))}
                  {fieldSummary.recentFiles.map(item => (
                    <button key={item.id} type="button" onClick={() => openFileResult(item)}>
                      <strong>{displayFileName(item)}</strong><span>{item.workOrderCode || '-'} · {item.categoryName || '-'}</span>
                    </button>
                  ))}
                </div>
              </details>
            </section>
          )}
          <OrderGroup title="工单列表" orders={list} selected={order?.id} choose={setWo} categories={categories} />
          {!list.length && <div className="empty-orders large">未找到匹配工单</div>}
        </aside>

        <nav className="resource-menu">
          <div className="resource-head">
            <strong>资料分类</strong>
            <span>{completionText}</span>
          </div>
          {categories.map(c => {
            const count = currentCounts[c.id] || 0;
            const required = requiredCategoryCodes.has(c.code);
            return (
              <button key={c.id} className={!managerOpen && c.id === category?.id ? 'active' : ''} type="button" onClick={() => { setManagerOpen(false); setCat(c.id); }}>
                <span className="category-mark">{categoryIcons[c.code] || c.name.slice(0, 1)}</span>
                <b>{c.name}</b>
                <i className={count ? 'state-dot ok' : required ? 'state-dot warn' : 'state-dot'} />
                <em>{count}</em>
              </button>
            );
          })}
          <button className={managerOpen ? 'upload-manage active' : 'upload-manage'} type="button" disabled={!order} onClick={openUploadManager}>
            <span className="category-mark">↑</span>
            <b>上传管理</b>
          </button>
        </nav>

        <section className="main-card">
          <div className="status-title-row enhanced">
            <div className="status-title">
              <span className="doc-icon">▤</span>
              <div>
                <strong>{managerOpen ? '上传管理' : order?.code || '暂无工单'}</strong>
                <small>{managerOpen ? `${order?.code || '-'} · 全部资料` : order?.productName || '请选择工单'}</small>
              </div>
            </div>
            <div className={`completion-pill ${completion.key}`}>{completion.text}</div>
            <div className="title-actions">
              <button type="button" disabled={!order} onClick={() => order && openOrderModal('edit', order)}>编辑工单</button>
              <button type="button" disabled={!order} onClick={() => order && setOrderDeleteTarget(order)}>删除工单</button>
              <button type="button" disabled={!order} onClick={copy}>复制链接</button>
              <button type="button" disabled={!order} onClick={openQrDialog}>打印二维码</button>
              <button className="download-all-button" type="button" disabled={!order || downloadingAll} onClick={downloadAll}>{downloadingAll ? '打包中...' : '下载全部'}</button>
              <button type="button" disabled={!order} onClick={printSummary}>打印摘要</button>
              <button className="refresh-button" type="button" onClick={refresh}>↻ 刷新</button>
            </div>
          </div>

          {order?.remark && <div className="order-remark">备注：{order.remark}</div>}

          {managerOpen ? (
            <UploadManager
              files={managerFiles}
              categories={categories}
              managerCategory={managerCategory}
              setManagerCategory={setManagerCategory}
              selectFile={selectManagedFile}
              openFileEdit={openFileEdit}
              setDeleteTarget={setDeleteTarget}
            />
          ) : (
            <div className="content-grid">
              <section className="preview-card">
                <div className="preview-toolbar">
                  <div>
                    <span className={file?.fileType === 'pdf' ? 'file-type mini pdf' : 'file-type mini img'}>{file ? fileTypeText[file.fileType] || file.fileType.toUpperCase() : '空'}</span>
                    <strong>{file ? displayFileName(file) : '当前分类暂无文件'}</strong>
                  </div>
                  <div className="preview-meta">
                    {file ? <span className="ok-dot">● 已就绪</span> : <span className="missing-dot">● 缺文件</span>}
                    {file && <span>{file.version || 'V1.0'}</span>}
                    {file && <span>{bytes(file.fileSize)}</span>}
                    {file && <span>{dt(file.createdAt)}</span>}
                  </div>
                </div>

                <div className="preview-stage">
                  {loading ? (
                    <div className="preview-loading">
                      <span />
                      <strong>资料加载中</strong>
                      <p>正在读取当前分类文件</p>
                    </div>
                  ) : file ? (
                    file.fileType === 'pdf' ? <iframe src={file.viewUrl} title={displayFileName(file)} /> : <img src={file.viewUrl} alt={displayFileName(file)} />
                  ) : (
                    <div className="empty-preview">
                      <div className="empty-illustration">▤</div>
                      <strong>当前分类暂无文件</strong>
                      <p>上传后所有登录账号都可以共享查看，文件将保存到对象存储。</p>
                      <div className="empty-actions">
                        <button type="button" disabled={uploading || !order} onClick={() => pdf.current?.click()}>上传 PDF</button>
                        <button type="button" disabled={uploading || !order} onClick={() => img.current?.click()}>上传图片</button>
                        <button type="button" disabled={uploading || !order} onClick={() => camera.current?.click()}>拍照上传</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="file-strip" aria-label="当前分类文件列表">
                  {files.length === 0 ? (
                    <div className="strip-empty">当前分类暂无文件</div>
                  ) : files.map(f => (
                    <button key={f.id} className={f.id === file?.id ? 'strip-file thumb active' : 'strip-file thumb'} type="button" onClick={() => setSel(f.id)}>
                      <FileThumb file={f} />
                      <b>{shortName(displayFileName(f))}</b>
                      <small>{f.version || 'V1.0'} · {dt(f.createdAt, false)}</small>
                      <em className={f.id === latestFileId ? 'version-badge latest' : 'version-badge'}>{f.id === latestFileId ? '最新' : '历史'}</em>
                    </button>
                  ))}
                </div>
              </section>

              <aside className="detail-column">
                <section className="file-info-card">
                  <div className="file-list-header">
                    <strong>文件信息</strong>
                    <span>{files.length ? `${files.length} 个文件` : '暂无文件'}</span>
                  </div>
                  <Info label="显示名称" value={file ? displayFileName(file) : '-'} />
                  <Info label="原始文件名" value={file?.originalName || '-'} />
                  <Info label="文件类型" value={file ? fileTypeText[file.fileType] || file.fileType.toUpperCase() : '-'} />
                  <Info label="文件版本" value={file?.version || 'V1.0'} />
                  <Info label="版本状态" value={file ? (file.id === latestFileId ? '最新' : '历史') : '-'} ok={file?.id === latestFileId} />
                  <Info label="文件大小" value={file ? bytes(file.fileSize) : '-'} />
                  <Info label="上传人" value={file?.uploadedBy || accountName} />
                  <Info label="上传时间" value={file ? dt(file.createdAt) : '-'} />
                  <Info label="当前分类" value={category?.name || '-'} />
                  <Info label="文件状态" value={file ? statusText[file.status] || file.status : '缺失'} ok={!!file} />
                  <Info label="备注" value={file?.remark || '-'} />
                </section>

                <section className="action-card">
                  <input ref={pdf} hidden multiple type="file" accept="application/pdf,.pdf" onChange={e => uploadMany(Array.from(e.target.files || []))} />
                  <input ref={img} hidden multiple type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={e => uploadMany(Array.from(e.target.files || []))} />
                  <input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={e => uploadMany(Array.from(e.target.files || []))} />
                  <button className="upload-action primary" type="button" disabled={uploading || !order} onClick={() => pdf.current?.click()}>
                    <span>⇧</span><b>{uploading ? '上传中，请稍候' : '批量上传 PDF'}</b>
                  </button>
                  <button className="upload-action" type="button" disabled={uploading || !order} onClick={() => img.current?.click()}>
                    <span>▣</span><b>上传图片</b>
                  </button>
                  <button className="upload-action" type="button" disabled={uploading || !order} onClick={() => camera.current?.click()}>
                    <span>◎</span><b>拍照上传</b>
                  </button>
                  <div className="secondary-actions file-actions">
                    <a className={!file ? 'disabled' : ''} href={file?.downloadUrl || '#'} target="_blank">下载当前</a>
                    <button type="button" disabled={!file} onClick={() => file && openFileEdit(file)}>编辑文件</button>
                    <button type="button" disabled={!file} onClick={() => file && setDeleteTarget(file)}>删除文件</button>
                    <button type="button" disabled={!order} onClick={downloadAll}>下载全部</button>
                    <button type="button" disabled={!order} onClick={copy}>复制链接</button>
                  </div>
                  <UploadJobs jobs={uploadJobs} />
                </section>
              </aside>
            </div>
          )}
        </section>
      </section>

      {order && (
        <section className="print-summary" aria-hidden="true">
          <h1>工单资料摘要</h1>
          <div className="print-meta">
            <span>工单号：{order.code}</span>
            <span>产品名称：{order.productName}</span>
            <span>阶段：{order.stage}</span>
            <span>优先级：{priorityText[order.priority] || order.priority}</span>
            <span>状态：{statusText[order.status] || order.status}</span>
            <span>资料完整性：{completion.text}</span>
            <span>打印时间：{now ? dt(now.toISOString()) : '-'}</span>
          </div>
          <h2>分类文件数量</h2>
          <ul>
            {categories.map(c => <li key={c.id}>{c.name}：{currentCounts[c.id] || 0} 个文件</li>)}
          </ul>
          <h2>文件清单</h2>
          <table>
            <thead><tr><th>分类</th><th>文件名</th><th>版本</th><th>类型</th><th>大小</th><th>上传时间</th></tr></thead>
            <tbody>
              {allFiles.map(item => (
                <tr key={item.id}>
                  <td>{item.categoryName || '-'}</td>
                  <td>{displayFileName(item)}</td>
                  <td>{item.version || 'V1.0'}</td>
                  <td>{fileTypeText[item.fileType] || item.fileType}</td>
                  <td>{bytes(item.fileSize)}</td>
                  <td>{dt(item.createdAt)}</td>
                </tr>
              ))}
              {!allFiles.length && <tr><td colSpan={6}>暂无文件</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {msg && <div className="status-toast">{msg}</div>}

      <input ref={csvImport} hidden type="file" accept=".csv,text/csv" onChange={e => importWorkOrders(e.target.files)} />

      {systemOpen && (
        <SystemSettings
          userName={accountName}
          now={now}
          status={systemStatus}
          loading={systemLoading}
          exporting={exporting}
          importing={importing}
          importResult={importResult}
          canInstall={!!installPrompt}
          close={() => setSystemOpen(false)}
          refreshStatus={loadSystemStatus}
          refreshData={refresh}
          openLogs={() => loadLogs('all')}
          openAccounts={openAccounts}
          openTrash={openTrash}
          openHelp={() => setHelpOpen(true)}
          logout={logout}
          installApp={installApp}
          chooseImport={() => csvImport.current?.click()}
          downloadTemplate={() => downloadExport('/api/import/work-orders/template.csv', '下载导入模板', '工单导入模板.csv')}
          exportWorkOrders={() => downloadExport('/api/export/work-orders.csv', '导出工单 CSV', '工单列表.csv')}
          exportResourceFiles={() => downloadExport('/api/export/resource-files.csv', '导出文件清单 CSV', '文件清单.csv')}
          exportOperationLogs={() => downloadExport('/api/export/operation-logs.csv', '导出操作日志 CSV', '操作日志.csv')}
          exportMetadata={() => downloadExport('/api/export/metadata.json', '导出元数据 JSON', '系统元数据.json')}
          exportDiagnostics={() => downloadExport('/api/system/diagnostics.json', '导出问题诊断信息', '系统诊断信息.json')}
        />
      )}

      {accountsOpen && (
        <AccountManager
          users={users}
          userForm={userForm}
          accountEdit={accountEdit}
          passwordReset={passwordReset}
          error={accountError}
          saving={accountSaving}
          close={() => setAccountsOpen(false)}
          setUserForm={setUserForm}
          setAccountEdit={setAccountEdit}
          setPasswordReset={setPasswordReset}
          saveNewUser={saveNewUser}
          saveAccountEdit={saveAccountEdit}
          resetUserPassword={resetUserPassword}
        />
      )}

      {trashOpen && (
        <TrashDialog
          trash={trash}
          tab={trashTab}
          close={() => setTrashOpen(false)}
          setTab={setTrashTab}
          restoreWorkOrder={restoreWorkOrder}
          restoreFile={restoreFile}
        />
      )}

      {helpOpen && (
        <HelpDialog
          close={() => setHelpOpen(false)}
          exportDiagnostics={() => downloadExport('/api/system/diagnostics.json', '导出问题诊断信息', '系统诊断信息.json')}
        />
      )}

      {qrOpen && order && (
        <QrDialog
          order={order}
          completionText={completion.text}
          qrDataUrl={qrDataUrl}
          qrLink={qrLink}
          now={now}
          close={() => setQrOpen(false)}
          printQr={printQr}
        />
      )}

      {orderModal && (
        <div className="modal-backdrop" role="presentation">
          <form className="work-order-dialog" onSubmit={saveWorkOrder}>
            <div className="dialog-title">
              <strong>{orderModal.mode === 'create' ? '新建工单' : '编辑工单'}</strong>
              <button type="button" onClick={() => setOrderModal(null)}>×</button>
            </div>
            <div className="form-grid">
              <label>工单号<input value={orderForm.code} disabled={orderModal.mode === 'edit'} onChange={e => setOrderForm(v => ({ ...v, code: e.target.value }))} /></label>
              <label>产品名称<input value={orderForm.productName} onChange={e => setOrderForm(v => ({ ...v, productName: e.target.value }))} /></label>
              <label>阶段<select value={orderForm.stage} onChange={e => setOrderForm(v => ({ ...v, stage: e.target.value }))}><option>前端</option><option>后端</option><option>未发图</option></select></label>
              <label>优先级<select value={orderForm.priority} onChange={e => setOrderForm(v => ({ ...v, priority: e.target.value }))}><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>
              <label>状态<select value={orderForm.status} onChange={e => setOrderForm(v => ({ ...v, status: e.target.value }))}><option value="pending">待处理</option><option value="processing">进行中</option><option value="done">已完成</option></select></label>
              <label>进度<input type="number" min={0} max={100} value={orderForm.progress} onChange={e => setOrderForm(v => ({ ...v, progress: Number(e.target.value) }))} /></label>
              <label className="wide">备注<textarea value={orderForm.remark} onChange={e => setOrderForm(v => ({ ...v, remark: e.target.value }))} /></label>
            </div>
            {orderFormError && <div className="form-error">{orderFormError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setOrderModal(null)}>取消</button>
              <button className="primary-button" type="submit" disabled={orderSaving}>{orderSaving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

      {fileEditTarget && (
        <div className="modal-backdrop" role="presentation">
          <form className="file-edit-dialog" onSubmit={saveFileInfo}>
            <div className="dialog-title">
              <strong>编辑文件信息</strong>
              <button type="button" onClick={() => setFileEditTarget(null)}>×</button>
            </div>
            <div className="file-edit-source">{fileEditTarget.originalName} · {fileEditTarget.version || 'V1.0'}</div>
            <label>显示名称<input value={fileForm.displayName} onChange={e => setFileForm(v => ({ ...v, displayName: e.target.value }))} placeholder="可选，下载时优先使用" /></label>
            <label>备注<textarea value={fileForm.remark} onChange={e => setFileForm(v => ({ ...v, remark: e.target.value }))} placeholder="可选，填写资料说明" /></label>
            <label>搜索目标工单<input value={fileOrderKw} onChange={e => setFileOrderKw(e.target.value)} placeholder="输入工单号 / 产品名称筛选" /></label>
            <label>所属工单<select value={fileForm.workOrderId} onChange={e => setFileForm(v => ({ ...v, workOrderId: e.target.value }))}>
              {fileOrderOptions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.productName}</option>)}
            </select></label>
            <label>所属分类<select value={fileForm.categoryId} onChange={e => setFileForm(v => ({ ...v, categoryId: e.target.value }))}>
              {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            {fileFormError && <div className="form-error">{fileFormError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setFileEditTarget(null)}>取消</button>
              <button className="primary-button" type="submit" disabled={fileSaving}>{fileSaving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

      {logsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="logs-dialog" role="dialog" aria-modal="true" aria-label="操作日志">
            <div className="dialog-title">
              <strong>操作日志</strong>
              <button type="button" onClick={() => setLogsOpen(false)}>×</button>
            </div>
            <div className="log-filter-tabs">
              {logFilters.map(([key, label]) => (
                <button key={key} className={logFilter === key ? 'active' : ''} type="button" onClick={() => loadLogs(key)}>{label}</button>
              ))}
            </div>
            {logsLoading ? (
              <div className="empty-list">日志加载中...</div>
            ) : (
              <div className="logs-table">
                <div className="logs-head"><span>时间</span><span>用户</span><span>操作</span><span>目标</span><span>详情摘要</span></div>
                {logs.map(log => (
                  <div className="logs-row" key={log.id}>
                    <span>{dt(log.createdAt)}</span>
                    <span>{log.user}</span>
                    <span>{actionText[log.action] || log.action}</span>
                    <span>{log.targetType || '-'}<small>{log.targetId || ''}</small></span>
                    <span>{log.detailSummary || '-'}</span>
                  </div>
                ))}
                {!logs.length && <div className="empty-list">暂无操作日志</div>}
              </div>
            )}
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除确认">
            <div className="dialog-title">
              <strong>确认软删除文件</strong>
              <button type="button" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            <p>文件将从当前资料列表移除，历史数据仍保留在数据库记录中。</p>
            <div className="delete-file-name">{displayFileName(deleteTarget)}</div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deleting} onClick={confirmDeleteFile}>{deleting ? '删除中...' : '确认删除'}</button>
            </div>
          </section>
        </div>
      )}

      {orderDeleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除工单确认">
            <div className="dialog-title">
              <strong>确认删除工单</strong>
              <button type="button" onClick={() => setOrderDeleteTarget(null)}>×</button>
            </div>
            <p>仅软删除工单记录，S3 对象存储中的文件不会被删除。</p>
            <div className="delete-file-name">{orderDeleteTarget.code} · {orderDeleteTarget.productName}</div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setOrderDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deleting} onClick={confirmDeleteOrder}>{deleting ? '删除中...' : '确认删除'}</button>
            </div>
          </section>
        </div>
      )}

      {passwordOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="password-dialog" onSubmit={changePassword}>
            <div className="dialog-title">
              <strong>修改密码</strong>
              <button type="button" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <label>当前密码<input type="password" value={passwordForm.currentPassword} onChange={e => setPasswordForm(v => ({ ...v, currentPassword: e.target.value }))} autoFocus /></label>
            <label>新密码<input type="password" value={passwordForm.newPassword} onChange={e => setPasswordForm(v => ({ ...v, newPassword: e.target.value }))} /></label>
            <label>确认新密码<input type="password" value={passwordForm.confirmPassword} onChange={e => setPasswordForm(v => ({ ...v, confirmPassword: e.target.value }))} /></label>
            {passwordError && <div className="form-error">{passwordError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasswordOpen(false)}>取消</button>
              <button className="primary-button" type="submit" disabled={passwordSaving}>{passwordSaving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function OrderGroup({
  title,
  orders,
  selected,
  choose,
  categories,
}: {
  title: string;
  orders: WorkOrderDTO[];
  selected?: string;
  choose: (id: string) => void;
  categories: ResourceCategoryDTO[];
}) {
  return (
    <section className="order-group">
      <h2><span>▣</span>{title}<em>{orders.length}</em></h2>
      {orders.map(o => {
        const completion = completionOf(categories, o.categoryFileCounts || {});
        return (
          <button key={o.id} className={o.id === selected ? 'order-card active' : 'order-card'} type="button" onClick={() => choose(o.id)}>
            <div className="order-topline">
              <strong>{o.code}</strong>
              <span className={`tag ${o.priority === 'urgent' ? 'tag-danger' : o.priority === 'high' ? 'tag-warning' : 'tag-blue'}`}>{priorityText[o.priority] || '一般'}</span>
            </div>
            <p>{o.productName}</p>
            <div className="order-progress">
              <span className={`stage ${o.stage === '前端' ? 'stage-blue' : o.stage === '后端' ? 'stage-green' : 'stage-gray'}`}>{o.stage}</span>
              <b>{o.progress ? `${o.progress}%` : '0%'}</b>
              <i><em style={{ width: `${Math.min(Math.max(o.progress, 0), 100)}%` }} /></i>
            </div>
            <div className="order-status">
              <span>{statusText[o.status] || o.status}</span>
              <strong className={`completion-chip ${completion.key}`}>{completion.text}</strong>
              <em>›</em>
            </div>
          </button>
        );
      })}
      {!orders.length && <div className="empty-orders">暂无工单</div>}
    </section>
  );
}

function FileThumb({ file }: { file: ResourceFileDTO }) {
  if (file.fileType === 'pdf') {
    return <span className="file-thumb pdf">PDF</span>;
  }
  return <span className="file-thumb img"><img src={file.viewUrl} alt="" /></span>;
}

function UploadJobs({ jobs }: { jobs: UploadJob[] }) {
  if (!jobs.length) return null;
  const ok = jobs.filter(j => j.status === 'success').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  return (
    <div className="upload-jobs">
      <div className="upload-jobs-head"><strong>上传队列</strong><span>成功 {ok} · 失败 {failed}</span></div>
      {jobs.map(job => (
        <div className={`upload-job ${job.status}`} key={job.id}>
          <b>{shortName(job.name)}</b>
          <span>{job.status === 'waiting' ? '等待上传' : job.status === 'uploading' ? '上传中' : job.status === 'success' ? '上传成功' : '上传失败'}</span>
          <small>{job.message}</small>
        </div>
      ))}
    </div>
  );
}

function UploadManager({
  files,
  categories,
  managerCategory,
  setManagerCategory,
  selectFile,
  openFileEdit,
  setDeleteTarget,
}: {
  files: ResourceFileDTO[];
  categories: ResourceCategoryDTO[];
  managerCategory: string;
  setManagerCategory: (v: string) => void;
  selectFile: (file: ResourceFileDTO) => void;
  openFileEdit: (file: ResourceFileDTO) => void;
  setDeleteTarget: (file: ResourceFileDTO) => void;
}) {
  return (
    <section className="upload-manager-panel">
      <div className="manager-toolbar">
        <strong>当前工单全部文件</strong>
        <div className="manager-tabs">
          <button className={managerCategory === 'all' ? 'active' : ''} type="button" onClick={() => setManagerCategory('all')}>全部</button>
          {categories.map(c => (
            <button key={c.id} className={managerCategory === c.id ? 'active' : ''} type="button" onClick={() => setManagerCategory(c.id)}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="manager-list">
        {files.map(file => (
          <article className="manager-file-card" key={file.id}>
            <FileThumb file={file} />
            <div>
              <strong>{displayFileName(file)}</strong>
              <span>{file.categoryName || '-'} · {file.version || 'V1.0'} · {bytes(file.fileSize)}</span>
              <small>{dt(file.createdAt)} · {statusText[file.status] || file.status}</small>
            </div>
            <div className="manager-actions">
              <button type="button" onClick={() => selectFile(file)}>预览</button>
              <a href={file.downloadUrl} target="_blank">下载</a>
              <button type="button" onClick={() => openFileEdit(file)}>编辑信息</button>
              <button type="button" onClick={() => setDeleteTarget(file)}>删除</button>
            </div>
          </article>
        ))}
        {!files.length && <div className="empty-list">当前筛选下暂无文件</div>}
      </div>
    </section>
  );
}

function AccountManager({
  users,
  userForm,
  accountEdit,
  passwordReset,
  error,
  saving,
  close,
  setUserForm,
  setAccountEdit,
  setPasswordReset,
  saveNewUser,
  saveAccountEdit,
  resetUserPassword,
}: {
  users: UserDTO[];
  userForm: UserForm;
  accountEdit: AccountEdit;
  passwordReset: PasswordReset;
  error: string;
  saving: boolean;
  close: () => void;
  setUserForm: (value: UserForm | ((v: UserForm) => UserForm)) => void;
  setAccountEdit: (value: AccountEdit) => void;
  setPasswordReset: (value: PasswordReset) => void;
  saveNewUser: (e: React.FormEvent) => void;
  saveAccountEdit: (e: React.FormEvent) => void;
  resetUserPassword: (e: React.FormEvent) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-label="账号管理">
        <div className="dialog-title">
          <strong>账号管理</strong>
          <button type="button" onClick={close}>×</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <form className="inline-form" onSubmit={saveNewUser}>
          <label>账号<input value={userForm.username} onChange={e => setUserForm(v => ({ ...v, username: e.target.value }))} /></label>
          <label>姓名<input value={userForm.displayName} onChange={e => setUserForm(v => ({ ...v, displayName: e.target.value }))} /></label>
          <label>初始密码<input type="password" value={userForm.password} onChange={e => setUserForm(v => ({ ...v, password: e.target.value }))} /></label>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : '新增账号'}</button>
        </form>
        <div className="compact-table users-table">
          <div className="compact-head"><span>账号</span><span>姓名</span><span>状态</span><span>创建时间</span><span>操作</span></div>
          {users.map(item => (
            <div className="compact-row" key={item.id}>
              <span>{item.username}</span>
              <span>{item.displayName}</span>
              <span>{item.isActive ? '启用' : '禁用'}</span>
              <span>{dt(item.createdAt)}</span>
              <span className="row-actions">
                <button type="button" onClick={() => setAccountEdit({ id: item.id, displayName: item.displayName, isActive: item.isActive })}>编辑</button>
                <button type="button" onClick={() => setPasswordReset({ id: item.id, username: item.username, password: '' })}>重置密码</button>
                {item.isActive && <button type="button" onClick={() => setAccountEdit({ id: item.id, displayName: item.displayName, isActive: false })}>禁用</button>}
              </span>
            </div>
          ))}
          {!users.length && <div className="empty-list">暂无账号</div>}
        </div>

        {accountEdit && (
          <form className="nested-dialog" onSubmit={saveAccountEdit}>
            <strong>编辑账号</strong>
            <label>姓名<input value={accountEdit.displayName} onChange={e => setAccountEdit({ ...accountEdit, displayName: e.target.value })} /></label>
            <label className="check-line"><input type="checkbox" checked={accountEdit.isActive} onChange={e => setAccountEdit({ ...accountEdit, isActive: e.target.checked })} /> 启用账号</label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setAccountEdit(null)}>取消</button>
              <button className={accountEdit.isActive ? 'primary-button' : 'danger-button'} type="submit" disabled={saving}>{saving ? '保存中...' : accountEdit.isActive ? '保存' : '确认禁用'}</button>
            </div>
          </form>
        )}

        {passwordReset && (
          <form className="nested-dialog" onSubmit={resetUserPassword}>
            <strong>重置密码：{passwordReset.username}</strong>
            <label>新密码<input type="password" value={passwordReset.password} onChange={e => setPasswordReset({ ...passwordReset, password: e.target.value })} /></label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasswordReset(null)}>取消</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : '重置密码'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function TrashDialog({
  trash,
  tab,
  close,
  setTab,
  restoreWorkOrder,
  restoreFile,
}: {
  trash: TrashDTO;
  tab: 'workOrders' | 'files';
  close: () => void;
  setTab: (tab: 'workOrders' | 'files') => void;
  restoreWorkOrder: (id: string) => void;
  restoreFile: (id: string) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-label="回收站">
        <div className="dialog-title">
          <strong>回收站</strong>
          <button type="button" onClick={close}>×</button>
        </div>
        <div className="trash-tabs">
          <button className={tab === 'workOrders' ? 'active' : ''} type="button" onClick={() => setTab('workOrders')}>工单</button>
          <button className={tab === 'files' ? 'active' : ''} type="button" onClick={() => setTab('files')}>文件</button>
        </div>
        {tab === 'workOrders' ? (
          <div className="compact-table trash-table">
            <div className="compact-head"><span>工单号</span><span>产品名称</span><span>删除时间</span><span>操作</span></div>
            {trash.workOrders.map(item => (
              <div className="compact-row" key={item.id}>
                <span>{item.code}</span>
                <span>{item.productName}</span>
                <span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span>
                <span><button type="button" onClick={() => restoreWorkOrder(item.id)}>恢复</button></span>
              </div>
            ))}
            {!trash.workOrders.length && <div className="empty-list">暂无已删除工单</div>}
          </div>
        ) : (
          <div className="compact-table trash-table files">
            <div className="compact-head"><span>文件名</span><span>所属工单</span><span>分类</span><span>版本</span><span>删除时间</span><span>操作</span></div>
            {trash.resourceFiles.map(item => (
              <div className="compact-row" key={item.id}>
                <span>{displayFileName(item)}</span>
                <span>{item.workOrderCode || '-'}</span>
                <span>{item.categoryName || '-'}</span>
                <span>{item.version || 'V1.0'}</span>
                <span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span>
                <span><button type="button" onClick={() => restoreFile(item.id)}>恢复</button></span>
              </div>
            ))}
            {!trash.resourceFiles.length && <div className="empty-list">暂无已删除文件</div>}
          </div>
        )}
      </section>
    </div>
  );
}

function HelpDialog({ close, exportDiagnostics }: { close: () => void; exportDiagnostics: () => void }) {
  const items = [
    ['如何新建工单', '点击左侧“新建工单”，填写工单号、产品名称、阶段、状态和进度后保存。'],
    ['如何上传 PDF', '选择工单和分类后点击“批量上传 PDF”，等待上传队列显示成功。'],
    ['如何拍照上传', '选择分类后点击“拍照上传”，平板会打开后置摄像头，拍完自动走图片上传流程。'],
    ['如何移动错传文件', '选择文件后点击“编辑文件”，在弹窗里调整所属工单或所属分类并保存。'],
    ['如何恢复误删文件', '打开“回收站”，切到文件或工单列表，点击恢复。'],
    ['如何下载全部资料', '选择工单后点击“下载全部”，系统会按分类打包 ZIP。'],
    ['如何导入 CSV', '系统设置中下载模板，填写后上传 CSV，查看逐行结果。'],
    ['如何添加到桌面', '用平板浏览器打开系统，在浏览器菜单中选择添加到桌面或安装应用。'],
  ];
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="help-dialog" role="dialog" aria-modal="true" aria-label="使用帮助">
        <div className="dialog-title">
          <strong>使用帮助</strong>
          <button type="button" onClick={close}>×</button>
        </div>
        <div className="help-grid">
          {items.map(([title, body]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <section className="system-section wide">
          <h3>常见错误</h3>
          <p>上传失败：检查格式、大小和对象存储状态。预览打不开：刷新页面或联系管理员检查公开访问端点。找不到工单：使用全局搜索或二维码直达链接。密码忘记：请使用账号管理中的重置密码。</p>
          <div className="system-actions">
            <button className="primary-button" type="button" onClick={exportDiagnostics}>导出问题诊断信息</button>
          </div>
        </section>
      </section>
    </div>
  );
}

function QrDialog({
  order,
  completionText,
  qrDataUrl,
  qrLink,
  now,
  close,
  printQr,
}: {
  order: WorkOrderDTO;
  completionText: string;
  qrDataUrl: string;
  qrLink: string;
  now: Date | null;
  close: () => void;
  printQr: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="qr-dialog" role="dialog" aria-modal="true" aria-label="工单二维码">
        <div className="dialog-title">
          <strong>工单二维码</strong>
          <button type="button" onClick={close}>×</button>
        </div>
        <div className="qr-print-area">
          <h1>{order.code}</h1>
          <p>{order.productName}</p>
          {qrDataUrl && <img src={qrDataUrl} alt="工单直达二维码" />}
          <dl>
            <div><dt>资料状态</dt><dd>{completionText}</dd></div>
            <div><dt>打印时间</dt><dd>{now ? dt(now.toISOString()) : '-'}</dd></div>
            <div><dt>链接</dt><dd>{qrLink}</dd></div>
          </dl>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={close}>关闭</button>
          <button className="primary-button" type="button" onClick={printQr}>打印二维码</button>
        </div>
      </section>
    </div>
  );
}

function SystemSettings({
  userName,
  now,
  status,
  loading,
  exporting,
  importing,
  importResult,
  canInstall,
  close,
  refreshStatus,
  refreshData,
  openLogs,
  openAccounts,
  openTrash,
  openHelp,
  logout,
  installApp,
  chooseImport,
  downloadTemplate,
  exportWorkOrders,
  exportResourceFiles,
  exportOperationLogs,
  exportMetadata,
  exportDiagnostics,
}: {
  userName: string;
  now: Date | null;
  status: SystemStatus | null;
  loading: boolean;
  exporting: string;
  importing: boolean;
  importResult: ImportResult | null;
  canInstall: boolean;
  close: () => void;
  refreshStatus: () => void;
  refreshData: () => void;
  openLogs: () => void;
  openAccounts: () => void;
  openTrash: () => void;
  openHelp: () => void;
  logout: () => void;
  installApp: () => void;
  chooseImport: () => void;
  downloadTemplate: () => void;
  exportWorkOrders: () => void;
  exportResourceFiles: () => void;
  exportOperationLogs: () => void;
  exportMetadata: () => void;
  exportDiagnostics: () => void;
}) {
  const okText = (value?: boolean) => (value ? '正常' : '异常');
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="system-dialog" role="dialog" aria-modal="true" aria-label="系统设置">
        <div className="dialog-title">
          <div>
            <strong>系统设置</strong>
            <small>v1.6.0-rc.1 · Web / PWA</small>
          </div>
          <button type="button" onClick={close}>×</button>
        </div>

        <div className="system-grid">
          <section className="system-section">
            <h3>基础信息</h3>
            <Info label="系统名称" value={status?.app.name || '工单资料库'} />
            <Info label="当前版本" value={status?.app.version || 'v1.6.0-rc.1'} />
            <Info label="部署模式" value={status?.app.mode || 'Web / PWA'} />
            <Info label="数据模式" value={status?.data.mode || '账号登录，共享数据'} />
            <Info label="权限模式" value={status?.data.permissions || '无角色权限'} />
            <Info label="当前用户" value={userName} />
            <Info label="当前时间" value={now ? dt(now.toISOString()) : '-'} />
          </section>

          <section className="system-section">
            <h3>存储与健康</h3>
            {loading ? <div className="empty-list">系统状态检查中...</div> : (
              <>
                <Info label="API 健康状态" value={okText(status?.ok)} ok={status?.ok} />
                <Info label="数据库" value={`${status?.database.type || 'PostgreSQL'} · ${okText(status?.database.ok)}`} ok={status?.database.ok} />
                <Info label="文件存储" value={`${status?.storage.type || 'S3 兼容对象存储'} · ${okText(status?.storage.ok)}`} ok={status?.storage.ok} />
                <Info label="存储桶配置" value={status?.storage.bucketConfigured ? '已配置' : '未配置'} ok={status?.storage.bucketConfigured} />
                <Info label="公开访问端点" value={status?.storage.publicEndpointConfigured ? '已配置' : '未配置'} ok={status?.storage.publicEndpointConfigured} />
                <Info label="最大上传大小" value={`${status?.upload.maxUploadSizeMb || 50} MB`} />
                <Info label="支持格式" value={(status?.upload.supportedTypes || ['PDF', 'JPG', 'PNG']).join('、')} />
              </>
            )}
          </section>
        </div>

        <section className="system-section wide">
          <h3>数据导出</h3>
          <div className="system-actions">
            <button type="button" disabled={!!exporting} onClick={exportWorkOrders}>{exporting === '导出工单 CSV' ? '导出中...' : '导出工单 CSV'}</button>
            <button type="button" disabled={!!exporting} onClick={exportResourceFiles}>{exporting === '导出文件清单 CSV' ? '导出中...' : '导出文件清单 CSV'}</button>
            <button type="button" disabled={!!exporting} onClick={exportOperationLogs}>{exporting === '导出操作日志 CSV' ? '导出中...' : '导出操作日志 CSV'}</button>
            <button type="button" disabled={!!exporting} onClick={exportMetadata}>{exporting === '导出元数据 JSON' ? '导出中...' : '导出元数据 JSON'}</button>
            <button type="button" disabled={!!exporting} onClick={exportDiagnostics}>{exporting === '导出问题诊断信息' ? '导出中...' : '导出问题诊断信息'}</button>
          </div>
        </section>

        <section className="system-section wide">
          <h3>工单批量导入</h3>
          <p>支持 UTF-8 CSV，可使用中文或英文表头。工单号已存在时默认更新未删除工单；已软删除记录会跳过。</p>
          <div className="system-actions">
            <button type="button" disabled={!!exporting} onClick={downloadTemplate}>{exporting === '下载导入模板' ? '下载中...' : '下载 CSV 模板'}</button>
            <button className="primary-button" type="button" disabled={importing} onClick={chooseImport}>{importing ? '导入中...' : '上传 CSV 导入'}</button>
          </div>
          {importResult && (
            <div className="import-result">
              <div className="import-summary">
                <span>新增 {importResult.summary.created}</span>
                <span>更新 {importResult.summary.updated}</span>
                <span>跳过 {importResult.summary.skipped}</span>
                <span>失败 {importResult.summary.failed}</span>
              </div>
              <details>
                <summary>查看逐行结果</summary>
                <div className="import-result-list">
                  {importResult.results.map(row => (
                    <div className={`import-row ${row.status}`} key={`${row.row}-${row.code}`}>
                      <span>第 {row.row} 行</span>
                      <b>{row.code}</b>
                      <em>{row.status === 'created' ? '新增' : row.status === 'updated' ? '更新' : row.status === 'skipped' ? '跳过' : '失败'}</em>
                      <small>{row.message}</small>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>

        <section className="system-section wide">
          <h3>添加到桌面</h3>
          <p>在鸿蒙平板浏览器中打开系统后，点击浏览器菜单，选择“添加到桌面 / 安装应用”。添加后建议横屏使用。</p>
          <div className="system-actions">
            <button type="button" onClick={installApp}>{canInstall ? '安装应用' : '查看添加说明'}</button>
            <button type="button" onClick={refreshStatus}>重新检查状态</button>
            <button type="button" onClick={refreshData}>刷新当前数据</button>
            <button type="button" onClick={openLogs}>打开操作日志</button>
            <button type="button" onClick={openAccounts}>账号管理</button>
            <button type="button" onClick={openTrash}>回收站</button>
            <button type="button" onClick={openHelp}>使用帮助</button>
            <button type="button" onClick={logout}>退出登录</button>
          </div>
        </section>
      </section>
    </div>
  );
}

function Info({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="info-item">
      <small>{label}</small>
      <strong className={ok ? 'success-text' : ''} title={value}>{value}</strong>
    </div>
  );
}
