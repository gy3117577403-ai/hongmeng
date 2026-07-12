'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { ImageViewer } from '@/components/ImageViewer';
import { LocalImportDialog, type LocalImportConnectionState, type LocalImportTaskView } from '@/components/LocalImportDialog';
import { PdfViewer } from '@/components/PdfViewer';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { getAndroidCapabilities, writeClipboardText } from '@/lib/client-platform';
import { compactFilename, safeDecodeFilename, safeDisplayFilename } from '@/lib/filenames';
import { compressImageForUpload, normalizeCapturedImage } from '@/lib/image-client';
import type { ChangeSnapshotDTO, ConnectorAssemblyManualDTO, ConnectorAssemblyManualSearchAssetDTO, ConnectorParameterDTO, CurrentUserDTO, DrawingLibraryItemDTO, FieldSummaryDTO, OperationLogDTO, ResourceCategoryDTO, ResourceFileDTO, TrashDTO, UserDTO, WorkOrderDTO } from '@/types';

type WorkOrderForm = {
  code: string;
  customerName: string;
  productName: string;
  stage: string;
  priority: string;
  status: string;
  progress: number;
  plannedAt: string;
  remark: string;
};

type WorkOrderModal = { mode: 'create' | 'edit'; order?: WorkOrderDTO } | null;
type UploadJob = {
  id: string;
  name: string;
  fileType: string;
  size: number;
  originalSize?: number;
  file?: File;
  workOrderId: string;
  categoryId: string;
  status: 'waiting' | 'uploading' | 'success' | 'failed';
  message?: string;
};
type DrawingLibraryUploadSync = {
  linked?: boolean;
  skipped?: boolean;
  itemId?: string;
  fileId?: string;
  error?: string;
  reason?: string;
};
type UploadResult = {
  ok: boolean;
  fileId?: string;
  message?: string;
  drawingLibrarySync?: DrawingLibraryUploadSync;
};
type FileForm = { displayName: string; remark: string; workOrderId: string; categoryId: string };
type ImportMode = 'standard' | 'weekly_plan';
type ImportPreviewRow = {
  rowNo: number;
  status: 'ready' | 'skipped' | 'invalid' | 'duplicate';
  reason: string;
  code: string;
  workOrder: {
    code: string;
    customerName?: string | null;
    productName: string;
    specification?: string | null;
    uncompletedQty?: string | null;
    drawingStatus?: string | null;
    materialStatus?: string | null;
    deliveryDay?: string | null;
    plannedAt?: string | null;
    remark?: string | null;
    sourceOrderNo?: string | null;
    salesperson?: string | null;
  };
};
type ImportPreview = {
  mode: ImportMode;
  sourceFileName: string;
  sourceSheetName?: string | null;
  weekStartDate?: string | null;
  warnings?: string[];
  summary: { totalRows: number; readyCount: number; skippedCount: number; invalidCount: number; duplicateCount: number };
  rows: ImportPreviewRow[];
};
type ImportResultRow = { row: number; code: string; status: 'created' | 'skipped' | 'failed'; message: string };
type ImportResult = { importBatchId?: string; summary: { created: number; skipped: number; failed: number; duplicateSkipped?: number; total: number }; results: ImportResultRow[] };
type ImportTarget = 'current' | 'draft_next';
type PlanView = 'current' | 'draft_next' | 'history';
type OrderQuickFilter = 'all' | 'today' | 'missing' | 'anomaly';
type WeeklyPlanClearSummary = {
  weekStartDate: string;
  weekEndDate: string;
  workOrderCount: number;
  workOrdersWithFiles: number;
  fileCount: number;
  connectorParameterCount: number;
  missingWorkOrders?: number;
  archiveCount?: number;
  drawingLibraryItemCount?: number;
  drawingLibraryFileCount?: number;
  willDeleteResourceFiles?: number;
  willDeleteDrawingLibraryItems?: number;
  willDeleteConnectorParameters?: number;
  clearedCount?: number;
};
type WeeklyPlanActivateSummary = {
  weekStartDate: string;
  weekEndDate: string;
  currentArchiveCount: number;
  nextActivateCount: number;
  missingWorkOrders: number;
  anomalyCount: number;
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
  fileCount: number;
  activatedCount?: number;
  archivedCount?: number;
};
type WeekAction = 'close' | 'activate_next' | null;
type RelatedHistory = { fileCount: number; workOrderCount: number } | null;
type UserForm = { username: string; displayName: string; password: string };
type AccountEdit = { id: string; displayName: string; isActive: boolean } | null;
type PasswordReset = { id: string; username: string; password: string } | null;
type SearchDrawingLibraryFile = {
  id: string;
  libraryItemId: string;
  categoryId: string;
  categoryName?: string | null;
  categoryCode?: string | null;
  originalName: string;
  displayName?: string | null;
  remark?: string | null;
  fileSize: number;
  version: string;
  item: {
    id: string;
    customerName: string;
    customerCode?: string | null;
    specification: string;
    productName?: string | null;
  };
};
type SearchResult = {
  workOrders: WorkOrderDTO[];
  resourceFiles: ResourceFileDTO[];
  drawingLibraryItems: DrawingLibraryItemDTO[];
  drawingLibraryFiles: SearchDrawingLibraryFile[];
  connectorParameters: ConnectorParameterDTO[];
  connectorAssemblyManuals: ConnectorAssemblyManualDTO[];
  connectorAssemblyManualAssets: ConnectorAssemblyManualSearchAssetDTO[];
};
type QuickMenu = { type: 'stage' | 'priority'; orderId: string; x: number; y: number } | null;
type ToolTab = 'info' | 'upload' | 'actions' | 'queue';
type SystemStatus = {
  ok: boolean;
  app: { name: string; version: string; mode: string; uptime?: number };
  data: { mode: string; permissions: string };
  database: { ok: boolean; type: string; latencyMs?: number };
  storage: { ok: boolean; type: string; bucketConfigured: boolean; publicEndpointConfigured: boolean; latencyMs?: number };
  upload: { maxUploadSizeMb: number; supportedTypes: string[] };
  migrations?: { schemaReachable: boolean };
  counts?: { workOrders: number; resourceFiles: number; connectorParameters: number; operationLogs: number; operationLogsRecent: number; dangerousOps: number; failedUploads: number; recentBatches: number; snapshotsRecent: number };
  warnings?: string[];
  serverTime: string;
};
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
type LocalImportTaskSession = LocalImportTaskView & {
  handshakeId: string;
  handoffTicket: string;
  launchUrl: string;
  loopbackUrl: string;
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
};

const appTimeZone = 'Asia/Shanghai';
const emptySearchResult: SearchResult = {
  workOrders: [],
  resourceFiles: [],
  drawingLibraryItems: [],
  drawingLibraryFiles: [],
  connectorParameters: [],
  connectorAssemblyManuals: [],
  connectorAssemblyManualAssets: [],
};

function dateParts(v: string | Date) {
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const k = n / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  return `${(k / 1024).toFixed(2)} MB`;
}

function dt(v: string, withTime = true) {
  const parts = dateParts(v);
  if (!parts) return v;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (!withTime) return day;
  return `${day} ${parts.hour}:${parts.minute}`;
}

function shortName(name: string) {
  return compactFilename(name, 24);
}

function sameDay(value: string) {
  const d = dateParts(value);
  const now = dateParts(new Date());
  return !!d && !!now && d.year === now.year && d.month === now.month && d.day === now.day;
}

function inRecentWeek(value: string) {
  const d = new Date(value).getTime();
  return Number.isFinite(d) && d >= Date.now() - 6 * 24 * 60 * 60 * 1000;
}

function ymdLocal(value: string | Date) {
  const parts = dateParts(value);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysYmd(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return ymdLocal(date);
}

function nextMondayYmd() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (8 - day));
  date.setHours(0, 0, 0, 0);
  return ymdLocal(date);
}

function displayFileName(file?: ResourceFileDTO | null) {
  return safeDisplayFilename(file);
}

function drawingSearchFileName(file: SearchDrawingLibraryFile) {
  return safeDecodeFilename(file.displayName || file.originalName || '未命名图纸文件');
}

function hasSearchResults(result: SearchResult) {
  return result.workOrders.length
    || result.resourceFiles.length
    || result.drawingLibraryItems.length
    || result.drawingLibraryFiles.length
    || result.connectorParameters.length
    || result.connectorAssemblyManuals.length
    || result.connectorAssemblyManualAssets.length;
}

function fileExtOk(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);
}

const priorityText: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };
const flowStages = [
  ['not_issued', '未发图'],
  ['frontend', '在前端'],
  ['backend', '在后端'],
  ['completed', '已完成'],
] as const;
const flowStageText: Record<string, string> = Object.fromEntries(flowStages) as Record<string, string>;
const flowAliases: Record<string, string> = {
  not_issued: 'not_issued',
  pending: 'not_issued',
  未发图: 'not_issued',
  待处理: 'not_issued',
  frontend: 'frontend',
  processing: 'frontend',
  前端: 'frontend',
  在前端: 'frontend',
  进行中: 'frontend',
  backend: 'backend',
  后端: 'backend',
  在后端: 'backend',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  已完成: 'completed',
};
const fileStatusText: Record<string, string> = { uploaded: '已上传', deleted: '已删除' };
const actionText: Record<string, string> = {
  login: '登录',
  logout: '退出登录',
  upload: '上传文件',
  upload_retry: '重试上传',
  upload_failed: '上传失败',
  delete: '软删除文件',
  delete_resource_file: '软删除文件',
  change_password: '修改密码',
  create_work_order: '新建工单',
  update_work_order: '编辑工单',
  update_work_order_customer: '修改客户名称',
  update_work_order_status: '修改工单状态',
  update_work_order_priority: '修改优先级',
  update_work_order_planned_at: '修改计划时间',
  delete_work_order: '删除工单',
  download: '下载文件',
  download_work_order_package: '下载资料包',
  update_resource_file: '编辑文件信息',
  export_work_orders: '导出工单',
  export_resource_files: '导出文件清单',
  export_operation_logs: '导出操作日志',
  export_metadata: '导出元数据',
  import_work_orders: '导入工单',
  close_weekly_work_orders: '归档当前周工单',
  activate_next_weekly_work_orders: '启用下周工单',
  activate_next_week: '启用下周工单',
  create_user: '新增账号',
  update_user: '编辑账号',
  disable_user: '禁用账号',
  reset_user_password: '重置密码',
  restore_work_order: '恢复工单',
  restore_resource_file: '恢复文件',
  move_resource_file: '移动文件',
  copy_work_order_link: '复制工单链接',
  copy_work_order_spec: '复制规格',
  print_work_order_qr: '打印工单二维码',
  export_diagnostics: '导出诊断信息',
  create_drawing_library_item: '新增图纸资料',
  update_drawing_library_item: '编辑图纸资料',
  delete_drawing_library_item: '删除图纸资料',
  restore_drawing_library_item: '恢复图纸资料',
  upload_drawing_library_file: '上传图纸资料文件',
  update_drawing_library_file: '编辑图纸资料文件',
  delete_drawing_library_file: '删除图纸资料文件',
  restore_drawing_library_file: '恢复图纸资料文件',
  download_drawing_library_file: '下载图纸资料文件',
  cleanup_empty_drawing_library: '清理空图纸资料',
  sync_resource_file_to_drawing_library: '同步生产资料到图纸资料库',
  sync_work_order_to_drawing_library: '同步工单资料到图纸资料库',
  create_connector_parameter: '新增连接器参数',
  update_connector_parameter: '编辑连接器参数',
  delete_connector_parameter: '删除连接器参数',
  restore_connector_parameter: '恢复连接器参数',
  batch_update_connector_parameters: '批量更新连接器参数',
  batch_delete_connector_parameters: '批量删除连接器参数',
  copy_connector_parameter: '复制连接器参数',
  import_connector_parameters: '导入连接器参数',
  export_connector_parameters: '导出连接器参数',
  upload_connector_parameter_file: '上传连接器原始资料',
  delete_connector_parameter_file: '删除连接器原始资料',
  download_connector_parameter_file: '下载连接器原始资料',
  create_connector_parameter_import_batch: '创建导入批次',
  rollback_connector_parameter_import_batch: '回滚导入批次',
  rollback_import_batch: '回滚导入批次',
};
const categoryIcons: Record<string, string> = { drawing: '原', sop: 'SOP', product: '成', material: '辅', notice: '注' };
const fileTypeText: Record<string, string> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG', jpeg: 'JPG', webp: 'WEBP' };
const requiredCategoryCodes = new Set(['drawing', 'sop', 'product']);
const emptyForm: WorkOrderForm = { code: '', customerName: '', productName: '', stage: 'not_issued', priority: 'normal', status: 'pending', progress: 0, plannedAt: '', remark: '' };
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
  ['drawing_library', '图纸资料库'],
  ['connector', '连接器参数'],
];

function completionOf(categories: ResourceCategoryDTO[], counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const missingCategories = requiredMissingCategories(categories, counts);
  const missing = missingCategories.length;
  if (total === 0) {
    return { key: 'empty', text: `资料 0/${categories.length || 0}`, missing, missingNames: missingCategories.map(c => c.name) };
  }
  return missing
    ? { key: 'missing', text: `缺资料 ${missing}`, missing, missingNames: missingCategories.map(c => c.name) }
    : { key: 'complete', text: '资料完整', missing: 0, missingNames: [] };
}

function requiredMissingCategories(categories: ResourceCategoryDTO[], counts: Record<string, number>) {
  return categories.filter(c => requiredCategoryCodes.has(c.code) && !counts[c.id]);
}

function requiredMissing(categories: ResourceCategoryDTO[], counts: Record<string, number>) {
  return requiredMissingCategories(categories, counts).length;
}

function categoryNameLines(category?: ResourceCategoryDTO | null) {
  if (!category) return ['-'];
  if (category.code === 'sop') return ['SOP', '指导书'];
  if (category.code === 'material') return ['辅料', '规格'];
  if (category.code === 'notice') return ['注意', '事项'];
  return [category.name];
}

function normalizeFlowStage(value?: string | null) {
  return flowAliases[String(value || '').trim()] || 'not_issued';
}

function flowText(value?: string | null) {
  return flowStageText[normalizeFlowStage(value)];
}

function shortDt(v?: string | null) {
  if (!v) return '';
  const parts = dateParts(v);
  if (!parts) return '';
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function customerLabel(order?: WorkOrderDTO | null) {
  return order?.customerName?.trim() || '未设置';
}

function workOrderDisplayCode(order?: WorkOrderDTO | null) {
  return order?.displayCode?.trim() || order?.specification?.trim() || order?.code?.trim() || '-';
}

function orderSpecLabel(order?: WorkOrderDTO | null) {
  return workOrderDisplayCode(order);
}

function orderDeliveryLabel(order?: WorkOrderDTO | null) {
  if (!order) return '-';
  const parts = [order.deliveryDay || '', order.plannedAt ? shortDt(order.plannedAt) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : '-';
}

function orderDrawingMaterialLabel(order?: WorkOrderDTO | null) {
  if (!order) return '-';
  return [order.drawingStatus || '图纸未填', order.materialStatus || '配料未填'].join(' / ');
}

function toDatetimeLocal(v?: string | null) {
  if (!v) return '';
  const parts = dateParts(v);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function plannedClass(order?: WorkOrderDTO | null) {
  if (!order?.plannedAt) return '';
  if (normalizeFlowStage(order.stage) === 'completed') return 'done';
  const t = new Date(order.plannedAt).getTime();
  if (!Number.isFinite(t)) return '';
  if (t < Date.now()) return 'overdue';
  if (t - Date.now() <= 24 * 60 * 60 * 1000) return 'soon';
  return '';
}

function toForm(order?: WorkOrderDTO): WorkOrderForm {
  if (!order) return emptyForm;
  return {
    code: order.code,
    customerName: order.customerName || '',
    productName: order.productName,
    stage: order.stage,
    priority: order.priority,
    status: order.status,
    progress: order.progress,
    plannedAt: toDatetimeLocal(order.plannedAt),
    remark: order.remark || '',
  };
}

const productionRestoreStages = ['not_issued', 'frontend', 'backend', 'completed'];

function scheduleProductionViewportRestore(returnKey: string, attempt = 0): void {
  if (!returnKey || attempt > 10) return;
  window.setTimeout(() => {
    if (window.location.pathname !== '/production') {
      scheduleProductionViewportRestore(returnKey, attempt + 1);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`production-execution:return:${returnKey}`);
      const saved = raw ? JSON.parse(raw) as { boardScrollLeft?: number; columnScrollTops?: Record<string, number> } : null;
      const shell = document.querySelector<HTMLElement>('.production-board-shell');
      const columns = Array.from(document.querySelectorAll<HTMLElement>('.production-column-list'));
      if (!saved || !shell || columns.length !== 4) {
        scheduleProductionViewportRestore(returnKey, attempt + 1);
        return;
      }
      shell.scrollLeft = saved.boardScrollLeft || 0;
      productionRestoreStages.forEach((stage, index) => { columns[index].scrollTop = saved.columnScrollTops?.[stage] || 0; });
      window.requestAnimationFrame(() => {
        const expectedLeft = Math.min(saved.boardScrollLeft || 0, Math.max(0, shell.scrollWidth - shell.clientWidth));
        const columnsMatch = productionRestoreStages.every((stage, index) => {
          const expected = Math.min(saved.columnScrollTops?.[stage] || 0, Math.max(0, columns[index].scrollHeight - columns[index].clientHeight));
          return Math.abs(columns[index].scrollTop - expected) <= 1;
        });
        if (Math.abs(shell.scrollLeft - expectedLeft) <= 1 && columnsMatch) {
          sessionStorage.removeItem(`production-execution:return:${returnKey}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
        } else {
          scheduleProductionViewportRestore(returnKey, attempt + 1);
        }
      });
    } catch {
      scheduleProductionViewportRestore(returnKey, attempt + 1);
    }
  }, attempt === 0 ? 180 : 100);
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
  const router = useRouter();
  const [orders, setOrders] = useState(initialWorkOrders);
  const [kw, setKw] = useState('');
  const [orderFilter, setOrderFilter] = useState<OrderQuickFilter>('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [planView, setPlanView] = useState<PlanView>('current');
  const [wo, setWo] = useState(initialWorkOrders[0]?.id || '');
  const [cat, setCat] = useState(categories[0]?.id || '');
  const [files, setFiles] = useState<ResourceFileDTO[]>([]);
  const [allFiles, setAllFiles] = useState<ResourceFileDTO[]>([]);
  const [relatedHistory, setRelatedHistory] = useState<RelatedHistory>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerCategory, setManagerCategory] = useState('all');
  const [sel, setSel] = useState('');
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>(initialWorkOrders[0]?.categoryFileCounts || {});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [msg, setMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [drawingSyncing, setDrawingSyncing] = useState(false);
  const [lib, setLib] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [deleteTarget, setDeleteTarget] = useState<ResourceFileDTO | null>(null);
  const [orderDeleteTarget, setOrderDeleteTarget] = useState<WorkOrderDTO | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [orderDeleteConfirmText, setOrderDeleteConfirmText] = useState('');
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
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ChangeSnapshotDTO[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('weekly_plan');
  const [importTarget, setImportTarget] = useState<ImportTarget>('draft_next');
  const [importWeekStart, setImportWeekStart] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [clearWeekStart, setClearWeekStart] = useState('');
  const [clearPreview, setClearPreview] = useState<WeeklyPlanClearSummary | null>(null);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearError, setClearError] = useState('');
  const [clearingWeeklyPlan, setClearingWeeklyPlan] = useState(false);
  const [weekAction, setWeekAction] = useState<WeekAction>(null);
  const [weekActionDate, setWeekActionDate] = useState('');
  const [weekActionSummary, setWeekActionSummary] = useState<WeeklyPlanClearSummary | WeeklyPlanActivateSummary | null>(null);
  const [weekActionConfirmText, setWeekActionConfirmText] = useState('');
  const [weekActionError, setWeekActionError] = useState('');
  const [weekActionLoading, setWeekActionLoading] = useState(false);
  const [draftDiffTypes, setDraftDiffTypes] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'import'>('skip');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [globalKw, setGlobalKw] = useState('');
  const [globalSearch, setGlobalSearch] = useState<SearchResult>(emptySearchResult);
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
  const [trashTab, setTrashTab] = useState<'workOrders' | 'files' | 'manuals' | 'manualVersions' | 'manualAssets'>('workOrders');
  const [helpOpen, setHelpOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLink, setQrLink] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [quickMenu, setQuickMenu] = useState<QuickMenu>(null);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [toolTab, setToolTab] = useState<ToolTab>('info');
  const [toolWidth, setToolWidth] = useState(320);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [localImportOpen, setLocalImportOpen] = useState(false);
  const [localImportTask, setLocalImportTask] = useState<LocalImportTaskSession | null>(null);
  const [localImportConnection, setLocalImportConnection] = useState<LocalImportConnectionState>('creating');
  const [localImportError, setLocalImportError] = useState('');
  const [productionReturnKey, setProductionReturnKey] = useState('');

  const pdf = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLInputElement>(null);
  const csvImport = useRef<HTMLInputElement>(null);
  const drawerTouch = useRef<{ startX: number; startY: number; fromEdge: boolean; fromDrawer: boolean } | null>(null);
  const toolRef = useRef<HTMLElement>(null);
  const toolRailRef = useRef<HTMLDivElement>(null);
  const toolResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryMenuButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
  const directTargetRef = useRef<{ workOrderId: string; categoryId: string; fileId: string } | null>(null);
  const localImportLatestFileRef = useRef('');
  const localImportCompletionRef = useRef('');
  const localImportLaunchAttemptRef = useRef(0);

  const list = useMemo(() => {
    const text = kw.trim().toLowerCase();
    return orders.filter(o => {
      const matchesText = !text || [
        o.displayCode,
        o.code,
        o.productName,
        o.customerName,
        o.specification,
        o.sourceOrderNo,
        o.salesperson,
        o.remark,
      ].some(value => String(value || '').toLowerCase().includes(text));
      if (!matchesText) return false;
      if (stageFilter !== 'all' && normalizeFlowStage(o.stage) !== stageFilter) return false;
      if (orderFilter === 'today') return !!o.plannedAt && sameDay(o.plannedAt);
      if (orderFilter === 'missing') return requiredMissing(categories, o.categoryFileCounts || {}) > 0;
      if (orderFilter === 'anomaly') {
        const hasCore = !!(customerLabel(o) !== '未设置' && workOrderDisplayCode(o) !== '-' && o.productName?.trim());
        return !hasCore || requiredMissing(categories, o.categoryFileCounts || {}) > 0 || plannedClass(o) === 'overdue';
      }
      return true;
    });
  }, [orders, kw, orderFilter, stageFilter, categories]);

  const order = orders.find(o => o.id === wo) || orders[0];
  const category = categories.find(c => c.id === cat) || categories[0];
  const file = files.find(f => f.id === sel) || files[0];
  const latestFileId = files[0]?.id || '';
  const accountName = user.displayName || user.username;
  const currentCounts = order?.id === wo ? categoryCounts : order?.categoryFileCounts || {};
  const completedCategories = categories.filter(c => (currentCounts[c.id] || 0) > 0).length;
  const completion = completionOf(categories, currentCounts);
  const completionText = categories.length
    ? completion.key === 'empty'
      ? completion.text
      : `${completion.text} · ${completedCategories}/${categories.length}`
    : '未配置分类';
  const missingCategoryNames = requiredMissingCategories(categories, currentCounts).map(c => c.name);
  const missingCategoryText = missingCategoryNames.length ? `缺失：${missingCategoryNames.join('、')}` : '必填资料已齐全';
  const currentOrderFileCount = Object.values(currentCounts).reduce((sum, count) => sum + count, 0);
  const currentCategoryName = category?.name || '-';
  const currentCategoryIsEmpty = !loading && !file;
  const canDownloadAll = !!order && currentOrderFileCount > 0;
  const orderReadOnly = !!order && order.planType === 'weekly_plan' && order.planActive === false && !!order.planClearedAt;
  const visibleToday = list.filter(o => !!o.plannedAt && sameDay(o.plannedAt));
  const visibleWeek = list;
  const drawerWeekStart = list.find(o => o.weekStartDate)?.weekStartDate || order?.weekStartDate || '';
  const drawerWeekEnd = list.find(o => o.weekEndDate)?.weekEndDate || order?.weekEndDate || '';
  const drawerWeekLabel = drawerWeekStart
    ? `${ymdLocal(drawerWeekStart)} 至 ${drawerWeekEnd ? ymdLocal(drawerWeekEnd) : addDaysYmd(drawerWeekStart, 6)}`
    : planView === 'draft_next'
      ? '下周草稿'
      : planView === 'history'
        ? '历史周'
        : '当前周';
  const managerFiles = managerCategory === 'all' ? allFiles : allFiles.filter(f => f.categoryId === managerCategory);
  const fileOrderOptions = useMemo(() => {
    const text = fileOrderKw.trim().toLowerCase();
    return orders.filter(o => !text || [
      o.displayCode,
      o.code,
      o.productName,
      o.customerName,
      o.specification,
      o.sourceOrderNo,
      o.salesperson,
      o.remark,
    ].some(value => String(value || '').toLowerCase().includes(text))).slice(0, 30);
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
    const raw = window.localStorage.getItem('hongmeng:resourceTool');
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { open?: boolean; tab?: ToolTab; width?: number };
        setToolOpen(!!saved.open);
        if (saved.tab && ['info', 'upload', 'actions', 'queue'].includes(saved.tab)) setToolTab(saved.tab);
        if (typeof saved.width === 'number') setToolWidth(Math.min(420, Math.max(260, saved.width)));
      } catch {
        window.localStorage.removeItem('hongmeng:resourceTool');
      }
    }
    if (window.innerWidth <= 1024) setThumbsOpen(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('hongmeng:resourceTool', JSON.stringify({ open: toolOpen, tab: toolTab, width: toolWidth }));
  }, [toolOpen, toolTab, toolWidth]);

  useEffect(() => {
    if (!productionReturnKey) return undefined;
    const handleHistoryReturn = (): void => scheduleProductionViewportRestore(productionReturnKey);
    window.addEventListener('popstate', handleHistoryReturn);
    return () => window.removeEventListener('popstate', handleHistoryReturn);
  }, [productionReturnKey]);

  useEffect(() => {
    if (!loading && !file && !toolOpen && toolTab !== 'upload') setToolTab('upload');
  }, [file, loading, toolOpen, toolTab]);

  useEffect(() => {
    setDeleteConfirmText('');
  }, [deleteTarget?.id]);

  useEffect(() => {
    setOrderDeleteConfirmText('');
  }, [orderDeleteTarget?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workOrderId = params.get('workOrderId');
    const workOrderCode = params.get('workOrderCode') || params.get('workOrder');
    const requestedCategoryId = params.get('categoryId');
    const requestedCategoryCode = params.get('categoryCode');
    const requestedFileId = params.get('fileId') || '';
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
    const requestedCategory = requestedCategoryId
      ? categories.find(categoryItem => categoryItem.id === requestedCategoryId)
      : requestedCategoryCode
        ? categories.find(categoryItem => categoryItem.code === requestedCategoryCode)
        : null;
    const targetCategoryId = requestedCategory?.id || (storedCategoryId && categories.some(categoryItem => categoryItem.id === storedCategoryId) ? storedCategoryId : categories[0]?.id || '');
    if (targetCategoryId) setCat(targetCategoryId);
    if (target && targetCategoryId && (workOrderId || workOrderCode)) {
      directTargetRef.current = { workOrderId: target.id, categoryId: targetCategoryId, fileId: requestedFileId };
    }
    if (params.get('from') === 'production' && params.get('returnKey')) setProductionReturnKey(params.get('returnKey') || '');
    const requestedPlanView = params.get('planView');
    if (requestedPlanView === 'current' || requestedPlanView === 'draft_next' || requestedPlanView === 'history') setPlanView(requestedPlanView);
    if (params.get('openOrders') === '1') setDrawerOpen(true);
    if (params.get('openWeeklyImport') === '1') void openNextWeekImport();
    if (params.get('openSettings') === '1') void openSystemSettings();
    if (params.get('openLogs') === '1') void loadLogs('all');
    if (params.get('openTrash') === '1') void openTrash();
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
      setGlobalSearch(emptySearchResult);
      setSearchOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?keyword=${encodeURIComponent(text)}`, { cache: 'no-store', signal: controller.signal });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          const data = d.data || d;
          setGlobalSearch({
            workOrders: Array.isArray(data.workOrders) ? data.workOrders : [],
            resourceFiles: Array.isArray(data.resourceFiles) ? data.resourceFiles : [],
            drawingLibraryItems: Array.isArray(data.drawingLibraryItems) ? data.drawingLibraryItems : [],
            drawingLibraryFiles: Array.isArray(data.drawingLibraryFiles) ? data.drawingLibraryFiles : [],
            connectorParameters: Array.isArray(data.connectorParameters) ? data.connectorParameters : [],
            connectorAssemblyManuals: Array.isArray(data.connectorAssemblyManuals) ? data.connectorAssemblyManuals : [],
            connectorAssemblyManualAssets: Array.isArray(data.connectorAssemblyManualAssets) ? data.connectorAssemblyManualAssets : [],
          });
          setSearchOpen(true);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setMsg('全局搜索失败');
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
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

  function syncUrl(path: string, forceSync = false) {
    if (!forceSync) return path;
    return `${path}${path.includes('?') ? '&' : '?'}_sync=${Date.now()}`;
  }

  async function refreshOrders(preferredId?: string, forceSync = false) {
    const params = new URLSearchParams();
    if (planView !== 'current') params.set('planView', planView);
    const path = `/api/work-orders${params.toString() ? `?${params.toString()}` : ''}`;
    const r = await fetch(syncUrl(path, forceSync), { cache: 'no-store' });
    if (!r.ok) throw new Error('refresh work orders failed');
    const d = await r.json();
    const nextOrders: WorkOrderDTO[] = Array.isArray(d.workOrders) ? d.workOrders : [];
    setOrders(nextOrders);
    const nextId = preferredId && nextOrders.some(o => o.id === preferredId) ? preferredId : nextOrders[0]?.id || '';
    setWo(v => (v && nextOrders.some(o => o.id === v) ? v : nextId));
    return nextOrders;
  }

  useEffect(() => {
    refreshOrders(undefined, true).catch(() => setMsg('工单列表刷新失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planView]);

  useEffect(() => {
    if (planView !== 'draft_next') {
      setDraftDiffTypes({});
      return undefined;
    }
    const controller = new AbortController();
    fetch('/api/work-orders/week/diff?pageSize=500', { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        const items = Array.isArray(body?.data?.items) ? body.data.items as Array<{ type: string; nextOrderIds?: string[] }> : [];
        const labels: Record<string, string> = {};
        for (const item of items) for (const id of item.nextOrderIds || []) labels[id] = item.type;
        setDraftDiffTypes(labels);
      })
      .catch(reason => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDraftDiffTypes({});
      });
    return () => controller.abort();
  }, [planView]);

  async function loadFiles(w = order?.id, c = category?.id, preferredFileId?: string, forceSync = false) {
    if (!w || !c) {
      setFiles([]);
      setSel('');
      setRelatedHistory(null);
      return [];
    }
    setLoading(true);
    try {
      const r = await fetch(syncUrl(`/api/resource-files?workOrderId=${w}&categoryId=${c}`, forceSync), { cache: 'no-store' });
      if (!r.ok) throw new Error('load files failed');
      const d = await r.json();
      const nextFiles: ResourceFileDTO[] = Array.isArray(d.files) ? d.files : [];
      setFiles(nextFiles);
      setRelatedHistory(d.relatedHistory || null);
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

  async function loadAllFiles(w = order?.id, forceSync = false) {
    if (!w) {
      setAllFiles([]);
      return [];
    }
    try {
      const r = await fetch(syncUrl(`/api/resource-files?workOrderId=${w}`, forceSync), { cache: 'no-store' });
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

  async function loadCategoryCounts(w = order?.id, forceSync = false) {
    if (!w) {
      setCategoryCounts({});
      return {};
    }
    try {
      const all = await loadAllFiles(w, forceSync);
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

  function openHelperProtocol(launchUrl: string) {
    const frame = document.createElement('iframe');
    frame.src = launchUrl;
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 4000);
  }

  async function handoffLocalImportTask(task: LocalImportTaskSession) {
    if (!task.handoffTicket) {
      setLocalImportConnection('error');
      setLocalImportError('任务票据已清除，请重新创建导入任务');
      return;
    }
    const attempt = ++localImportLaunchAttemptRef.current;
    const startedAt = Date.now();
    setLocalImportConnection('launching');
    setLocalImportError('');
    openHelperProtocol(task.launchUrl);

    let handedOff = false;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (attempt !== localImportLaunchAttemptRef.current) return;
      await new Promise(resolve => window.setTimeout(resolve, 650));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1800);
      try {
        const response = await fetch(`${task.loopbackUrl}/handoff`, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handshakeId: task.handshakeId,
            taskId: task.taskId,
            ticket: task.handoffTicket,
            baseUrl: window.location.origin,
          }),
        });
        if (response.ok) {
          handedOff = true;
          break;
        }
      } catch {
        // The helper may still be starting or may not be installed.
      } finally {
        window.clearTimeout(timeout);
      }
      if (Date.now() - startedAt >= 2800 && attempt === localImportLaunchAttemptRef.current) {
        setLocalImportConnection('unavailable');
        setLocalImportError('助手尚未响应。请允许浏览器打开外部应用，或双击助手并输入手动任务码。');
      }
    }

    if (!handedOff) {
      if (attempt === localImportLaunchAttemptRef.current) {
        setLocalImportConnection('unavailable');
        setLocalImportError('未连接到 Windows 导入助手。请允许浏览器打开外部应用，或使用手动任务码连接。');
      }
      return;
    }

    while (Date.now() < deadline && attempt === localImportLaunchAttemptRef.current) {
      await new Promise(resolve => window.setTimeout(resolve, 600));
      try {
        const response = await fetch(`/api/local-import/tasks/${encodeURIComponent(task.taskId)}`, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (response.ok && ['connected', 'uploading', 'paused', 'completed'].includes(body?.data?.summary?.state)) {
          const minimumLoading = 2000 - (Date.now() - startedAt);
          if (minimumLoading > 0) await new Promise(resolve => window.setTimeout(resolve, minimumLoading));
          if (attempt !== localImportLaunchAttemptRef.current) return;
          setLocalImportConnection('connected');
          setLocalImportError('');
          return;
        }
      } catch {
        // The normal task poll remains active while this short launch check runs.
      }
      if (Date.now() - startedAt >= 2800) {
        setLocalImportConnection('unavailable');
        setLocalImportError('助手已收到唤起但尚未完成握手，可重新唤起或使用手动任务码。');
      }
    }
  }

  async function openLocalImport(forceNew = false) {
    if (!order) return setMsg('请先选择工单');
    if (!category) return setMsg('请先选择资料分类');
    if (orderReadOnly) return setMsg('历史周工单为只读状态，不能继续导入文件');

    setLocalImportOpen(true);
    setLocalImportError('');
    const reusable = !forceNew && localImportTask
      && localImportTask.workOrder.id === order.id
      && localImportTask.category.id === category.id
      && new Date(localImportTask.expiresAt).getTime() > Date.now()
      && !['completed', 'expired'].includes(localImportTask.summary.state);
    if (reusable) {
      await handoffLocalImportTask(localImportTask);
      return;
    }

    setLocalImportConnection('creating');
    try {
      const response = await fetch('/api/local-import/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId: order.id, categoryId: category.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.data) throw new Error(body.error || body.message || '创建导入任务失败');
      const task: LocalImportTaskSession = {
        ...body.data,
        summary: { state: 'waiting', successCount: 0, duplicateCount: 0, failedCount: 0, processedCount: 0 },
      };
      localImportLatestFileRef.current = '';
      localImportCompletionRef.current = '';
      setLocalImportTask(task);
      await handoffLocalImportTask(task);
    } catch (error) {
      setLocalImportConnection('error');
      setLocalImportError(error instanceof Error ? error.message : '创建导入任务失败');
    }
  }

  async function retryLocalImportHandoff() {
    if (!localImportTask) {
      await openLocalImport();
      return;
    }
    await handoffLocalImportTask(localImportTask);
  }

  async function recreateLocalImportTask() {
    localImportLaunchAttemptRef.current += 1;
    setLocalImportTask(null);
    await openLocalImport(true);
  }

  const localImportTaskId = localImportTask?.taskId || '';
  useEffect(() => {
    if (!localImportTaskId) return undefined;
    let active = true;
    let timer = 0;
    const poll = async () => {
      let terminal = false;
      try {
        const response = await fetch(`/api/local-import/tasks/${encodeURIComponent(localImportTaskId)}`, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body?.data) throw new Error(body.error || '导入任务状态读取失败');
        if (!active) return;
        const data = body.data as LocalImportTaskView & { summary: LocalImportTaskView['summary'] & { latestFileId?: string | null } };
        setLocalImportTask(current => current && current.taskId === localImportTaskId ? { ...current, ...data } : current);
        if (['connected', 'uploading', 'paused', 'completed'].includes(data.summary.state)) {
          setLocalImportConnection('connected');
          setLocalImportError('');
        }
        const latestFileId = data.summary.latestFileId || '';
        if (latestFileId && latestFileId !== localImportLatestFileRef.current) {
          localImportLatestFileRef.current = latestFileId;
          await loadFiles(data.workOrder.id, data.category.id, latestFileId, true);
          await loadCategoryCounts(data.workOrder.id, true);
        }
        if (data.summary.state === 'completed') {
          terminal = true;
          if (localImportCompletionRef.current !== localImportTaskId) {
            localImportCompletionRef.current = localImportTaskId;
            setMsg(`从微盘导入完成：成功 ${data.summary.successCount}，重复 ${data.summary.duplicateCount}，失败 ${data.summary.failedCount}`);
          }
          setLocalImportTask(current => current && current.taskId === localImportTaskId ? { ...current, handoffTicket: '' } : current);
        } else if (data.summary.state === 'expired') {
          terminal = true;
          setLocalImportConnection('unavailable');
          setLocalImportError('任务已过期，请重新创建任务。');
          setLocalImportTask(current => current && current.taskId === localImportTaskId ? { ...current, handoffTicket: '' } : current);
        }
      } catch (error) {
        if (active) setLocalImportError(error instanceof Error ? error.message : '导入任务状态读取失败');
      }
      if (active && !terminal) timer = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // The polling lifecycle is intentionally scoped to the immutable task id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localImportTaskId]);

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
    const currentParams = new URLSearchParams(window.location.search);
    const nextParams = new URLSearchParams({ workOrderId: targetId });
    if (targetCategoryId) nextParams.set('categoryId', targetCategoryId);
    if (targetFileId) nextParams.set('fileId', targetFileId);
    if (currentParams.get('from') === 'production' && currentParams.get('returnKey')) {
      nextParams.set('from', 'production');
      nextParams.set('returnKey', currentParams.get('returnKey') || '');
    }
    window.history.replaceState(window.history.state, '', `/dashboard?${nextParams.toString()}`);
    await loadFiles(targetId, targetCategoryId || cat, targetFileId);
    await loadAllFiles(targetId);
    setSearchOpen(false);
    setDrawerOpen(false);
  }

  async function openFileResult(target: ResourceFileDTO) {
    await openWorkOrder(target.workOrderId, target.categoryId, target.id);
  }

  function returnToProduction(): void {
    let fallbackUrl = '/production';
    try {
      const raw = sessionStorage.getItem(`production-execution:return:${productionReturnKey}`);
      const saved = raw ? JSON.parse(raw) as { returnUrl?: string } : null;
      if (saved?.returnUrl?.startsWith('/production')) fallbackUrl = saved.returnUrl;
    } catch {
      sessionStorage.removeItem(`production-execution:return:${productionReturnKey}`);
    }
    if (window.history.length > 1) {
      scheduleProductionViewportRestore(productionReturnKey);
      router.back();
      window.setTimeout(() => {
        if (window.location.pathname !== '/production') router.push(fallbackUrl, { scroll: false });
      }, 1500);
      return;
    }
    router.push(fallbackUrl, { scroll: false });
  }

  function openDrawingLibraryItemResult(itemId: string) {
    const params = new URLSearchParams();
    params.set('itemId', itemId);
    if (globalKw.trim()) params.set('keyword', globalKw.trim());
    location.href = `/drawing-library?${params.toString()}`;
  }

  function openDrawingLibraryFileResult(target: SearchDrawingLibraryFile) {
    const params = new URLSearchParams();
    params.set('itemId', target.libraryItemId);
    params.set('fileId', target.id);
    if (globalKw.trim()) params.set('keyword', globalKw.trim());
    location.href = `/drawing-library?${params.toString()}`;
  }

  function openConnectorParameterResult() {
    const params = new URLSearchParams();
    if (globalKw.trim()) params.set('keyword', globalKw.trim());
    location.href = `/connector-parameters?${params.toString()}`;
  }

  function openConnectorAssemblyManualResult(manualId: string, versionId?: string, pageNo?: number | null) {
    const params = new URLSearchParams({ manualId });
    if (versionId) params.set('versionId', versionId);
    if (pageNo) params.set('page', String(pageNo));
    location.href = `/connector-assembly-manuals?${params.toString()}`;
  }

  function openQuickMenu(type: 'stage' | 'priority', target: WorkOrderDTO, event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setQuickMenu({ type, orderId: target.id, x: rect.left, y: rect.bottom + 8 });
  }

  function openTool(tab: ToolTab) {
    setToolTab(tab);
    setToolOpen(true);
  }

  function openCameraCapture() {
    if (!order) {
      setMsg('未选择工单');
      return;
    }
    if (!category) {
      setMsg('未选择分类');
      return;
    }
    setToolTab('queue');
    setToolOpen(true);
    setCameraOpen(true);
  }

  function startToolResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    toolResizeRef.current = { startX: event.clientX, startWidth: toolWidth };
    const move = (moveEvent: PointerEvent) => {
      const start = toolResizeRef.current;
      if (!start) return;
      setToolWidth(Math.min(420, Math.max(260, start.startWidth - (moveEvent.clientX - start.startX))));
    };
    const stop = () => {
      toolResizeRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  async function updateWorkOrderQuick(target: WorkOrderDTO, patch: { stage?: string; priority?: string }) {
    const before = orders;
    mergeOrder({ ...target, ...patch, stage: patch.stage ? normalizeFlowStage(patch.stage) : target.stage });
    setQuickMenu(null);
    try {
      const r = await fetch(`/api/work-orders/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setOrders(before);
        setMsg(d.error || d.message || '保存失败');
        return;
      }
      mergeOrder(d.workOrder);
      setMsg(patch.stage ? '状态已更新' : '优先级已更新');
      await loadFieldSummary();
    } catch {
      setOrders(before);
      setMsg('网络异常，保存失败');
    }
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
      setTrash({
        workOrders: d.workOrders || [],
        resourceFiles: d.resourceFiles || [],
        connectorAssemblyManuals: d.connectorAssemblyManuals || [],
        connectorAssemblyManualVersions: d.connectorAssemblyManualVersions || [],
        connectorAssemblyManualAssets: d.connectorAssemblyManualAssets || [],
      });
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
    const directTarget = directTargetRef.current;
    const preferredFileId = directTarget && directTarget.workOrderId === order?.id && directTarget.categoryId === category?.id ? directTarget.fileId : undefined;
    if (directTarget && directTarget.workOrderId === order?.id && directTarget.categoryId === category?.id) directTargetRef.current = null;
    loadFiles(order?.id, category?.id, preferredFileId);
    loadAllFiles(order?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, cat]);

  useEffect(() => {
    loadCategoryCounts(order?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo]);

  useEffect(() => {
    if (!quickMenu) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.quick-menu, .flow-chip, .priority-chip')) return;
      setQuickMenu(null);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuickMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', closeByKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeByKey);
    };
  }, [quickMenu]);

  useEffect(() => {
    if (!toolOpen) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.resource-tools, .resource-tool-rail, .modal-backdrop')) return;
      setToolOpen(false);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', closeByKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeByKey);
    };
  }, [toolOpen]);

  function onShellTouchStart(e: React.TouchEvent<HTMLElement>) {
    const t = e.touches[0];
    const target = e.target as HTMLElement;
    const fromPreview = !!target.closest('.preview-card, .preview-stage, iframe, img');
    drawerTouch.current = {
      startX: t.clientX,
      startY: t.clientY,
      fromEdge: !drawerOpen && t.clientX <= 24 && !fromPreview,
      fromDrawer: drawerOpen && !!target.closest('.orders-drawer'),
    };
  }

  function onShellTouchEnd(e: React.TouchEvent<HTMLElement>) {
    const touch = drawerTouch.current;
    drawerTouch.current = null;
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.startX;
    const dy = Math.abs(t.clientY - touch.startY);
    if (dy > 48 || Math.abs(dx) < 70) return;
    if (touch.fromEdge && dx > 0) setDrawerOpen(true);
    if (touch.fromDrawer && dx < 0) setDrawerOpen(false);
  }

  function fileKind(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'PDF';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return '图片';
    return '未知类型';
  }

  function uploadFailureMessage(status: number, data: { message?: string; error?: string }) {
    const text = data.message || data.error || '';
    if (status === 401) return '登录过期，请重新登录';
    if (text.includes('超过')) return '文件过大';
    if (text.includes('支持') || text.includes('格式')) return '格式不支持';
    if (text.includes('对象存储')) return '对象存储异常';
    if (text.includes('工单')) return '未选择工单或工单不存在';
    if (text.includes('分类')) return '未选择分类或分类不存在';
    return text || '网络异常';
  }

  async function uploadJobToServer(job: UploadJob, retry = false): Promise<UploadResult> {
    if (!job.file) return { ok: false, message: '页面会话中未保留文件，请重新选择' };
    if (!job.workOrderId) return { ok: false, message: '未选择工单' };
    if (!job.categoryId) return { ok: false, message: '未选择分类' };
    if (!fileExtOk(job.file)) return { ok: false, message: '格式不支持' };

    setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'uploading', message: '上传中' } : j)));
    const fd = new FormData();
    fd.append('file', job.file);
    fd.append('workOrderId', job.workOrderId);
    fd.append('categoryId', job.categoryId);
    if (retry) fd.append('retry', 'true');
    try {
      const r = await fetch('/api/resource-files/upload', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = uploadFailureMessage(r.status, d);
        setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'failed', message } : j)));
        return { ok: false, message };
      }
      const drawingLibrarySync = d.drawingLibrarySync as DrawingLibraryUploadSync | undefined;
      const syncMessage = drawingLibrarySync?.linked
        ? ' · 已归档图纸资料库'
        : drawingLibrarySync?.error
          ? ` · ${drawingLibrarySync.error}`
          : '';
      const message = `${d.file?.version ? `上传成功 · ${d.file.version}` : '上传成功'}${syncMessage}`;
      setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'success', message } : j)));
      return { ok: true, fileId: d.file?.id || '', drawingLibrarySync };
    } catch {
      const message = '网络异常或对象存储异常';
      setUploadJobs(v => v.map(j => (j.id === job.id ? { ...j, status: 'failed', message } : j)));
      return { ok: false, message };
    }
  }

  async function uploadMany(fileList: File[], originalFiles?: File[]) {
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

    const sourceFiles = originalFiles || fileList;
    const hasLargeImage = sourceFiles.some(f => (f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name)) && f.size >= 1024 * 1024);
    if (!originalFiles && hasLargeImage) setMsg('图片较大，正在优化后上传，请稍候。');
    const optimizedFiles = originalFiles ? fileList : await Promise.all(fileList.map(f => compressImageForUpload(f)));

    const jobs = optimizedFiles.map((f, index) => ({
      id: `${Date.now()}-${index}`,
      name: f.name,
      fileType: fileKind(f),
      size: f.size,
      originalSize: sourceFiles[index]?.size !== f.size ? sourceFiles[index]?.size : undefined,
      file: f,
      workOrderId: order.id,
      categoryId: category.id,
      status: fileExtOk(f) ? 'waiting' as const : 'failed' as const,
      message: fileExtOk(f) ? '等待上传' : '文件格式不支持',
    }));
    setUploadJobs(jobs);
    setUploading(true);
    let ok = 0;
    let failed = jobs.filter(j => j.status === 'failed').length;
    let archived = 0;
    let archiveSkipped = 0;
    let latestUploadedFileId = '';
    const targetWorkOrderId = jobs[0]?.workOrderId || order.id;
    const targetCategoryId = jobs[0]?.categoryId || category.id;

    try {
      for (const job of jobs) {
        if (job.status === 'failed') continue;
        const result = await uploadJobToServer(job);
        if (result.ok) {
          ok += 1;
          latestUploadedFileId = result.fileId || latestUploadedFileId;
          if (result.drawingLibrarySync?.linked && !result.drawingLibrarySync.skipped) {
            archived += 1;
          } else if (result.drawingLibrarySync?.skipped || result.drawingLibrarySync?.error) {
            archiveSkipped += 1;
          }
        } else {
          failed += 1;
        }
      }

      if (latestUploadedFileId) {
        await loadFiles(targetWorkOrderId, targetCategoryId, latestUploadedFileId);
        await loadCategoryCounts(targetWorkOrderId);
      }
      setMsg(`批量上传完成：成功 ${ok} 个，失败 ${failed} 个；归档图纸资料库 ${archived} 个，跳过 ${archiveSkipped} 个`);
    } catch {
      setMsg(`批量上传完成：成功 ${ok} 个，失败 ${failed} 个；刷新列表失败，请手动刷新。`);
    } finally {
      setUploading(false);
      if (pdf.current) pdf.current.value = '';
      if (img.current) img.current.value = '';
    }
  }

  async function uploadCameraFiles(fileList: File[]) {
    setToolTab('queue');
    setToolOpen(true);
    if (!fileList.length) return;
    if (fileList.some(file => file.size >= 1024 * 1024)) setMsg('图片较大，正在优化后上传，请稍候。');
    const optimized = await Promise.all(fileList.map(file => normalizeCapturedImage(file)));
    await uploadMany(optimized, fileList);
  }

  async function retryUploadJob(job: UploadJob) {
    setUploading(true);
    const result = await uploadJobToServer(job, true);
    setUploading(false);
    if (result.ok) {
      await loadFiles(job.workOrderId, job.categoryId, result.fileId);
      await loadCategoryCounts(job.workOrderId);
    }
    setMsg(result.ok ? `已重试成功：${job.name}` : `重试失败：${result.message}`);
  }

  async function retryFailedUploads() {
    const failedJobs = uploadJobs.filter(job => job.status === 'failed');
    if (!failedJobs.length) return setMsg('没有失败的上传任务');
    setUploading(true);
    let ok = 0;
    let failed = 0;
    let latestUploadedFileId = '';
    const targetWorkOrderId = failedJobs[0]?.workOrderId || order?.id || '';
    const targetCategoryId = failedJobs[0]?.categoryId || category?.id || '';
    for (const job of failedJobs) {
      const result = await uploadJobToServer(job, true);
      if (result.ok) {
        ok += 1;
        latestUploadedFileId = result.fileId || latestUploadedFileId;
      } else {
        failed += 1;
      }
    }
    setUploading(false);
    if (latestUploadedFileId && targetWorkOrderId && targetCategoryId) {
      await loadFiles(targetWorkOrderId, targetCategoryId, latestUploadedFileId);
      await loadCategoryCounts(targetWorkOrderId);
    }
    setMsg(`重试完成：成功 ${ok} 个，失败 ${failed} 个`);
  }

  async function syncCurrentWorkOrder() {
    if (!order) {
      setMsg('请先选择工单');
      return;
    }
    const targetOrderId = order.id;
    const targetCategoryId = category?.id || cat;
    const targetFileId = file?.id || sel;
    setSyncing(true);
    try {
      const nextOrders = await refreshOrders(targetOrderId, true);
      if (!nextOrders.some(item => item.id === targetOrderId)) {
        setMsg('当前工单不存在或已删除');
        return;
      }
      if (targetCategoryId) setCat(targetCategoryId);
      const nextFiles = await loadFiles(targetOrderId, targetCategoryId, targetFileId, true);
      await loadCategoryCounts(targetOrderId, true);
      setWo(targetOrderId);
      setSel(targetFileId && nextFiles.some(item => item.id === targetFileId) ? targetFileId : nextFiles[0]?.id || '');
      setMsg('已同步当前工单资料');
    } catch {
      setMsg('同步失败，请检查网络后重试');
    } finally {
      setSyncing(false);
    }
  }

  async function restoreManualTrash(type: 'manual' | 'version' | 'asset', id: string) {
    const url = type === 'manual' ? `/api/connector-assembly-manuals/${id}/restore`
      : type === 'version' ? `/api/connector-assembly-manual-versions/${id}/restore`
        : `/api/connector-assembly-manual-assets/${id}/restore`;
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || '恢复说明书资料失败');
      return;
    }
    await loadTrash();
    setMsg('说明书资料已恢复');
  }

  async function syncCurrentWorkOrderToDrawingLibrary() {
    if (!order) {
      setMsg('请先选择工单');
      return;
    }
    setDrawingSyncing(true);
    try {
      const r = await fetch(`/api/work-orders/${order.id}/sync-drawing-library`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        setMsg(d.error || '同步到图纸资料库失败');
        return;
      }
      await refreshOrders(order.id, true);
      await loadCategoryCounts(order.id, true);
      setMsg(`已同步到图纸资料库：新增 ${d.syncedCount || 0} 个，跳过 ${d.skippedCount || 0} 个`);
    } catch {
      setMsg('同步到图纸资料库失败，请检查网络后重试');
    } finally {
      setDrawingSyncing(false);
    }
  }

  async function refresh() {
    await syncCurrentWorkOrder();
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
    const fileName = displayFileName(deleteTarget);
    const suffix = fileName.slice(-4);
    const expected = `DELETE ${suffix}`;
    const typed = deleteConfirmText.trim().replace(/\s+/g, ' ');
    if (typed !== expected) {
      setMsg(`请输入 ${expected} 后再删除`);
      return;
    }
    const deletedCategoryId = deleteTarget.categoryId;
    setDeleting(true);
    try {
      const r = await fetch(`/api/resource-files/${deleteTarget.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText: expected }),
      });
      if (!r.ok) {
        setMsg('删除失败，请稍后重试');
        return;
      }
      setMsg('文件已软删除，可在回收站恢复');
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
    const expected = `${orderDeleteTarget.code} CONFIRM`;
    if (orderDeleteConfirmText.trim().replace(/\s+/g, ' ') !== expected) {
      setMsg(`请输入 ${expected} 后再删除`);
      return;
    }
    setDeleting(true);
    try {
      const r = await fetch(`/api/work-orders/${orderDeleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText: expected }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.message || '删除工单失败');
        return;
      }
      setOrders(v => v.filter(o => o.id !== orderDeleteTarget.id));
      setOrderDeleteTarget(null);
      setMsg('工单已软删除，可在回收站恢复');
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
      a.download = `${workOrderDisplayCode(order)}-资料包.zip`;
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

  async function loadChangeSnapshots() {
    setSnapshotsOpen(true);
    setSnapshotsLoading(true);
    try {
      const r = await fetch('/api/change-snapshots?limit=100', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || d.message || '变更记录加载失败');
        return;
      }
      setSnapshots(Array.isArray(d.snapshots) ? d.snapshots : []);
    } catch {
      setMsg('变更记录加载失败');
    } finally {
      setSnapshotsLoading(false);
    }
  }

  async function openSystemSettings() {
    setUserMenu(false);
    setSystemOpen(true);
    await loadSystemStatus();
  }

  async function openNextWeekImport() {
    const base = drawerWeekStart || order?.weekStartDate || '';
    setImportMode('weekly_plan');
    setImportTarget('draft_next');
    setImportWeekStart(base ? addDaysYmd(base, 7) : nextMondayYmd());
    setImportPreview(null);
    setImportResult(null);
    setImportError('');
    setDrawerOpen(false);
    await openSystemSettings();
  }

  function currentWeekStartValue() {
    return drawerWeekStart ? ymdLocal(drawerWeekStart) : order?.weekStartDate ? ymdLocal(order.weekStartDate) : '';
  }

  function nextWeekStartValue() {
    const base = drawerWeekStart || order?.weekStartDate || importWeekStart;
    return base ? addDaysYmd(base, 7) : nextMondayYmd();
  }

  function openWeekAction(kind: Exclude<WeekAction, null>) {
    const date = kind === 'close' ? currentWeekStartValue() : nextWeekStartValue();
    setWeekAction(kind);
    setWeekActionDate(date);
    setWeekActionSummary(null);
    setWeekActionConfirmText('');
    setWeekActionError('');
  }

  async function previewWeekAction(kind = weekAction, dateValue = weekActionDate) {
    if (!kind) return;
    if (!dateValue) {
      setWeekActionError(kind === 'close' ? '请选择当前周开始日期' : '请选择下周开始日期');
      return;
    }
    setWeekActionLoading(true);
    setWeekActionError('');
    setWeekActionSummary(null);
    try {
      const path = kind === 'close' ? '/api/work-orders/week/close/preview' : '/api/work-orders/week/activate-next/preview';
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate: dateValue }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setWeekActionError(d.error || d.message || '预览失败');
        return;
      }
      setWeekActionSummary(d.summary || null);
      setWeekActionConfirmText('');
    } catch {
      setWeekActionError('预览失败，请检查网络后重试');
    } finally {
      setWeekActionLoading(false);
    }
  }

  async function commitWeekAction() {
    if (!weekAction) return;
    const confirmText = weekActionConfirmText.trim();
    const required = weekAction === 'close' ? 'CLOSE_WEEK' : 'START_NEXT_WEEK';
    if (confirmText !== required) {
      setWeekActionError(`请输入 ${required} 确认操作`);
      return;
    }
    setWeekActionLoading(true);
    setWeekActionError('');
    try {
      const path = weekAction === 'close' ? '/api/work-orders/week/close/commit' : '/api/work-orders/week/activate-next/commit';
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate: weekActionDate, confirmText }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setWeekActionError(d.error || d.message || '操作失败');
        return;
      }
      setWeekActionSummary(d.summary || null);
      setWeekActionConfirmText('');
      setWeekAction(null);
      setPlanView('current');
      await refreshOrders(undefined, true);
      await loadFieldSummary();
      setMsg(weekAction === 'close'
        ? `已归档 ${d.summary?.clearedCount ?? 0} 张当前周工单，资料未删除`
        : `已启用 ${d.summary?.activatedCount ?? 0} 张下周工单`);
    } catch {
      setWeekActionError('操作失败，请检查网络后重试');
    } finally {
      setWeekActionLoading(false);
    }
  }

  function downloadName(headers: Headers, fallback: string) {
    const value = headers.get('Content-Disposition') || '';
    const m = value.match(/filename\*=UTF-8''([^;]+)/);
    return m ? safeDecodeFilename(m[1]) : fallback;
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

  async function previewWorkOrderImport(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportPreview(null);
    setImportResult(null);
    const inferred = inferWeekStartFromFilename(file.name);
    const weekStart = importMode === 'weekly_plan' ? (importWeekStart || inferred) : '';
    if (inferred && importMode === 'weekly_plan' && !importWeekStart) setImportWeekStart(inferred);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', importMode);
    if (weekStart) fd.append('weekStartDate', weekStart);
    try {
      const r = await fetch('/api/import/work-orders/preview', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const error = d.error || d.message || '导入预览失败';
        setImportError(error);
        setMsg(error);
        return;
      }
      setImportPreview(d);
      setMsg(`预览完成：可导入 ${d.summary?.readyCount || 0}，重复 ${d.summary?.duplicateCount || 0}，跳过 ${d.summary?.skippedCount || 0}`);
    } catch {
      setImportError('Excel / CSV 文件读取失败，请重新选择文件');
      setMsg('导入预览失败，请检查文件格式');
    } finally {
      setImporting(false);
      if (csvImport.current) csvImport.current.value = '';
    }
  }

  async function commitWorkOrderImport() {
    if (!importPreview) {
      setImportError('请先上传文件并完成预览');
      return;
    }
    setImporting(true);
    setImportError('');
    try {
      const r = await fetch('/api/import/work-orders/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: importPreview.rows,
          duplicateStrategy,
          mode: importPreview.mode,
          weeklyPlanTarget: importPreview.mode === 'weekly_plan' ? 'draft_next' : undefined,
          sourceFileName: importPreview.sourceFileName,
          sourceSheetName: importPreview.sourceSheetName,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const error = d.error || d.message || '确认导入失败';
        setImportError(error);
        setMsg(error);
        return;
      }
      setImportResult(d);
      setImportPreview(null);
      if (importPreview.mode === 'weekly_plan') setPlanView('draft_next');
      await refreshOrders(order?.id);
      if (importPreview.mode === 'weekly_plan') {
        setMsg(`下周草稿已生成，请先检查差异和异常，再启用下周。新增 ${d.summary?.created || 0}，跳过 ${d.summary?.skipped || 0}，失败 ${d.summary?.failed || 0}`);
        const params = new URLSearchParams({ imported: '1' });
        if (d.importBatchId) params.set('nextBatchId', d.importBatchId);
        location.href = `/weekly-plan-center?${params.toString()}`;
      } else {
        setMsg(`导入完成：新增 ${d.summary?.created || 0}，跳过 ${d.summary?.skipped || 0}，失败 ${d.summary?.failed || 0}`);
      }
    } catch {
      setImportError('确认导入失败，请检查网络后重试');
      setMsg('确认导入失败');
    } finally {
      setImporting(false);
    }
  }

  async function previewClearWeeklyPlan() {
    setClearError('');
    setClearPreview(null);
    const targetWeekStart = clearWeekStart || importWeekStart;
    if (!targetWeekStart) {
      setClearError('请选择计划周开始日期');
      return;
    }
    setClearingWeeklyPlan(true);
    try {
      const r = await fetch('/api/work-orders/week/close/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate: targetWeekStart }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setClearError(d.error || d.message || '归档预览失败');
        return;
      }
      setClearPreview(d.summary || null);
      setClearConfirmText('');
    } catch {
      setClearError('归档预览失败，请检查网络后重试');
    } finally {
      setClearingWeeklyPlan(false);
    }
  }

  async function commitClearWeeklyPlan() {
    setClearError('');
    const targetWeekStart = clearWeekStart || importWeekStart;
    if (!targetWeekStart) {
      setClearError('请选择计划周开始日期');
      return;
    }
    if (clearConfirmText.trim() !== 'CLOSE_WEEK') {
      setClearError('请输入 CLOSE_WEEK 确认归档当前周生产工单');
      return;
    }
    setClearingWeeklyPlan(true);
    try {
      const r = await fetch('/api/work-orders/week/close/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate: targetWeekStart, confirmText: clearConfirmText.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setClearError(d.error || d.message || '归档当前周工单失败');
        return;
      }
      setClearPreview(d.summary || null);
      setClearConfirmText('');
      await refreshOrders(undefined, true);
      await loadFieldSummary();
      setMsg(`已归档 ${d.summary?.clearedCount ?? 0} 张当前周生产工单，资料文件未删除`);
    } catch {
      setClearError('归档当前周工单失败，请检查网络后重试');
    } finally {
      setClearingWeeklyPlan(false);
    }
  }

  async function installApp() {
    if (!installPrompt) {
      setMsg('请在平板浏览器右上角菜单中选择“添加到桌面 / 安装应用”，再从桌面图标打开');
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
    const params = new URLSearchParams({
      workOrderId: target.id,
      workOrderCode: target.code,
      customerName: target.customerName || '',
    });
    return `${location.origin}/dashboard?${params.toString()}`;
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
      await writeClipboardText(u);
      setMsg('当前工单链接已复制');
    } catch {
      setMsg(u);
    }
    await writeClientLog('copy_work_order_link', 'work_order', order.id, { code: order.code });
  }

  async function copySpecification() {
    if (!order) {
      setMsg('暂无可复制内容');
      return;
    }
    const specification = order.specification?.trim();
    const text = specification || order.code?.trim() || '';
    if (!text) {
      setMsg('暂无可复制内容');
      return;
    }
    try {
      await writeClipboardText(text);
      setMsg(specification ? '已复制规格' : '规格未设置，已复制内部编号');
      await writeClientLog('copy_work_order_spec', 'work_order', order.id, { code: order.code, hasSpecification: !!specification });
    } catch {
      setMsg('复制失败，请手动选择规格复制');
    }
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
    <main className="tablet-shell" onTouchStart={onShellTouchStart} onTouchEnd={onShellTouchEnd}>
      <header className="topbar">
        <button className="home-button" type="button" aria-label="生产执行首页" onClick={() => { location.href = '/production'; }}>⌂</button>
        <div className="brand-block">
          <strong>工单资料库</strong>
          <span>鸿蒙平板生产资料管理系统</span>
        </div>
        <div className="top-search">
          <input value={globalKw} onFocus={() => globalKw.trim() && setSearchOpen(true)} onChange={e => setGlobalKw(e.target.value)} placeholder="全局搜索工单 / 文件" />
          <VoiceInputButton value={globalKw} onChange={setGlobalKw} mode="replace" onApplied={() => setSearchOpen(true)} label="搜索语音输入" />
          <b>⌕</b>
          {searchOpen && globalKw.trim() && (
            <div className="global-search-panel">
              {globalSearch.workOrders.length > 0 && <>
                <div className="search-group-title">生产工单</div>
                {globalSearch.workOrders.map(item => (
                  <button key={item.id} type="button" onClick={() => openWorkOrder(item.id)}>
                    <strong>{workOrderDisplayCode(item)}</strong>
                    <span>{customerLabel(item)} · {item.productName || '未设置品名'}</span>
                  </button>
                ))}
              </>}
              {globalSearch.resourceFiles.length > 0 && <>
                <div className="search-group-title">生产文件</div>
                {globalSearch.resourceFiles.map(item => (
                  <button key={item.id} type="button" onClick={() => openFileResult(item)}>
                    <strong>{displayFileName(item)}</strong>
                    <span>{item.workOrderCode || '-'} · {item.categoryName || '-'} · {item.version || 'V1.0'}</span>
                  </button>
                ))}
              </>}
              {globalSearch.drawingLibraryItems.length > 0 && <>
                <div className="search-group-title">图纸资料</div>
                {globalSearch.drawingLibraryItems.map(item => (
                  <button key={item.id} type="button" onClick={() => openDrawingLibraryItemResult(item.id)}>
                    <strong>{item.specification}</strong>
                    <span>{item.customerName} · {item.productName || '未设置品名'} · {item.completenessText}</span>
                  </button>
                ))}
              </>}
              {globalSearch.drawingLibraryFiles.length > 0 && <>
                <div className="search-group-title">图纸文件</div>
                {globalSearch.drawingLibraryFiles.map(item => (
                  <button key={item.id} type="button" onClick={() => openDrawingLibraryFileResult(item)}>
                    <strong>{drawingSearchFileName(item)}</strong>
                    <span>{item.item.specification} · {item.item.customerName} · {item.categoryName || '未分类'}</span>
                  </button>
                ))}
              </>}
              {globalSearch.connectorParameters.length > 0 && <>
                <div className="search-group-title">连接器参数</div>
                {globalSearch.connectorParameters.map(item => (
                  <button key={item.id} type="button" onClick={openConnectorParameterResult}>
                    <strong>{item.model || '未设置型号'}</strong>
                    <span>外剥 {item.outerPeelMm || '-'} · 内剥 {item.innerPeelMm || '-'} · 入长 {item.insertionLengthMm || '-'}</span>
                  </button>
                ))}
              </>}
              {globalSearch.connectorAssemblyManuals.length > 0 && <>
                <div className="search-group-title">连接器组装说明书</div>
                {globalSearch.connectorAssemblyManuals.map(item => (
                  <button key={item.id} type="button" onClick={() => openConnectorAssemblyManualResult(item.id, item.latestVersion?.id)}>
                    <strong>{item.title}</strong>
                    <span>{item.models.join(' / ') || '未关联型号'} · {item.manufacturer || '未设置制造商'} · {item.latestVersion?.revision || '暂无版本'}</span>
                  </button>
                ))}
              </>}
              {globalSearch.connectorAssemblyManualAssets.length > 0 && <>
                <div className="search-group-title">说明书文件</div>
                {globalSearch.connectorAssemblyManualAssets.map(item => (
                  <button key={item.id} type="button" onClick={() => openConnectorAssemblyManualResult(item.manualId, item.versionId, item.pageNo)}>
                    <strong>{safeDecodeFilename(item.displayName || item.originalName)}</strong>
                    <span>{item.manualTitle} · {item.revision} · {item.models.join(' / ') || '未关联型号'}</span>
                  </button>
                ))}
              </>}
              {!hasSearchResults(globalSearch) && <div className="search-empty">未找到匹配结果，请调整关键词</div>}
            </div>
          )}
        </div>
        <div className="top-actions">
          {productionReturnKey && <button className="return-production-button" type="button" onClick={returnToProduction}>← 返回生产执行</button>}
          <button className="notice-button" type="button" aria-label="通知">◇<span /></button>
          <button className="language-button" type="button">CN</button>
          <button className="log-button" type="button" onClick={() => loadLogs('all')}>操作日志</button>
          <div className="library-wrap">
            <button ref={libraryMenuButtonRef} className="library-button" type="button" onClick={() => setLib(!lib)}>▱ 资料库</button>
            <PortalMenu open={lib} anchorRef={libraryMenuButtonRef} className="library-menu" width={220} onClose={() => setLib(false)}>
                <button type="button" onClick={() => { location.href = '/production'; }}>生产执行中心</button>
                <button type="button" onClick={() => { location.href = '/drawing-library'; }}>图纸资料库</button>
                <button type="button" onClick={() => { location.href = '/connector-parameters'; }}>连接器参数资料</button>
                <button type="button" onClick={() => { location.href = '/connector-assembly-manuals'; }}>连接器组装说明书</button>
                <button className="active" type="button">▤ 生产工单 ✓</button>
            </PortalMenu>
          </div>
          <div className="user-wrap">
            <button ref={userMenuButtonRef} className="user-button" type="button" onClick={() => setUserMenu(!userMenu)}>
              <span>♙</span>
              <b title={accountName}>{accountName}</b>
              <em>⌄</em>
            </button>
            <PortalMenu open={userMenu} anchorRef={userMenuButtonRef} className="user-menu app-user-menu" width={176} onClose={() => setUserMenu(false)}>
                <button type="button" onClick={openSystemSettings}>系统设置</button>
                <button type="button" onClick={openAccounts}>账号管理</button>
                <button type="button" onClick={openTrash}>回收站</button>
                <button type="button" onClick={() => { setUserMenu(false); setHelpOpen(true); }}>使用帮助</button>
                <button type="button" onClick={openPasswordDialog}>修改密码</button>
                <button type="button" onClick={logout}>退出登录</button>
            </PortalMenu>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className={drawerOpen ? 'orders-panel orders-drawer open' : 'orders-panel orders-drawer'} aria-hidden={!drawerOpen}>
          <div className="panel-head">
            <div>
              <span>生产工单</span>
              <strong>{drawerWeekLabel} · {list.length} 单</strong>
            </div>
            <div className="panel-head-actions">
              <button className="import-order-button" type="button" onClick={openNextWeekImport}>导入下周</button>
              <button className="archive-week-button" type="button" disabled={!currentWeekStartValue()} onClick={() => openWeekAction('close')}>结束本周</button>
              <button className="activate-week-button" type="button" onClick={() => openWeekAction('activate_next')}>启用下周</button>
              <button className="new-order-button" type="button" onClick={() => openOrderModal('create')}>新建工单</button>
              <button className="drawer-close" type="button" aria-label="关闭工单抽屉" onClick={() => setDrawerOpen(false)}>×</button>
            </div>
          </div>
          <div className="plan-view-tabs" aria-label="周计划视图">
            {([
              ['current', '当前周'],
              ['draft_next', '下周草稿'],
              ['history', '历史周'],
            ] as const).map(([key, label]) => (
              <button key={key} className={planView === key ? 'active' : ''} type="button" onClick={() => setPlanView(key)}>{label}</button>
            ))}
            <button type="button" onClick={() => { location.href = '/weekly-plan-center'; }}>差异审核</button>
          </div>
          <div className="panel-search">
            <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索规格 / 客户 / 品名 / SO单号 / 内部编号" />
          </div>
          <div className="filter-tabs weekly-filter-tabs">
            {[
              ['all', '全部'],
              ['today', '今日交期'],
              ['missing', '缺资料'],
              ['anomaly', '异常'],
            ].map(([key, label]) => (
              <button key={key} className={orderFilter === key ? 'active' : ''} type="button" onClick={() => setOrderFilter(key as OrderQuickFilter)}>{label}</button>
            ))}
            <label className="stage-filter-select">
              <span>状态</span>
              <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
                <option value="all">全部状态</option>
                {flowStages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className="order-stats compact">
            <span>今日交期 {visibleToday.length}</span>
            <span>当前列表 {visibleWeek.length}</span>
            {fieldSummary && (
              <>
                <span>缺资料 {fieldSummary.counts.missingWorkOrders}</span>
                <span>完整 {fieldSummary.counts.completeWorkOrders}</span>
              </>
            )}
          </div>
          {fieldSummary && (
            <section className="field-summary">
              <button className="field-summary-toggle" type="button" onClick={() => setSummaryOpen(v => !v)}>现场概览</button>
              {summaryOpen && (
                <div className="field-summary-list">
                  {fieldSummary.missingWorkOrders.map(item => (
                    <button key={item.id} type="button" onClick={() => openWorkOrder(item.id)}>
                      <strong>{workOrderDisplayCode(item)}</strong><span>{customerLabel(item)} · {item.productName}</span>
                    </button>
                  ))}
                  {fieldSummary.recentFiles.map(item => (
                    <button key={item.id} type="button" onClick={() => openFileResult(item)}>
                      <strong>{displayFileName(item)}</strong><span>{item.workOrderCode || '-'} · {item.categoryName || '-'}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          <OrderGroup title={planView === 'draft_next' ? '下周草稿' : planView === 'history' ? '历史周工单' : '当前周工单'} orders={list} selected={order?.id} choose={id => openWorkOrder(id)} categories={categories} openQuickMenu={openQuickMenu} readOnly={planView === 'history'} diffTypes={planView === 'draft_next' ? draftDiffTypes : {}} />
          {!list.length && <div className="empty-orders large">未找到匹配工单</div>}
        </aside>
        {drawerOpen && <button className="drawer-mask" type="button" aria-label="关闭工单抽屉" onClick={() => setDrawerOpen(false)} />}

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
                <b className="category-name">{categoryNameLines(c).map(line => <span key={line}>{line}</span>)}</b>
                <i className={count ? 'state-dot ok' : required ? 'state-dot warn' : 'state-dot'} />
                <em>{count}</em>
              </button>
            );
          })}
          <button className={managerOpen ? 'upload-manage active' : 'upload-manage'} type="button" disabled={!order} onClick={openUploadManager}>
            <span className="category-mark">↑</span>
            <b className="category-name"><span>上传</span><span>管理</span></b>
          </button>
        </nav>

        <section className="main-card">
          <div className="current-order-strip">
            <div className="order-strip-info">
              <span className="order-strip-chip customer" title={customerLabel(order)}>客户：{customerLabel(order)}</span>
              <span className="order-strip-chip spec simplified" title={order?.specification || order?.code || '未设置'}>规格：{order?.specification?.trim() || '未设置'}</span>
              <button className="copy-spec-button" type="button" disabled={!order?.specification && !order?.code} onClick={copySpecification} title="复制规格">复制规格</button>
            </div>
            <div className="order-strip-actions">
              <button className="switch-order-button" type="button" onClick={() => setDrawerOpen(true)}>切换工单</button>
              <div className="more-actions-wrap">
                <button ref={moreActionsButtonRef} className="strip-more-button" type="button" disabled={!order} onClick={() => setMoreActionsOpen(v => !v)}>更多</button>
                <PortalMenu open={moreActionsOpen} anchorRef={moreActionsButtonRef} className="more-actions-menu" width={190} onClose={() => setMoreActionsOpen(false)}>
                    <button type="button" disabled={orderReadOnly} onClick={() => { setMoreActionsOpen(false); order && openOrderModal('edit', order); }}>编辑工单</button>
                    {order?.drawingLibraryItemId && <button type="button" onClick={() => { location.href = `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId || '')}`; }}>查看图纸资料库</button>}
                    <button type="button" disabled={orderReadOnly} onClick={() => { setMoreActionsOpen(false); order && setOrderDeleteTarget(order); }}>删除工单</button>
                    <button type="button" onClick={() => { setMoreActionsOpen(false); copy(); }}>复制链接</button>
                    <button type="button" disabled={orderReadOnly} onClick={() => { setMoreActionsOpen(false); syncCurrentWorkOrder(); }}>同步当前工单资料</button>
                    <button type="button" disabled={drawingSyncing || orderReadOnly} onClick={() => { setMoreActionsOpen(false); syncCurrentWorkOrderToDrawingLibrary(); }}>{drawingSyncing ? '同步图纸库中...' : '同步到图纸资料库'}</button>
                    <button type="button" onClick={() => { setMoreActionsOpen(false); openQrDialog(); }}>打印二维码</button>
                    <button type="button" onClick={() => { setMoreActionsOpen(false); printSummary(); }}>打印摘要</button>
                    <button type="button" onClick={() => { setMoreActionsOpen(false); refresh(); }}>刷新</button>
                </PortalMenu>
              </div>
            </div>
          </div>

          {managerOpen ? (
            <UploadManager
              files={managerFiles}
              categories={categories}
              managerCategory={managerCategory}
              setManagerCategory={setManagerCategory}
              currentCategoryName={category?.name || '-'}
              uploading={uploading}
              chooseImage={() => img.current?.click()}
              openCamera={openCameraCapture}
              selectFile={selectManagedFile}
              openFileEdit={openFileEdit}
              setDeleteTarget={setDeleteTarget}
            />
          ) : (
            <div className={toolOpen ? 'content-grid tool-open' : 'content-grid'}>
              <section className="preview-card">
                {file && (
                  <button className="preview-file-capsule" type="button" onClick={() => openTool('info')} title={displayFileName(file)}>
                    <span className={file.fileType === 'pdf' ? 'file-type mini pdf' : 'file-type mini img'}>{fileTypeText[file.fileType] || file.fileType.toUpperCase()}</span>
                    <strong>{displayFileName(file)}</strong>
                    <em>{file.version || 'V1.0'}</em>
                    <i>{fileStatusText[file.status] || file.status}</i>
                  </button>
                )}

                <div className="preview-stage">
                  {loading ? (
                    <div className="preview-loading">
                      <span />
                      <strong>资料加载中</strong>
                      <p>正在读取当前分类文件</p>
                    </div>
                  ) : file ? (
                    file.fileType === 'pdf'
                      ? <PdfViewer fileId={file.id} title={displayFileName(file)} contentUrl={file.contentUrl} downloadUrl={file.downloadUrl} viewUrl={file.viewUrl} />
                      : <ImageViewer fileId={file.id} title={displayFileName(file)} contentUrl={file.contentUrl} downloadUrl={file.downloadUrl} />
                  ) : (
                    <div className="empty-preview empty-resource-guide">
                      <div className="empty-illustration">＋</div>
                      <div className="empty-guide-copy">
                        <strong>当前分类暂无文件</strong>
                        <p>上传后所有登录账号都可共享查看，文件将保存到对象存储。</p>
                      </div>
                      <div className="empty-guide-grid">
                        <span><b>当前分类</b><em>{currentCategoryName}</em></span>
                        <span><b>支持格式</b><em>PDF、JPG、PNG、WEBP</em></span>
                        <span><b>建议</b><em>原图、SOP指导书、成品图为主要生产资料</em></span>
                      </div>
                      {missingCategoryNames.length > 0 && (
                        <div className="empty-missing">
                          <b>当前工单缺失：</b>
                          <span>{missingCategoryNames.join('、')}</span>
                        </div>
                      )}
                      {relatedHistory && relatedHistory.fileCount > 0 && (
                        <div className="empty-missing related-history">
                          <b>发现同规格历史资料</b>
                          <span>{relatedHistory.workOrderCount} 张历史工单，{relatedHistory.fileCount} 个文件，可查看后手动引用。</span>
                        </div>
                      )}
                      <div className="empty-actions empty-guide-actions">
                        <button type="button" disabled={uploading || !order} onClick={() => pdf.current?.click()}>上传 PDF</button>
                        <button type="button" disabled={uploading || !order} onClick={() => img.current?.click()}>上传图片</button>
                        <button type="button" disabled={uploading || !order} onClick={openCameraCapture}>拍照上传</button>
                        <button type="button" disabled={uploading || !order || orderReadOnly} onClick={() => void openLocalImport()}>从微盘导入</button>
                      </div>
                    </div>
                  )}
                </div>

                {files.length > 0 && (
                  <div className={thumbsOpen ? 'file-strip floating open' : 'file-strip floating collapsed'} aria-label="当前分类文件列表">
                    <button className="strip-toggle" type="button" onClick={() => setThumbsOpen(v => !v)}>
                      {thumbsOpen ? '收起缩略图' : `文件 ${files.length} 个 ︿`}
                    </button>
                    {thumbsOpen && (
                      <div className="strip-scroll">
                        {files.map(f => (
                          <button key={f.id} className={f.id === file?.id ? 'strip-file thumb active' : 'strip-file thumb'} type="button" onClick={() => setSel(f.id)}>
                            <FileThumb file={f} />
                            <b>{shortName(displayFileName(f))}</b>
                            <small>{f.version || 'V1.0'} · {dt(f.createdAt, false)}</small>
                            <em className={f.id === latestFileId ? 'version-badge latest' : 'version-badge'}>{f.id === latestFileId ? '最新' : '历史'}</em>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <aside
                ref={toolRef}
                className={toolOpen ? 'resource-tools open' : 'resource-tools'}
                style={{ '--tool-width': `${toolWidth}px` } as React.CSSProperties}
              >
                <input ref={pdf} hidden multiple type="file" accept="application/pdf,.pdf" onChange={e => uploadMany(Array.from(e.target.files || []))} />
                <input ref={img} hidden multiple type="file" accept="image/*" onChange={e => uploadMany(Array.from(e.target.files || []))} />
                <div ref={toolRailRef} className="resource-tool-rail" aria-label="资料工具栏">
                  {([
                    ['info', '信息'],
                    ['upload', '上传'],
                    ['actions', '操作'],
                    ['queue', '队列'],
                  ] as const).map(([key, label]) => (
                    <button key={key} className={(toolOpen ? toolTab === key : currentCategoryIsEmpty && key === 'upload') ? 'active' : ''} type="button" onClick={() => openTool(key)}>{label}</button>
                  ))}
                </div>
                <section className="resource-tool-window" aria-hidden={!toolOpen}>
                  <button className="tool-resize-handle" type="button" aria-label="调整工具窗宽度" onPointerDown={startToolResize} />
                  <div className="tool-window-head">
                    <strong>{toolTab === 'info' ? '文件信息' : toolTab === 'upload' ? '上传资料' : toolTab === 'actions' ? '文件操作' : '上传队列'}</strong>
                    <button type="button" onClick={() => setToolOpen(false)}>×</button>
                  </div>
                  {toolTab === 'info' && (
                    <div className="tool-pane">
                      <Info label="当前分类" value={currentCategoryName} />
                      {orderReadOnly && <Info label="周计划状态" value="历史周只读" />}
                      {order && (
                        <>
                          <Info label="客户" value={customerLabel(order)} />
                          <Info label="规格" value={order.specification || '-'} />
                          <Info label="品名" value={order.productName || '-'} wrap />
                          <Info label="内部编号" value={order.code || '-'} />
                          <Info label="状态" value={flowText(order.stage)} />
                          <Info label="优先级" value={priorityText[order.priority] || order.priority || '-'} />
                          <Info label="未交量" value={order.uncompletedQty || '-'} />
                          <Info label="交期" value={orderDeliveryLabel(order)} />
                          <Info label="计划时间" value={order.plannedAt ? dt(order.plannedAt) : '-'} />
                          <Info label="图纸状态" value={order.drawingStatus || '-'} />
                          <Info label="配料状态" value={order.materialStatus || '-'} />
                          <Info label="订单日期" value={order.orderDate ? dt(order.orderDate, false) : '-'} />
                          <Info label="业务员" value={order.salesperson || '-'} />
                          <Info label="客户等级" value={order.customerLevel || '-'} />
                          <Info label="工序" value={order.processName || '-'} />
                          <Info label="工时" value={order.unitWorkHours || '-'} />
                          <Info label="总工时" value={order.totalWorkHours || '-'} />
                          <Info label="图纸下发" value={order.drawingIssuedAt ? dt(order.drawingIssuedAt, false) : order.drawingIssueNote || '-'} wrap />
                          <Info label="来源订单" value={order.sourceOrderNo || '-'} />
                          <Info label="来源行号" value={order.sourceRowNo ? String(order.sourceRowNo) : '-'} />
                          <Info label="导入批次" value={order.importBatchId || '-'} wrap />
                        </>
                      )}
                      <Info label="文件状态" value={file ? fileStatusText[file.status] || file.status : '暂无文件'} ok={!!file} />
                      {!file && <Info label="支持格式" value="PDF、JPG、PNG、WEBP" />}
                      {file && (
                        <>
                          <Info label="文件类型" value={fileTypeText[file.fileType] || file.fileType.toUpperCase()} />
                          <Info label="版本" value={file.version || 'V1.0'} />
                          <Info label="大小" value={bytes(file.fileSize)} />
                          <Info label="上传时间" value={dt(file.createdAt)} />
                          <Info label="上传人" value={file.uploadedBy || accountName} />
                          <Info label="备注" value={file.remark || '-'} wrap />
                        </>
                      )}
                    </div>
                  )}
                  {toolTab === 'upload' && (
                    <div className="tool-pane">
                      <div className="side-section-title">
                        <strong>{category?.name || '-'}</strong>
                        <span>支持 PDF / JPG / PNG / WEBP 批量上传</span>
                      </div>
                      <button className="upload-action primary" type="button" disabled={uploading || !order || orderReadOnly} onClick={() => pdf.current?.click()}>
                        <span>⇧</span><b>{uploading ? '上传中，请稍候' : '上传 PDF'}</b>
                      </button>
                      <button className="upload-action" type="button" disabled={uploading || !order || orderReadOnly} onClick={() => img.current?.click()}>
                        <span>▣</span><b>上传图片</b>
                      </button>
                      <button className="upload-action" type="button" disabled={uploading || !order || orderReadOnly} onClick={openCameraCapture}>
                        <span>◎</span><b>拍照上传</b>
                      </button>
                      <button className="upload-action local-import-action" type="button" disabled={uploading || !order || orderReadOnly} onClick={() => void openLocalImport()}>
                        <span>↧</span><b>从微盘导入</b>
                      </button>
                      <p className="tool-note local-import-note">无需手动寻找本地文件。可从企业微信微盘拖入、粘贴，或点击下载后由 Windows 助手自动接收。</p>
                      <button className="upload-action sync-inline" type="button" disabled={syncing || !order || orderReadOnly} onClick={syncCurrentWorkOrder}>
                        <span>↻</span><b>{syncing ? '同步中' : '同步当前工单资料'}</b>
                      </button>
                      <button className="upload-action sync-inline" type="button" disabled={drawingSyncing || !order || orderReadOnly} onClick={syncCurrentWorkOrderToDrawingLibrary}>
                        <span>⇄</span><b>{drawingSyncing ? '归档中' : '同步到图纸资料库'}</b>
                      </button>
                      <p className="tool-note">上传文件会保存到对象存储，元数据保存到 PostgreSQL。队列完成后会自动刷新当前分类。</p>
                    </div>
                  )}
                  {toolTab === 'actions' && (
                    <div className="tool-pane">
                      <div className="secondary-actions file-actions">
                        <a className={!file ? 'disabled' : ''} href={file?.downloadUrl || '#'} target="_blank">下载当前</a>
                        <button type="button" disabled={!file || orderReadOnly} onClick={() => file && openFileEdit(file)}>编辑文件</button>
                        <button type="button" disabled={!file || orderReadOnly} onClick={() => file && setDeleteTarget(file)}>删除文件</button>
                        <button type="button" disabled={!canDownloadAll || downloadingAll} onClick={downloadAll}>{downloadingAll ? '打包中...' : '下载全部'}</button>
                        <button type="button" disabled={syncing || !order || orderReadOnly} onClick={syncCurrentWorkOrder}>{syncing ? '同步中...' : '同步资料'}</button>
                        <button type="button" disabled={drawingSyncing || !order || orderReadOnly} onClick={syncCurrentWorkOrderToDrawingLibrary}>{drawingSyncing ? '归档中...' : '同步到图纸资料库'}</button>
                        <button type="button" disabled={!order} onClick={copy}>复制链接</button>
                      </div>
                      {currentCategoryIsEmpty && <p className="tool-note">当前分类暂无文件，请先上传 PDF、图片或拍照上传。</p>}
                      {!canDownloadAll && <p className="tool-note muted">当前工单暂无可下载文件，下载全部已暂时禁用。</p>}
                    </div>
                  )}
                  {toolTab === 'queue' && (
                    <div className="tool-pane">
                      <div className="queue-summary">
                        <strong>最近上传结果</strong>
                        <span>成功 {uploadJobs.filter(j => j.status === 'success').length} · 失败 {uploadJobs.filter(j => j.status === 'failed').length}</span>
                      </div>
                      {!!uploadJobs.filter(j => j.status === 'failed').length && (
                        <button className="primary-button" type="button" disabled={uploading} onClick={retryFailedUploads}>重试全部失败</button>
                      )}
                      <UploadJobs jobs={uploadJobs} retry={retryUploadJob} remove={id => setUploadJobs(v => v.filter(job => job.id !== id))} uploading={uploading} />
                      {!uploadJobs.length && <div className="empty-list">暂无上传任务。</div>}
                    </div>
                  )}
                </section>
              </aside>
              {toolOpen && <button className="tool-window-scrim" type="button" aria-label="关闭资料工具窗" onClick={() => setToolOpen(false)} />}
            </div>
          )}
        </section>
      </section>

      {order && (
        <section className="print-summary" aria-hidden="true">
          <h1>工单资料摘要</h1>
            <div className="print-meta">
            <span>客户：{customerLabel(order)}</span>
            <span>规格：{workOrderDisplayCode(order)}</span>
            <span>产品名称：{order.productName}</span>
            <span>状态：{flowText(order.stage)}</span>
            <span>优先级：{priorityText[order.priority] || order.priority}</span>
            {order.plannedAt && <span>计划时间：{dt(order.plannedAt)}</span>}
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

      {quickMenu && (
        <div className="quick-menu" style={{ left: quickMenu.x, top: quickMenu.y }}>
          {(quickMenu.type === 'stage' ? flowStages : ([
            ['urgent', '紧急'],
            ['high', '高'],
            ['normal', '一般'],
          ] as const)).map(([key, label]) => {
            const target = orders.find(o => o.id === quickMenu.orderId);
            return (
              <button key={key} type="button" disabled={!target} onClick={() => target && updateWorkOrderQuick(target, quickMenu.type === 'stage' ? { stage: key } : { priority: key })}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {weekAction && (
        <WeekActionDialog
          action={weekAction}
          dateValue={weekActionDate}
          summary={weekActionSummary}
          error={weekActionError}
          loading={weekActionLoading}
          confirmText={weekActionConfirmText}
          close={() => setWeekAction(null)}
          setDate={setWeekActionDate}
          setConfirmText={setWeekActionConfirmText}
          preview={() => previewWeekAction()}
          commit={commitWeekAction}
        />
      )}

      <LocalImportDialog
        open={localImportOpen}
        task={localImportTask}
        connection={localImportConnection}
        error={localImportError}
        retry={() => void retryLocalImportHandoff()}
        recreate={() => void recreateLocalImportTask()}
        close={() => setLocalImportOpen(false)}
      />

      <CameraCaptureModal
        open={cameraOpen}
        workOrderCode={order ? workOrderDisplayCode(order) : undefined}
        categoryCode={category?.code}
        categoryName={category?.name}
        onClose={() => setCameraOpen(false)}
        onUpload={uploadCameraFiles}
      />

      <input ref={csvImport} hidden type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => previewWorkOrderImport(e.target.files)} />

      {systemOpen && (
        <SystemSettings
          userName={accountName}
          now={now}
          status={systemStatus}
          loading={systemLoading}
          exporting={exporting}
          importing={importing}
          importMode={importMode}
          importTarget={importTarget}
          importWeekStart={importWeekStart}
          importPreview={importPreview}
          importResult={importResult}
          importError={importError}
          clearWeekStart={clearWeekStart}
          clearPreview={clearPreview}
          clearConfirmText={clearConfirmText}
          clearError={clearError}
          clearingWeeklyPlan={clearingWeeklyPlan}
          duplicateStrategy={duplicateStrategy}
          canInstall={!!installPrompt}
          close={() => setSystemOpen(false)}
          refreshStatus={loadSystemStatus}
          refreshData={refresh}
          openLogs={() => loadLogs('all')}
          openSnapshots={loadChangeSnapshots}
          openAccounts={openAccounts}
          openTrash={openTrash}
          openHelp={() => setHelpOpen(true)}
          logout={logout}
          installApp={installApp}
          chooseImport={() => csvImport.current?.click()}
          setImportMode={setImportMode}
          setImportTarget={setImportTarget}
          setImportWeekStart={setImportWeekStart}
          setClearWeekStart={setClearWeekStart}
          setClearConfirmText={setClearConfirmText}
          setDuplicateStrategy={setDuplicateStrategy}
          clearImport={() => { setImportPreview(null); setImportResult(null); setImportError(''); }}
          commitWorkOrderImport={commitWorkOrderImport}
          previewClearWeeklyPlan={previewClearWeeklyPlan}
          commitClearWeeklyPlan={commitClearWeeklyPlan}
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
          restoreManualTrash={restoreManualTrash}
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
                <label>工单号
                  <div className="voice-field">
                    <input value={orderForm.code} disabled={orderModal.mode === 'edit'} onChange={e => setOrderForm(v => ({ ...v, code: e.target.value }))} />
                    {orderModal.mode === 'create' && <VoiceInputButton value={orderForm.code} onChange={value => setOrderForm(v => ({ ...v, code: value }))} mode="replace" label="工单号语音输入" />}
                  </div>
                </label>
                <label>客户名称
                  <div className="voice-field">
                    <input value={orderForm.customerName} onChange={e => setOrderForm(v => ({ ...v, customerName: e.target.value }))} placeholder="可选" />
                    <VoiceInputButton value={orderForm.customerName} onChange={value => setOrderForm(v => ({ ...v, customerName: value }))} label="客户名称语音输入" />
                  </div>
                </label>
                <label>产品名称
                  <div className="voice-field">
                    <input value={orderForm.productName} onChange={e => setOrderForm(v => ({ ...v, productName: e.target.value }))} />
                    <VoiceInputButton value={orderForm.productName} onChange={value => setOrderForm(v => ({ ...v, productName: value }))} label="产品名称语音输入" />
                  </div>
                </label>
                <label>状态<select value={normalizeFlowStage(orderForm.stage)} onChange={e => setOrderForm(v => ({ ...v, stage: e.target.value }))}>{flowStages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label>优先级<select value={orderForm.priority} onChange={e => setOrderForm(v => ({ ...v, priority: e.target.value }))}><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>
                <label>计划时间<input type="datetime-local" value={orderForm.plannedAt} onChange={e => setOrderForm(v => ({ ...v, plannedAt: e.target.value }))} /></label>
                <label>进度<input type="number" min={0} max={100} value={orderForm.progress} onChange={e => setOrderForm(v => ({ ...v, progress: Number(e.target.value) }))} /></label>
              <label className="wide">备注
                <div className="voice-field voice-field-textarea">
                  <textarea value={orderForm.remark} onChange={e => setOrderForm(v => ({ ...v, remark: e.target.value }))} />
                  <VoiceInputButton value={orderForm.remark} onChange={value => setOrderForm(v => ({ ...v, remark: value }))} label="备注语音输入" />
                </div>
              </label>
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
            <label>显示名称
              <div className="voice-field">
                <input value={fileForm.displayName} onChange={e => setFileForm(v => ({ ...v, displayName: e.target.value }))} placeholder="可选，下载时优先使用" />
                <VoiceInputButton value={fileForm.displayName} onChange={value => setFileForm(v => ({ ...v, displayName: value }))} label="显示名称语音输入" />
              </div>
            </label>
            <label>备注
              <div className="voice-field voice-field-textarea">
                <textarea value={fileForm.remark} onChange={e => setFileForm(v => ({ ...v, remark: e.target.value }))} placeholder="可选，填写资料说明" />
                <VoiceInputButton value={fileForm.remark} onChange={value => setFileForm(v => ({ ...v, remark: value }))} label="文件备注语音输入" />
              </div>
            </label>
            <label>搜索目标工单<input value={fileOrderKw} onChange={e => setFileOrderKw(e.target.value)} placeholder="输入规格 / 客户 / 产品名称筛选" /></label>
            <label>所属工单<select value={fileForm.workOrderId} onChange={e => setFileForm(v => ({ ...v, workOrderId: e.target.value }))}>
              {fileOrderOptions.map(item => <option key={item.id} value={item.id}>{workOrderDisplayCode(item)} · {customerLabel(item)} · {item.productName}</option>)}
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

      {snapshotsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="logs-dialog" role="dialog" aria-modal="true" aria-label="变更记录">
            <div className="dialog-title">
              <strong>变更记录</strong>
              <button type="button" onClick={() => setSnapshotsOpen(false)}>×</button>
            </div>
            {snapshotsLoading ? (
              <div className="empty-list">变更记录加载中...</div>
            ) : (
              <div className="logs-table snapshot-table">
                <div className="logs-head"><span>时间</span><span>操作人</span><span>操作</span><span>对象</span><span>变更摘要</span></div>
                {snapshots.map(item => (
                  <div className="logs-row" key={item.id}>
                    <span>{dt(item.createdAt)}</span>
                    <span>{item.changedBy || '-'}</span>
                    <span>{actionText[item.action] || item.action}</span>
                    <span>{item.entityType}<small>{item.entityId}</small></span>
                    <span>
                      {item.summary || '-'}
                      <details className="snapshot-detail">
                        <summary>查看详情</summary>
                        <div className="snapshot-json-grid">
                          <div><b>修改前</b><pre>{JSON.stringify(item.beforeJson ?? null, null, 2)}</pre></div>
                          <div><b>修改后</b><pre>{JSON.stringify(item.afterJson ?? null, null, 2)}</pre></div>
                        </div>
                      </details>
                    </span>
                  </div>
                ))}
                {!snapshots.length && <div className="empty-list">暂无变更记录</div>}
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
            <div className="danger-confirm-detail">
              <span>版本：{deleteTarget.version || 'V1.0'}</span>
              <span>所属工单：{deleteTarget.workOrderCode || workOrderDisplayCode(order)}</span>
              <span>分类：{deleteTarget.categoryName || category?.name || '-'}</span>
            </div>
            <label className="confirm-input-label">
              输入 <b>DELETE {displayFileName(deleteTarget).slice(-4)}</b> 确认
              <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={`DELETE ${displayFileName(deleteTarget).slice(-4)}`} />
            </label>
            <p className="tool-note muted">删除后可在回收站恢复；不会物理删除对象存储文件。</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deleting || deleteConfirmText.trim().replace(/\s+/g, ' ') !== `DELETE ${displayFileName(deleteTarget).slice(-4)}`} onClick={confirmDeleteFile}>{deleting ? '删除中...' : '确认删除'}</button>
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
            <div className="delete-file-name">{workOrderDisplayCode(orderDeleteTarget)} · {orderDeleteTarget.productName}</div>
            <div className="danger-confirm-detail">
              <span>客户：{orderDeleteTarget.customerName || '未填写'}</span>
              <span>产品：{orderDeleteTarget.productName}</span>
              <span>生产编号：{workOrderDisplayCode(orderDeleteTarget)}</span>
            </div>
            <label className="confirm-input-label">
              输入内部编号 <b>{orderDeleteTarget.code} CONFIRM</b> 确认删除
              <input value={orderDeleteConfirmText} onChange={e => setOrderDeleteConfirmText(e.target.value)} placeholder={`${orderDeleteTarget.code} CONFIRM`} />
            </label>
            <p className="tool-note muted">删除后可在回收站恢复，不会删除 S3 文件。</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setOrderDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deleting || orderDeleteConfirmText.trim().replace(/\s+/g, ' ') !== `${orderDeleteTarget.code} CONFIRM`} onClick={confirmDeleteOrder}>{deleting ? '删除中...' : '确认删除'}</button>
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

function WeekActionDialog({
  action,
  dateValue,
  summary,
  error,
  loading,
  confirmText,
  close,
  setDate,
  setConfirmText,
  preview,
  commit,
}: {
  action: Exclude<WeekAction, null>;
  dateValue: string;
  summary: WeeklyPlanClearSummary | WeeklyPlanActivateSummary | null;
  error: string;
  loading: boolean;
  confirmText: string;
  close: () => void;
  setDate: (value: string) => void;
  setConfirmText: (value: string) => void;
  preview: () => void;
  commit: () => void;
}) {
  const isClose = action === 'close';
  const required = isClose ? 'CLOSE_WEEK' : 'START_NEXT_WEEK';
  const title = isClose ? '结束本周 / 归档当前周' : '启用下周草稿';
  const activateSummary = summary && !isClose ? summary as WeeklyPlanActivateSummary : null;
  const activationBlocked = (activateSummary?.blockingAnomalyCount || 0) > 0;
  let summaryItems: string[][] = [];
  if (summary && isClose) {
    const item = summary as WeeklyPlanClearSummary;
    summaryItems = [
      ['周期', `${item.weekStartDate} 至 ${item.weekEndDate}`],
      ['归档工单', String(item.archiveCount ?? item.workOrderCount)],
      ['已上传资料工单', String(item.workOrdersWithFiles)],
      ['缺资料工单', String(item.missingWorkOrders ?? 0)],
      ['保留文件', String(item.fileCount)],
      ['保留图纸资料库', String(item.drawingLibraryItemCount ?? 0)],
      ['保留连接器参数', String(item.connectorParameterCount)],
    ];
  } else if (summary) {
    const item = summary as WeeklyPlanActivateSummary;
    summaryItems = [
      ['周期', `${item.weekStartDate} 至 ${item.weekEndDate}`],
      ['将归档当前周', String(item.currentArchiveCount)],
      ['将启用下周', String(item.nextActivateCount)],
      ['新增', String(item.newCount)],
      ['延续', String(item.continuedCount)],
      ['变更', String(item.changedCount)],
      ['下周取消', String(item.removedCount)],
      ['阻断异常', String(item.blockingAnomalyCount)],
      ['警告', String(item.warningCount)],
      ['有图纸资料', String(item.drawingWithFilesCount)],
      ['无图纸资料', String(item.drawingWithoutFilesCount)],
      ['保留文件', String(item.fileCount)],
    ];
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="week-action-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">
          <div>
            <strong>{title}</strong>
            <small>{isClose ? '只归档周计划工单，不删除任何资料' : '先归档当前周，再启用指定下周草稿'}</small>
          </div>
          <button type="button" onClick={close}>×</button>
        </div>
        <label className="import-week-start">
          <span>{isClose ? '当前周开始日期' : '下周开始日期'}</span>
          <input type="date" value={dateValue} onChange={e => setDate(e.target.value)} />
        </label>
        <button type="button" disabled={loading || !dateValue} onClick={preview}>{loading ? '预览中...' : '预览影响范围'}</button>
        {error && <div className="form-error">{error}</div>}
        {summary && (
          <>
            <div className="week-action-summary">
              {summaryItems.map(([label, value]) => (
                <span key={label}><b>{label}</b><em>{value}</em></span>
              ))}
            </div>
            {activationBlocked && <div className="weekly-block-message">存在 {activateSummary?.blockingAnomalyCount} 项阻断异常，请先到周计划差异中心处理，当前不会启用下周。</div>}
            {!isClose && !activationBlocked && (activateSummary?.warningCount || 0) > 0 && <div className="weekly-warning-message">仍有 {activateSummary?.warningCount} 项警告，可以继续启用，但请先确认已知悉。</div>}
            <p className="tool-note muted">图纸资料库、连接器参数、S3 文件和历史上传记录都会保留。</p>
            {!activationBlocked && (
              <label className="danger-confirm-inline">
                <span>确认请输入 {required}</span>
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={required} />
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={close}>取消</button>
              <button className={isClose ? 'danger-button' : 'primary-button'} type="button" disabled={loading || activationBlocked || confirmText.trim() !== required} onClick={commit}>
                {loading ? '处理中...' : isClose ? '确认归档当前周' : '确认启用下周'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OrderGroup({
  title,
  orders,
  selected,
  choose,
  categories,
  openQuickMenu,
  readOnly = false,
  diffTypes = {},
}: {
  title: string;
  orders: WorkOrderDTO[];
  selected?: string;
  choose: (id: string) => void;
  categories: ResourceCategoryDTO[];
  openQuickMenu: (type: 'stage' | 'priority', target: WorkOrderDTO, event: React.MouseEvent<HTMLElement>) => void;
  readOnly?: boolean;
  diffTypes?: Record<string, string>;
}) {
  return (
    <section className="order-group">
      <h2><span>▣</span>{title}<em>{orders.length}</em></h2>
      {orders.map(o => {
        const completion = completionOf(categories, o.categoryFileCounts || {});
        const missingText = completion.missingNames.length ? `缺失：${completion.missingNames.join('、')}` : '必填资料已齐全';
        const delivery = orderDeliveryLabel(o);
        const drawingText = o.drawingStatus?.trim() || '图纸未填';
        const materialText = o.materialStatus?.trim() || '配料未填';
        const diffType = diffTypes[o.id];
        const diffLabel = diffType === 'new' ? '新增' : diffType === 'continued' ? '延续' : diffType === 'changed' ? '有变更' : diffType === 'duplicate' ? '重复' : diffType === 'invalid' ? '异常' : '';
        return (
          <button key={o.id} className={o.id === selected ? 'order-card active' : 'order-card'} type="button" onClick={() => choose(o.id)}>
            <div className="order-topline">
              <strong title={workOrderDisplayCode(o)}>{workOrderDisplayCode(o)}</strong>
              <span className="order-card-tags">
                {diffLabel && <em className={`draft-diff-chip ${diffType}`}>{diffLabel}</em>}
                <span role="button" tabIndex={readOnly ? -1 : 0} className={`tag priority-chip ${o.priority}`} onClick={e => { e.stopPropagation(); if (!readOnly) openQuickMenu('priority', o, e); }}>{priorityText[o.priority] || '一般'}</span>
              </span>
            </div>
            <span className="order-customer" title={`${customerLabel(o)} · ${o.productName || '-'}`}>{customerLabel(o)} · {o.productName || '-'}</span>
            <div className="order-weekly-meta">
              <span title={o.uncompletedQty || '-'}>未交：{o.uncompletedQty || '-'}</span>
              <span title={delivery}>交期：{delivery}</span>
              <span title={drawingText}>图纸：{drawingText}</span>
              <span title={materialText}>配料：{materialText}</span>
            </div>
            <div className="order-compact-meta">
              <span role="button" tabIndex={readOnly ? -1 : 0} className={`flow-chip ${normalizeFlowStage(o.stage)}`} onClick={e => { e.stopPropagation(); if (!readOnly) openQuickMenu('stage', o, e); }}>{flowText(o.stage)}</span>
              <strong className={`completion-chip ${completion.key}`} title={missingText}>{completion.text}</strong>
              {o.weekStartDate && <em className="planned-text">{ymdLocal(o.weekStartDate)}</em>}
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
  return <span className="file-thumb img"><img src={file.contentUrl || file.viewUrl} alt={displayFileName(file)} loading="lazy" decoding="async" /></span>;
}

function inferWeekStartFromFilename(name: string) {
  const match = name.match(/(\d{1,2})[.-](\d{1,2})\s*-\s*(\d{1,2})[.-](\d{1,2})/);
  if (!match) return '';
  const year = new Date().getFullYear();
  return `${year}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function UploadJobs({
  jobs,
  retry,
  remove,
  uploading,
}: {
  jobs: UploadJob[];
  retry: (job: UploadJob) => void;
  remove: (id: string) => void;
  uploading: boolean;
}) {
  if (!jobs.length) return null;
  const ok = jobs.filter(j => j.status === 'success').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  return (
    <div className="upload-jobs">
      <div className="upload-jobs-head"><strong>上传队列</strong><span>成功 {ok} · 失败 {failed}</span></div>
      {jobs.map(job => (
        <div className={`upload-job ${job.status}`} key={job.id}>
          <b>{shortName(job.name)}</b>
          <span>
            {job.fileType} · {job.originalSize ? `${bytes(job.originalSize)} → ${bytes(job.size)}` : bytes(job.size)} · {job.status === 'waiting' ? '等待上传' : job.status === 'uploading' ? '上传中' : job.status === 'success' ? '上传成功' : '上传失败'}
          </span>
          <small>{job.message}</small>
          <div className="upload-job-actions">
            {job.status === 'failed' && <button type="button" disabled={uploading} onClick={() => retry(job)}>重试</button>}
            <button type="button" disabled={job.status === 'uploading'} onClick={() => remove(job.id)}>移除</button>
          </div>
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
  currentCategoryName,
  uploading,
  chooseImage,
  openCamera,
  selectFile,
  openFileEdit,
  setDeleteTarget,
}: {
  files: ResourceFileDTO[];
  categories: ResourceCategoryDTO[];
  managerCategory: string;
  setManagerCategory: (v: string) => void;
  currentCategoryName: string;
  uploading: boolean;
  chooseImage: () => void;
  openCamera: () => void;
  selectFile: (file: ResourceFileDTO) => void;
  openFileEdit: (file: ResourceFileDTO) => void;
  setDeleteTarget: (file: ResourceFileDTO) => void;
}) {
  return (
    <section className="upload-manager-panel">
      <div className="manager-toolbar">
        <div>
          <strong>当前工单全部文件</strong>
          <span>上传目标分类：{currentCategoryName}</span>
        </div>
        <div className="manager-upload-actions">
          <button type="button" disabled={uploading} onClick={chooseImage}>上传图片</button>
          <button className="primary-button" type="button" disabled={uploading} onClick={openCamera}>拍照上传</button>
        </div>
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
              <small>{dt(file.createdAt)} · {fileStatusText[file.status] || file.status}</small>
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
  restoreManualTrash,
}: {
  trash: TrashDTO;
  tab: 'workOrders' | 'files' | 'manuals' | 'manualVersions' | 'manualAssets';
  close: () => void;
  setTab: (tab: 'workOrders' | 'files' | 'manuals' | 'manualVersions' | 'manualAssets') => void;
  restoreWorkOrder: (id: string) => void;
  restoreFile: (id: string) => void;
  restoreManualTrash: (type: 'manual' | 'version' | 'asset', id: string) => void;
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
          <button className={tab === 'manuals' ? 'active' : ''} type="button" onClick={() => setTab('manuals')}>说明书</button>
          <button className={tab === 'manualVersions' ? 'active' : ''} type="button" onClick={() => setTab('manualVersions')}>说明书版本</button>
          <button className={tab === 'manualAssets' ? 'active' : ''} type="button" onClick={() => setTab('manualAssets')}>说明书文件</button>
        </div>
        {tab === 'workOrders' ? (
          <div className="compact-table trash-table">
            <div className="compact-head"><span>生产编号</span><span>产品名称</span><span>删除时间</span><span>操作</span></div>
            {trash.workOrders.map(item => (
              <div className="compact-row" key={item.id}>
                <span>{workOrderDisplayCode(item)}</span>
                <span>{item.productName}</span>
                <span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span>
                <span><button type="button" onClick={() => restoreWorkOrder(item.id)}>恢复</button></span>
              </div>
            ))}
            {!trash.workOrders.length && <div className="empty-list">暂无已删除工单</div>}
          </div>
        ) : tab === 'files' ? (
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
        ) : tab === 'manuals' ? (
          <div className="compact-table trash-table">
            <div className="compact-head"><span>说明书名称</span><span>制造商</span><span>删除时间</span><span>操作</span></div>
            {(trash.connectorAssemblyManuals || []).map(item => <div className="compact-row" key={item.id}><span>{item.title}</span><span>{item.manufacturer || '-'}</span><span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span><span><button type="button" onClick={() => restoreManualTrash('manual', item.id)}>恢复</button></span></div>)}
            {!(trash.connectorAssemblyManuals || []).length && <div className="empty-list">暂无已删除说明书</div>}
          </div>
        ) : tab === 'manualVersions' ? (
          <div className="compact-table trash-table">
            <div className="compact-head"><span>说明书名称</span><span>版本</span><span>删除时间</span><span>操作</span></div>
            {(trash.connectorAssemblyManualVersions || []).map(item => <div className="compact-row" key={item.id}><span>{item.manualTitle}</span><span>{item.revision}</span><span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span><span><button type="button" onClick={() => restoreManualTrash('version', item.id)}>恢复</button></span></div>)}
            {!(trash.connectorAssemblyManualVersions || []).length && <div className="empty-list">暂无已删除说明书版本</div>}
          </div>
        ) : (
          <div className="compact-table trash-table">
            <div className="compact-head"><span>说明书名称</span><span>文件名</span><span>删除时间</span><span>操作</span></div>
            {(trash.connectorAssemblyManualAssets || []).map(item => <div className="compact-row" key={item.id}><span>{item.manualTitle}</span><span>{item.displayName || item.originalName}</span><span>{item.deletedAt ? dt(item.deletedAt) : '-'}</span><span><button type="button" onClick={() => restoreManualTrash('asset', item.id)}>恢复</button></span></div>)}
            {!(trash.connectorAssemblyManualAssets || []).length && <div className="empty-list">暂无已删除说明书文件</div>}
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
    ['如何拍照上传', '选择分类后点击“拍照上传”，平板会优先打开后置摄像头，拍完可重拍、继续拍照或确认上传。摄像头不可用时可改用上传图片。'],
    ['如何语音输入', '全局搜索、工单表单和文件信息表单中的麦克风按钮可把普通话识别为文字。识别结果只写入当前输入框，不会自动提交表单。'],
    ['如何移动错传文件', '选择文件后点击“编辑文件”，在弹窗里调整所属工单或所属分类并保存。'],
    ['如何恢复误删文件', '打开“回收站”，切到文件或工单列表，点击恢复。'],
    ['如何下载全部资料', '选择工单后点击“下载全部”，系统会按分类打包 ZIP。'],
    ['如何导入 CSV', '系统设置中下载模板，填写后上传 CSV，查看逐行结果。'],
    ['如何添加到桌面', '用平板浏览器打开系统，在浏览器右上角菜单中选择添加到桌面或安装应用；安装后从桌面图标进入，可减少浏览器地址栏和标签栏干扰。'],
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
          <h3>拍照和语音输入说明</h3>
          <p>拍照上传需要摄像头权限，语音输入需要麦克风权限。系统不会保存录音，也不会保存原始视频流；摄像头只在拍照弹窗打开时使用，关闭后会释放。浏览器不支持语音输入时仍可手动输入，摄像头不可用时可使用“上传图片”。线上使用时页面地址需要 HTTPS。</p>
        </section>
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
          <h1>{workOrderDisplayCode(order)}</h1>
          <p>客户：{customerLabel(order)}</p>
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
  importMode,
  importTarget,
  importWeekStart,
  importPreview,
  importResult,
  importError,
  clearWeekStart,
  clearPreview,
  clearConfirmText,
  clearError,
  clearingWeeklyPlan,
  duplicateStrategy,
  canInstall,
  close,
  refreshStatus,
  refreshData,
  openLogs,
  openSnapshots,
  openAccounts,
  openTrash,
  openHelp,
  logout,
  installApp,
  chooseImport,
  setImportMode,
  setImportTarget,
  setImportWeekStart,
  setClearWeekStart,
  setClearConfirmText,
  setDuplicateStrategy,
  clearImport,
  commitWorkOrderImport,
  previewClearWeeklyPlan,
  commitClearWeeklyPlan,
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
  importMode: ImportMode;
  importTarget: ImportTarget;
  importWeekStart: string;
  importPreview: ImportPreview | null;
  importResult: ImportResult | null;
  importError: string;
  clearWeekStart: string;
  clearPreview: WeeklyPlanClearSummary | null;
  clearConfirmText: string;
  clearError: string;
  clearingWeeklyPlan: boolean;
  duplicateStrategy: 'skip' | 'import';
  canInstall: boolean;
  close: () => void;
  refreshStatus: () => void;
  refreshData: () => void;
  openLogs: () => void;
  openSnapshots: () => void;
  openAccounts: () => void;
  openTrash: () => void;
  openHelp: () => void;
  logout: () => void;
  installApp: () => void;
  chooseImport: () => void;
  setImportMode: (mode: ImportMode) => void;
  setImportTarget: (target: ImportTarget) => void;
  setImportWeekStart: (value: string) => void;
  setClearWeekStart: (value: string) => void;
  setClearConfirmText: (value: string) => void;
  setDuplicateStrategy: (strategy: 'skip' | 'import') => void;
  clearImport: () => void;
  commitWorkOrderImport: () => void;
  previewClearWeeklyPlan: () => void;
  commitClearWeeklyPlan: () => void;
  downloadTemplate: () => void;
  exportWorkOrders: () => void;
  exportResourceFiles: () => void;
  exportOperationLogs: () => void;
  exportMetadata: () => void;
  exportDiagnostics: () => void;
}) {
  const okText = (value?: boolean) => (value ? '正常' : '异常');
  const apkCapabilities = getAndroidCapabilities();
  const supportText = (value?: boolean) => (value ? '支持' : '不支持');
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="system-dialog" role="dialog" aria-modal="true" aria-label="系统设置">
        <div className="dialog-title">
          <div>
            <strong>系统设置</strong>
            <small>{status?.app.version || 'v1.13.0-rc.1'} · Web / PWA</small>
          </div>
          <button type="button" onClick={close}>×</button>
        </div>

        <div className="system-grid">
          <section className="system-section">
            <h3>基础信息</h3>
            <Info label="系统名称" value={status?.app.name || '工单资料库'} />
            <Info label="当前版本" value={status?.app.version || 'v1.13.0-rc.1'} />
            <Info label="部署模式" value={status?.app.mode || 'Web / PWA'} />
            <Info label="运行时长" value={status?.app.uptime ? `${Math.floor(status.app.uptime / 60)} 分钟` : '-'} />
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
                <Info label="数据库" value={`${status?.database.type || 'PostgreSQL'} · ${okText(status?.database.ok)} · ${status?.database.latencyMs ?? '-'}ms`} ok={status?.database.ok} />
                <Info label="文件存储" value={`${status?.storage.type || 'S3 兼容对象存储'} · ${okText(status?.storage.ok)} · ${status?.storage.latencyMs ?? '-'}ms`} ok={status?.storage.ok} />
                <Info label="存储桶配置" value={status?.storage.bucketConfigured ? '已配置' : '未配置'} ok={status?.storage.bucketConfigured} />
                <Info label="公开访问端点" value={status?.storage.publicEndpointConfigured ? '已配置' : '未配置'} ok={status?.storage.publicEndpointConfigured} />
                <Info label="Schema 可达" value={status?.migrations?.schemaReachable ? '可达' : '异常'} ok={status?.migrations?.schemaReachable} />
                <Info label="最大上传大小" value={`${status?.upload.maxUploadSizeMb || 50} MB`} />
                <Info label="支持格式" value={(status?.upload.supportedTypes || ['PDF', 'JPG', 'PNG']).join('、')} />
              </>
            )}
          </section>
        </div>

        <section className="system-section wide">
          <h3>生产健康检查</h3>
          <div className="stability-grid">
            <Info label="工单数量" value={String(status?.counts?.workOrders ?? '-')} />
            <Info label="资料文件" value={String(status?.counts?.resourceFiles ?? '-')} />
            <Info label="连接器参数" value={String(status?.counts?.connectorParameters ?? '-')} />
            <Info label="操作日志总数" value={String(status?.counts?.operationLogs ?? '-')} />
            <Info label="近 24h 操作日志" value={String(status?.counts?.operationLogsRecent ?? '-')} />
            <Info label="近 24h 危险操作" value={String(status?.counts?.dangerousOps ?? '-')} ok={(status?.counts?.dangerousOps || 0) === 0} />
            <Info label="近 24h 导入批次" value={String(status?.counts?.recentBatches ?? '-')} />
          </div>
          {!!status?.warnings?.length && (
            <div className="warning-list">
              {status.warnings.map(item => <span key={item}>{item}</span>)}
            </div>
          )}
        </section>

        <section className="system-section wide">
          <h3>生产稳定中心</h3>
          <div className="stability-grid">
            <Info label="最近危险操作" value={`${status?.counts?.dangerousOps ?? 0} 条`} ok={(status?.counts?.dangerousOps || 0) === 0} />
            <Info label="最近失败上传" value="查看上传队列" />
            <Info label="最近导入批次" value={`${status?.counts?.recentBatches ?? 0} 个`} />
            <Info label="变更快照" value={`${status?.counts?.snapshotsRecent ?? 0} 条`} />
          </div>
          <p className="tool-note">数据库建议每日备份；对象存储 Bucket 不要清空；重大上线前请手动快照。</p>
          <div className="system-actions">
            <button type="button" onClick={refreshStatus}>一键刷新健康状态</button>
            <button type="button" onClick={openSnapshots}>查看变更记录</button>
            <button type="button" onClick={openLogs}>查看操作日志</button>
          </div>
        </section>

        {apkCapabilities && (
          <section className="system-section wide">
            <h3>平板 App 能力</h3>
            <div className="stability-grid">
              <Info label="App 壳环境" value={apkCapabilities.webView ? 'WebView' : '普通浏览器'} ok={apkCapabilities.webView} />
              <Info label="文件选择" value={supportText(apkCapabilities.fileChooser)} ok={apkCapabilities.fileChooser} />
              <Info label="拍照上传" value={supportText(apkCapabilities.cameraCapture)} ok={apkCapabilities.cameraCapture} />
              <Info label="摄像头授权" value={supportText(apkCapabilities.getUserMediaPermission)} ok={apkCapabilities.getUserMediaPermission} />
              <Info label="下载管理" value={supportText(apkCapabilities.downloadManager)} ok={apkCapabilities.downloadManager} />
              <Info label="剪贴板复制" value={supportText(apkCapabilities.clipboard)} ok={apkCapabilities.clipboard} />
              <Info label="语音输入" value={apkCapabilities.speech ? '支持' : '键盘兜底'} ok={apkCapabilities.speech} />
            </div>
            <p className="tool-note">如果拍照或下载无反应，请先卸载旧 APK，安装 GitHub Actions 最新 debug APK，并检查系统相机权限。</p>
          </section>
        )}

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
          <p>支持标准模板 CSV，也支持周计划 .xls / .xlsx / .csv。上传后先进入预览，确认后才会写入数据库。</p>
          <div className="import-mode-tabs">
            <button className={importMode === 'weekly_plan' ? 'active' : ''} type="button" onClick={() => { setImportMode('weekly_plan'); clearImport(); }}>周计划 Excel 导入</button>
            <button className={importMode === 'standard' ? 'active' : ''} type="button" onClick={() => { setImportMode('standard'); clearImport(); }}>标准模板导入</button>
          </div>
          {importMode === 'weekly_plan' && (
            <>
              <div className="import-target-tabs single">
                <button className="active" type="button" onClick={() => setImportTarget('draft_next')}>保存为下周草稿</button>
              </div>
              <label className="import-week-start">
                <span>计划周开始日期</span>
                <input type="date" value={importWeekStart} onChange={e => setImportWeekStart(e.target.value)} />
                <small>导入只生成下周草稿；完成后进入差异中心，处理阻断异常并确认后再启用。</small>
              </label>
            </>
          )}
          <div className="system-actions">
            <div className="weekly-clear-preview">
              <h4>归档当前周生产工单</h4>
              <p>仅把当前周周计划生产工单移入历史周，不删除图纸资料库、资料文件、PDF、图片或连接器参数。</p>
              <label className="import-week-start">
                <span>计划周开始日期</span>
                <input type="date" value={clearWeekStart || importWeekStart} onChange={e => setClearWeekStart(e.target.value)} />
                <small>归档后当前周 Excel 工单会退出默认生产列表，可在历史周查看。</small>
              </label>
              <button type="button" disabled={clearingWeeklyPlan || !(clearWeekStart || importWeekStart)} onClick={() => { if (!clearWeekStart && importWeekStart) setClearWeekStart(importWeekStart); previewClearWeeklyPlan(); }}>
                {clearingWeeklyPlan ? '检查中...' : '预览归档'}
              </button>
              {clearError && <div className="form-error">{clearError}</div>}
              {clearPreview && (
                <>
                  <div className="import-summary">
                    <span>周期 {clearPreview.weekStartDate} 至 {clearPreview.weekEndDate}</span>
                    <span>生产工单 {clearPreview.workOrderCount}</span>
                    <span>已上传资料工单 {clearPreview.workOrdersWithFiles}</span>
                    <span>不会删除文件 {clearPreview.fileCount}</span>
                    <span>不会删除图纸资料库</span>
                    <span>不会删除连接器参数 {clearPreview.connectorParameterCount}</span>
                    {clearPreview.clearedCount !== undefined && <span>已归档 {clearPreview.clearedCount}</span>}
                  </div>
                  <label className="danger-confirm-inline">
                    <span>确认请输入 CLOSE_WEEK</span>
                    <input value={clearConfirmText} onChange={e => setClearConfirmText(e.target.value)} placeholder="CLOSE_WEEK" />
                  </label>
                  <button className="danger-button" type="button" disabled={clearingWeeklyPlan || clearConfirmText.trim() !== 'CLOSE_WEEK'} onClick={commitClearWeeklyPlan}>
                    {clearingWeeklyPlan ? '归档中...' : '确认归档当前周'}
                  </button>
                </>
              )}
            </div>
            <button type="button" disabled={!!exporting} onClick={downloadTemplate}>{exporting === '下载导入模板' ? '下载中...' : '下载 CSV 模板'}</button>
            <button className="primary-button" type="button" disabled={importing} onClick={chooseImport}>{importing ? '解析中...' : '上传文件预览'}</button>
            <button type="button" onClick={clearImport}>重新选择文件</button>
          </div>
          {importError && <div className="form-error">{importError}</div>}
          {importPreview?.warnings?.map(item => <p className="tool-note muted" key={item}>{item}</p>)}
          {importPreview && (
            <div className="import-result weekly-preview">
              <div className="import-summary">
                <span>总行 {importPreview.summary.totalRows}</span>
                <span>可导入 {importPreview.summary.readyCount}</span>
                <span>重复 {importPreview.summary.duplicateCount}</span>
                <span>跳过 {importPreview.summary.skippedCount}</span>
                <span>异常 {importPreview.summary.invalidCount}</span>
              </div>
              <div className="duplicate-strategy">
                <label><input type="radio" checked={duplicateStrategy === 'skip'} onChange={() => setDuplicateStrategy('skip')} /> 默认跳过重复行</label>
                <label><input type="radio" checked={duplicateStrategy === 'import'} onChange={() => setDuplicateStrategy('import')} /> 仍然导入重复行</label>
              </div>
              <div className="import-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>规格 / 生产编号</th>
                      <th>内部编号</th>
                      <th>客户</th>
                      <th>品名</th>
                      <th>规格</th>
                      <th>未交量</th>
                      <th>图纸</th>
                      <th>配料</th>
                      <th>交期</th>
                      <th>计划日期</th>
                      <th>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.slice(0, 120).map(row => (
                      <tr key={`${row.rowNo}-${row.code}`} className={`import-preview-row ${row.status}`}>
                        <td>{row.rowNo}</td>
                        <td>{row.workOrder.specification || row.code || '-'}</td>
                        <td>{row.code || '-'}</td>
                        <td>{row.workOrder.customerName || '-'}</td>
                        <td>{row.workOrder.productName || '-'}</td>
                        <td>{row.workOrder.specification || '-'}</td>
                        <td>{row.workOrder.uncompletedQty || '-'}</td>
                        <td>{row.workOrder.drawingStatus || '-'}</td>
                        <td>{row.workOrder.materialStatus || '-'}</td>
                        <td>{row.workOrder.deliveryDay || '-'}</td>
                        <td>{row.workOrder.plannedAt ? shortDt(row.workOrder.plannedAt) : '-'}</td>
                        <td>{row.status === 'ready' ? '可导入' : row.status === 'duplicate' ? '重复' : row.status === 'skipped' ? '跳过' : '异常'}{row.reason ? ` · ${row.reason}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.rows.length > 120 && <p className="tool-note muted">仅显示前 120 行，确认导入会处理完整预览结果。</p>}
              </div>
              <div className="dialog-actions">
                <button type="button" onClick={clearImport}>取消</button>
                <button className="primary-button" type="button" disabled={importing || (importPreview.summary.readyCount === 0 && !(duplicateStrategy === 'import' && importPreview.summary.duplicateCount > 0))} onClick={commitWorkOrderImport}>{importing ? '导入中...' : '确认导入'}</button>
              </div>
            </div>
          )}
          {importResult && (
            <div className="import-result">
              <div className="import-summary">
                <span>新增 {importResult.summary.created}</span>
                <span>跳过 {importResult.summary.skipped}</span>
                <span>失败 {importResult.summary.failed}</span>
                {importResult.importBatchId && <span>批次 {importResult.importBatchId}</span>}
              </div>
              <details>
                <summary>查看逐行结果</summary>
                <div className="import-result-list">
                  {importResult.results.map(row => (
                    <div className={`import-row ${row.status}`} key={`${row.row}-${row.code}`}>
                      <span>第 {row.row} 行</span>
                      <b>{row.code}</b>
                      <em>{row.status === 'created' ? '新增' : row.status === 'skipped' ? '跳过' : '失败'}</em>
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
          <p>在鸿蒙平板浏览器中打开系统后，点击浏览器右上角菜单，选择“添加到桌面 / 安装应用”。安装后从桌面图标打开，可使用 PWA 独立窗口并减少地址栏、标签栏干扰。</p>
          <p className="tool-note muted">如果当前浏览器没有弹出安装按钮，请使用浏览器菜单手动添加。PWA 只缓存图标和 manifest，不缓存业务 API、上传响应或签名下载链接。</p>
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

function Info({ label, value, ok, wrap = false }: { label: string; value: string; ok?: boolean; wrap?: boolean }) {
  return (
    <div className={wrap ? 'info-item wrap' : 'info-item'}>
      <small>{label}</small>
      <strong className={ok ? 'success-text' : ''} title={value}>{value}</strong>
    </div>
  );
}
