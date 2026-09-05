'use client';

import {
  AlertTriangle,
  Archive,
  Ban,
  Boxes,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Eye,
  FileArchive,
  FileImage,
  History,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { PortalMenu } from '@/components/PortalMenu';
import { QualityModuleTabs } from '@/components/QualityModuleTabs';
import { useToastBridge } from '@/components/ToastProvider';
import QualityRiskInitiateDialog from '@/components/QualityRiskInitiateDialog';
import QualityWorkflowPanel from '@/components/QualityWorkflowPanel';
import { QUALITY_PROBLEM_CATEGORIES } from '@/lib/quality-workflow-shared';
import { QualityAssigneeSelect } from '@/components/QualityAssigneeSelect';
import { QualityTaskActions } from '@/components/QualityTaskActions';
import { QualityEvidencePrintEditor } from '@/components/QualityEvidencePrintEditor';
import type {
  CurrentUserDTO,
  InternalQualityRiskDTO,
  InternalQualityRiskAttachmentDTO,
  InternalQualityRiskArchiveRequirementKey,
  InternalQualityRiskArchiveRequirementMode,
  InternalQualityRiskArchiveRequirements,
  InternalQualityRiskOptionsDTO,
  InternalQualityRiskPrintPolicy,
  InternalQualityRiskReadinessDTO,
  InternalQualityRiskSeverity,
  InternalQualityRiskSummaryDTO,
  InternalQualityRiskTaskStatus,
} from '@/types';

type StatusFilter = 'ALL' | 'DRAFT' | 'SUBMITTED' | 'CONTAINMENT' | 'COLLABORATING' | 'VERIFYING' | 'PENDING_CLOSE' | 'REVISING' | 'ARCHIVED' | 'UNLINKED' | 'DELETED';
type DetailTab = 'overview' | 'collaboration' | 'warning' | 'causes' | 'actions' | 'relations' | 'archive';
type FormStep = 1 | 2 | 3 | 4 | 5;
type RiskForm = {
  ownerUserId: string;
  changeReason: string;
  printPhotoLayout: 'PAIR' | 'SINGLE';
  reportNo: string;
  title: string;
  severity: InternalQualityRiskSeverity;
  occurrenceDate: string;
  workshopArea: string;
  processName: string;
  responsibleDepartment: string;
  defectPhenomenon: string;
  occurrenceCause: string;
  escapeCause: string;
  systemCause: string;
  rootCause: string;
  secondaryCause: string;
  containmentAction: string;
  disposition: string;
  correctiveAction: string;
  preventiveAction: string;
  verificationResult: string;
  finalConclusion: string;
  evidenceSummary: string;
  riskScope: string;
  applicableProcess: string;
  effectiveFrom: string;
  effectiveUntil: string;
  warningSummary: string;
  requiredAction: string;
  inspectionMethod: string;
  inspectionFrequency: string;
  acceptanceCriteria: string;
  stopConditions: string;
  escalationContact: string;
  printPolicy: InternalQualityRiskPrintPolicy;
  archiveRequirements: InternalQualityRiskArchiveRequirements;
  issueIds: string[];
  workOrderIds: string[];
  productIds: string[];
  eightDReportIds: string[];
};

type PendingRiskAttachment = {
  id: string;
  file: File;
  category: InternalQualityRiskAttachmentDTO['category'];
  error?: string;
};

type RiskTaskForm = {
  ownerUserId: string;
  taskType: 'CONTAINMENT' | 'CAUSE' | 'ACTION' | 'VERIFICATION' | 'COLLABORATION';
  title: string;
  department: string;
  ownerName: string;
  requirement: string;
  dueAt: string;
};

type ListResponse = { ok: boolean; reports: InternalQualityRiskDTO[]; summary: InternalQualityRiskSummaryDTO; error?: string };
type MutationResponse = { ok: boolean; report?: InternalQualityRiskDTO; error?: string };
type PreviewResponse = { ok: boolean; report: InternalQualityRiskDTO; readiness: InternalQualityRiskReadinessDTO; error?: string };

const emptySummary: InternalQualityRiskSummaryDTO = { total: 0, draft: 0, submitted: 0, collaborating: 0, verifying: 0, pendingClose: 0, revising: 0, archived: 0, deleted: 0, critical: 0, activeAlerts: 0, unlinked: 0, overdueTasks: 0 };
const emptyOptions: InternalQualityRiskOptionsDTO = { products: [], issues: [], workOrders: [], eightDReports: [] };
const defaultArchiveRequirements: InternalQualityRiskArchiveRequirements = {
  defectPhenomenon: 'REQUIRED', occurrenceCause: 'OPTIONAL', escapeCause: 'OPTIONAL', rootCause: 'OPTIONAL',
  containmentAction: 'OPTIONAL', correctiveAction: 'OPTIONAL', verificationResult: 'OPTIONAL',
  warningSummary: 'OPTIONAL', requiredAction: 'OPTIONAL', inspectionMethod: 'OPTIONAL', inspectionFrequency: 'OPTIONAL',
  acceptanceCriteria: 'OPTIONAL', stopConditions: 'OPTIONAL', sourceIssue: 'OPTIONAL', evidence: 'OPTIONAL',
};
const emptyForm: RiskForm = {
  ownerUserId: '', changeReason: '', printPhotoLayout: 'PAIR',
  reportNo: '', title: '', severity: 'HIGH', occurrenceDate: '', workshopArea: '', processName: '', responsibleDepartment: '质量部',
  defectPhenomenon: '', occurrenceCause: '', escapeCause: '', systemCause: '', rootCause: '', secondaryCause: '',
  containmentAction: '', disposition: '', correctiveAction: '', preventiveAction: '', verificationResult: '', finalConclusion: '', evidenceSummary: '',
  riskScope: '', applicableProcess: '', effectiveFrom: '', effectiveUntil: '', issueIds: [], workOrderIds: [], productIds: [], eightDReportIds: [],
  warningSummary: '', requiredAction: '', inspectionMethod: '', inspectionFrequency: '', acceptanceCriteria: '', stopConditions: '', escalationContact: '质量部', printPolicy: 'OPTIONAL',
  archiveRequirements: defaultArchiveRequirements,
};
const emptyTaskForm: RiskTaskForm = { taskType: 'COLLABORATION', title: '', department: '', ownerName: '', ownerUserId: '', requirement: '', dueAt: '' };

const severityLabels: Record<InternalQualityRiskSeverity, string> = { LOW: '低风险', MEDIUM: '中风险', HIGH: '高风险', CRITICAL: '重大风险' };
const taskStatusLabels: Record<InternalQualityRiskTaskStatus, string> = { TODO: '待处理', IN_PROGRESS: '处理中', COMPLETED: '待验证', VERIFIED: '已验证', CANCELLED: '已取消' };
const taskTypeLabels: Record<RiskTaskForm['taskType'], string> = { CONTAINMENT: '临时遏制', CAUSE: '原因分析', ACTION: '改善措施', VERIFICATION: '效果验证', COLLABORATION: '部门协同' };
const printPolicyLabels: Record<InternalQualityRiskPrintPolicy, string> = { REQUIRED: '必须随工单打印', OPTIONAL: '计划可选附页', SYSTEM_ONLY: '仅系统警示' };
const archiveRequirementModeLabels: Record<InternalQualityRiskArchiveRequirementMode, string> = { REQUIRED: '必填', OPTIONAL: '选填', NOT_APPLICABLE: '不适用' };
const archiveRequirementGroups: Array<{ title: string; hint: string; items: Array<{ key: InternalQualityRiskArchiveRequirementKey; label: string }> }> = [
  { title: '异常分析与闭环', hint: '按这次异常实际复杂度设定', items: [
    { key: 'defectPhenomenon', label: '不良现象' }, { key: 'occurrenceCause', label: '发生原因' }, { key: 'escapeCause', label: '流出原因' },
    { key: 'rootCause', label: '根本原因' }, { key: 'containmentAction', label: '临时遏制' }, { key: 'correctiveAction', label: '纠正措施' },
    { key: 'verificationResult', label: '验证结果' },
  ] },
  { title: '工单警示附页', hint: '空白选填项不展示，不自动补写作业指令', items: [
    { key: 'warningSummary', label: '警示摘要' }, { key: 'requiredAction', label: '本批要求' }, { key: 'inspectionMethod', label: '检查方法' },
    { key: 'inspectionFrequency', label: '检查频次' }, { key: 'acceptanceCriteria', label: '合格判定' }, { key: 'stopConditions', label: '停线条件' },
  ] },
  { title: '来源与证据', hint: '来源问题、照片、附件、摘要或8D', items: [
    { key: 'sourceIssue', label: '来源问题' }, { key: 'evidence', label: '归档证据' },
  ] },
];
const statusLabels: Record<StatusFilter | InternalQualityRiskDTO['status'], string> = {
  ALL: '全部异常', DRAFT: '草稿', SUBMITTED: '待接单', CONTAINMENT: '遏制中', COLLABORATING: '协同中', VERIFYING: '待验证', PENDING_CLOSE: '待关闭', REVISING: '修订中', ARCHIVED: '已归档', UNLINKED: '关联不全', DELETED: '回收站',
};
const workflowOrder: InternalQualityRiskDTO['status'][] = ['DRAFT', 'SUBMITTED', 'COLLABORATING', 'VERIFYING', 'PENDING_CLOSE', 'ARCHIVED'];
const workflowLabel: Record<InternalQualityRiskDTO['status'], string> = {
  DRAFT: '质量发起', SUBMITTED: '异常受理', CONTAINMENT: '现场遏制', COLLABORATING: '部门协同', VERIFYING: '质量验证', PENDING_CLOSE: '待归档', REVISING: '修订协同', ARCHIVED: '归档发布',
};
const activityLabels: Record<string, string> = {
  CREATED: '建立草稿', UPDATED: '更新内容', ARCHIVED: '确认归档', REVISION_STARTED: '启动修订', DELETED: '移入回收站', RESTORED: '恢复异常',
  ALERT_ACKNOWLEDGED: '工单知悉', PRODUCT_RISK_CONFIRMED: '产品风险确认', WORKFLOW_TRANSITIONED: '流程流转', TASK_CREATED: '建立协同任务', TASK_UPDATED: '更新协同任务',
  ATTACHMENT_UPLOADED: '上传异常证据', ATTACHMENT_DELETED: '删除异常证据', WARNING_REVOKED: '撤销产品警示',
};
const formSteps: Array<{ step: FormStep; title: string; hint: string }> = [
  { step: 1, title: '来源与影响', hint: '异常、问题和工单' },
  { step: 2, title: '原因分析', hint: '发生、流出与根因' },
  { step: 3, title: '措施与结论', hint: '遏制、纠正和验证' },
  { step: 4, title: '产品与证据', hint: '产品、8D与预知' },
  { step: 5, title: '警示发布', hint: '现场执行与打印规则' },
];

function dateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

function reportToForm(report: InternalQualityRiskDTO): RiskForm {
  return {
    ownerUserId: report.ownerUserId || '', changeReason: '', printPhotoLayout: report.printPhotoLayout || 'PAIR',
    reportNo: report.reportNo, title: report.title, severity: report.severity, occurrenceDate: dateInput(report.occurrenceDate),
    workshopArea: report.workshopArea || '', processName: report.processName || '', responsibleDepartment: report.responsibleDepartment || '',
    defectPhenomenon: report.defectPhenomenon || '', occurrenceCause: report.occurrenceCause || '', escapeCause: report.escapeCause || '',
    systemCause: report.systemCause || '', rootCause: report.rootCause || '', secondaryCause: report.secondaryCause || '',
    containmentAction: report.containmentAction || '', disposition: report.disposition || '', correctiveAction: report.correctiveAction || '',
    preventiveAction: report.preventiveAction || '', verificationResult: report.verificationResult || '', finalConclusion: report.finalConclusion || '',
    evidenceSummary: report.evidenceSummary || '', riskScope: report.riskScope || '', applicableProcess: report.applicableProcess || '',
    effectiveFrom: dateInput(report.effectiveFrom), effectiveUntil: dateInput(report.effectiveUntil),
    warningSummary: report.warningSummary || '', requiredAction: report.requiredAction || '', inspectionMethod: report.inspectionMethod || '',
    inspectionFrequency: report.inspectionFrequency || '', acceptanceCriteria: report.acceptanceCriteria || '', stopConditions: report.stopConditions || '',
    escalationContact: report.escalationContact || '', printPolicy: report.printPolicy || 'OPTIONAL',
    archiveRequirements: report.archiveRequirements || defaultArchiveRequirements,
    issueIds: report.issues.map(item => item.id), workOrderIds: report.workOrders.map(item => item.id), productIds: report.products.map(item => item.id),
    eightDReportIds: report.eightDReports.map(item => item.id),
  };
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || '请求失败');
  return body;
}

type RiskFilterOption = {
  id: string;
  label: string;
  meta: string;
  searchText: string;
};

const MAX_VISIBLE_FILTER_OPTIONS = 120;

function SearchableRiskFilter({ label, allLabel, searchPlaceholder, value, options, onChange }: {
  label: string;
  allLabel: string;
  searchPlaceholder: string;
  value: string;
  options: RiskFilterOption[];
  onChange: (value: string) => void;
}) {
  const reactId = useId().replace(/:/g, '');
  const listboxId = `risk-filter-list-${reactId}`;
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = useMemo(() => options.find(item => item.id === value) || null, [options, value]);
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const matches = useMemo(() => options.filter(item => !normalizedQuery || item.searchText.toLocaleLowerCase('zh-CN').includes(normalizedQuery)), [normalizedQuery, options]);
  const visible = useMemo(() => matches.slice(0, MAX_VISIBLE_FILTER_OPTIONS), [matches]);
  const navigable = useMemo(() => [{ id: '', label: allLabel, meta: '不限制关联对象', searchText: '' }, ...visible], [allLabel, visible]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  const choose = (nextValue: string): void => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className="risk-filter-field">
    <span>{label}</span>
    <button
      ref={anchorRef}
      className={`risk-filter-trigger ${value ? 'selected' : ''}`}
      type="button"
      role="combobox"
      aria-label={`筛选${label}`}
      aria-expanded={open}
      aria-controls={listboxId}
      onClick={() => setOpen(current => !current)}
    >
      <span><Search size={12} /><em title={selected?.label || allLabel}>{selected?.label || allLabel}</em></span>
      <ChevronDown size={13} />
    </button>
    <PortalMenu
      open={open}
      anchorRef={anchorRef}
      className="risk-filter-popover"
      align="left"
      width={320}
      offset={5}
      closeOnSelect={false}
      role="dialog"
      ariaLabel={`${label}筛选`}
      onClose={() => setOpen(false)}
    >
      <header>
        <label htmlFor={`risk-filter-search-${reactId}`}><Search size={14} />
          <input
            ref={searchRef}
            id={`risk-filter-search-${reactId}`}
            type="search"
            role="combobox"
            aria-label={searchPlaceholder}
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={navigable[activeIndex] ? `${listboxId}-${navigable[activeIndex].id || 'all'}` : undefined}
            autoComplete="off"
            value={query}
            placeholder={searchPlaceholder}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex(current => Math.min(navigable.length - 1, current + 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(current => Math.max(0, current - 1));
              }
              if (event.key === 'Enter' && navigable[activeIndex]) {
                event.preventDefault();
                choose(navigable[activeIndex].id);
              }
            }}
          />
        </label>
        {query && <button type="button" title="清空搜索" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}
      </header>
      <div id={listboxId} className="risk-filter-options hm-scroll-region" role="listbox" aria-label={`${label}选项`}>
        <button
          id={`${listboxId}-all`}
          className={`risk-filter-option ${!value ? 'selected' : ''} ${activeIndex === 0 ? 'active' : ''}`}
          type="button"
          role="option"
          aria-selected={!value}
          onMouseEnter={() => setActiveIndex(0)}
          onClick={() => choose('')}
        >
          <span><strong>{allLabel}</strong><small>不限制关联对象</small></span>{!value && <Check size={14} />}
        </button>
        {visible.map((item, index) => <button
          id={`${listboxId}-${item.id}`}
          className={`risk-filter-option ${value === item.id ? 'selected' : ''} ${activeIndex === index + 1 ? 'active' : ''}`}
          type="button"
          role="option"
          aria-selected={value === item.id}
          key={item.id}
          onMouseEnter={() => setActiveIndex(index + 1)}
          onClick={() => choose(item.id)}
        >
          <span><strong>{item.label}</strong><small>{item.meta}</small></span>{value === item.id && <Check size={14} />}
        </button>)}
        {!visible.length && <p>没有匹配的{label}，请更换关键词</p>}
      </div>
      <footer>
        <span>{normalizedQuery ? `匹配 ${matches.length}` : `显示 ${visible.length}`} / 共 {options.length} 条</span>
        <small>{matches.length > visible.length ? `仅展示前 ${MAX_VISIBLE_FILTER_OPTIONS} 条，请继续输入` : '↑↓ 选择 · Enter 确认'}</small>
      </footer>
    </PortalMenu>
  </div>;
}

function TogglePicker({ title, icon, items, selected, onToggle, emptyText }: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: string; title: string; subtitle: string; badge?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  emptyText: string;
}) {
  const [query, setQuery] = useState('');
  const visible = items.filter(item => !query.trim() || `${item.title} ${item.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="risk-toggle-picker">
    <header><span>{icon}<strong>{title}</strong></span><em>已选 {selected.length}</em></header>
    <label><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${title}`} /></label>
    <div className="hm-scroll-region">
      {visible.map(item => { const checked = selected.includes(item.id); return <button className={checked ? 'checked' : ''} type="button" key={item.id} onClick={() => onToggle(item.id)}>
        <span className="risk-check">{checked && <Check size={12} />}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>{item.badge && <em>{item.badge}</em>}
      </button>; })}
      {!visible.length && <p>{emptyText}</p>}
    </div>
  </section>;
}

function DetailValue({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return <div className={wide ? 'wide' : ''}><span>{label}</span><strong>{value || '未填写'}</strong></div>;
}

function ArchiveRequirementPanel({ value, onChange }: {
  value: InternalQualityRiskArchiveRequirements;
  onChange: (key: InternalQualityRiskArchiveRequirementKey, mode: InternalQualityRiskArchiveRequirementMode) => void;
}) {
  const requiredCount = Object.values(value).filter(mode => mode === 'REQUIRED').length;
  return <section className="risk-requirement-panel">
    <header><span><ShieldAlert size={17} /><strong>归档字段要求</strong><small>每份异常单独设定，不再用同一套九项硬门槛</small></span><em>{requiredCount} 项必填</em></header>
    <div className="risk-requirement-fixed"><CheckCircle2 size={14} /><span><strong>系统固定闭环</strong><small>最终结论 + 至少一个有效产品或工单；未完成的协同任务及重大审批仍会阻断归档。</small></span></div>
    <div className="risk-requirement-groups">{archiveRequirementGroups.map(group => <section key={group.title}><header><strong>{group.title}</strong><small>{group.hint}</small></header><div>{group.items.map(item => <article key={item.key}><span>{item.label}</span><div role="group" aria-label={`${item.label}归档要求`}>{(['REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE'] as const).map(mode => <button className={value[item.key] === mode ? `active mode-${mode.toLowerCase()}` : ''} type="button" key={mode} aria-pressed={value[item.key] === mode} onClick={() => onChange(item.key, mode)}>{archiveRequirementModeLabels[mode]}</button>)}</div></article>)}</div></section>)}</div>
  </section>;
}

export default function InternalQualityRiskShell({ user, initialReportId = '', initialWorkOrderId = '' }: { user: CurrentUserDTO; initialReportId?: string; initialWorkOrderId?: string }) {
  const [reports, setReports] = useState<InternalQualityRiskDTO[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [options, setOptions] = useState(emptyOptions);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [severity, setSeverity] = useState<'ALL' | InternalQualityRiskSeverity>('ALL');
  const [keyword, setKeyword] = useState('');
  const [problemCategory, setProblemCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [intakeDraft, setIntakeDraft] = useState<InternalQualityRiskDTO | null>(null);
  const [productId, setProductId] = useState('');
  const [issueId, setIssueId] = useState('');
  const [workOrderId, setWorkOrderId] = useState(initialWorkOrderId);
  const [selectedId, setSelectedId] = useState(initialReportId);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [publishWarning, setPublishWarning] = useState(true);
  const [purgeReason, setPurgeReason] = useState('');
  const [formStep, setFormStep] = useState<FormStep>(1);
  const [editing, setEditing] = useState<InternalQualityRiskDTO | null>(null);
  const [form, setForm] = useState<RiskForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [archivePreview, setArchivePreview] = useState<PreviewResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InternalQualityRiskDTO | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<RiskTaskForm>(emptyTaskForm);
  const [taskError, setTaskError] = useState('');
  const [attachmentCategory, setAttachmentCategory] = useState<InternalQualityRiskAttachmentDTO['category']>('EVIDENCE');
  const [pendingAttachments, setPendingAttachments] = useState<PendingRiskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<InternalQualityRiskAttachmentDTO | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<InternalQualityRiskDTO | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const requestSequence = useRef(0);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const draftAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  useToastBridge(toast, setToast);

  const isAdmin = user.laborRole === 'ADMIN' || user.access.capabilities.includes('ACCOUNT_ADMIN:MANAGE');
  const canCreate = user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:CREATE');
  const canUpdate = user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE');
  const canArchive = user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW');

  const loadOptions = useCallback(async () => {
    try {
      const body = await jsonRequest<InternalQualityRiskOptionsDTO & { ok: boolean; error?: string }>('/api/quality/internal-risks/options');
      setOptions({ products: body.products || [], issues: body.issues || [], workOrders: body.workOrders || [], eightDReports: body.eightDReports || [], assignees: body.assignees || [] });
    } catch (loadError) {
      setToast(loadError instanceof Error ? loadError.message : '关联选项加载失败');
    }
  }, []);

  const loadReports = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status: status === 'ALL' ? 'all' : status, limit: '400' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (problemCategory) params.set('problemCategory', problemCategory);
      if (department) params.set('department', department);
      if (severity !== 'ALL') params.set('severity', severity);
      if (productId) params.set('productId', productId);
      if (issueId) params.set('issueId', issueId);
      if (workOrderId) params.set('workOrderId', workOrderId);
      const body = await jsonRequest<ListResponse>(`/api/quality/internal-risks?${params.toString()}`);
      if (requestSequence.current !== sequence) return;
      const next = body.reports || [];
      setReports(next);
      setSummary(body.summary || emptySummary);
      setSelectedId(current => next.some(item => item.id === current) ? current : next[0]?.id || '');
    } catch (loadError) {
      if (requestSequence.current === sequence) setError(loadError instanceof Error ? loadError.message : '内部重大异常加载失败');
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [issueId, keyword, productId, severity, status, workOrderId, problemCategory, department]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadReports(); }, 180); return () => window.clearTimeout(timer); }, [loadReports]);

  const selected = useMemo(() => reports.find(report => report.id === selectedId) || null, [reports, selectedId]);
  const activeAlertCount = selected?.alerts.filter(alert => alert.state === 'ACTIVE' || alert.state === 'ACKNOWLEDGED').length || 0;

  function updateReport(report: InternalQualityRiskDTO): void {
    setReports(current => current.some(item => item.id === report.id) ? current.map(item => item.id === report.id ? report : item) : [report, ...current]);
    setSelectedId(report.id);
  }

  function toggleFormRelation(field: 'issueIds' | 'workOrderIds' | 'productIds' | 'eightDReportIds', id: string): void {
    setForm(current => ({ ...current, [field]: current[field].includes(id) ? current[field].filter(item => item !== id) : [...current[field], id] }));
  }

  function openCreate(): void { setIntakeDraft(null); setInitiateOpen(true); }

  function openEdit(report = selected): void {
    if (!report || report.status === 'ARCHIVED' || report.deletedAt) return;
    setEditing(report);
    setForm(reportToForm(report));
    setFormStep(1);
    setFormError('');
    setPendingAttachments([]);
    setFormOpen(true);
  }

  function stageAttachments(files: FileList | null): void {
    if (!files?.length) return;
    const incoming = Array.from(files).map(file => ({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${file.name}-${file.lastModified}-${file.size}`,
      file,
      category: attachmentCategory,
    }));
    setPendingAttachments(current => {
      const known = new Set(current.map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      return [...current, ...incoming.filter(item => !known.has(`${item.file.name}:${item.file.size}:${item.file.lastModified}`))].slice(0, 20);
    });
    if (draftAttachmentInputRef.current) draftAttachmentInputRef.current.value = '';
  }

  async function uploadAttachmentToReport(reportId: string, attachment: PendingRiskAttachment): Promise<InternalQualityRiskDTO> {
    const body = new FormData();
    body.set('file', attachment.file);
    body.set('category', attachment.category);
    body.set('displayName', attachment.file.name);
    const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${reportId}/attachments`, { method: 'POST', body });
    if (!result.report) throw new Error(`${attachment.file.name} 上传结果为空`);
    return result.report;
  }

  async function saveReport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.reportNo.trim() || !form.title.trim()) { setFormError('请填写异常汇总编号和标题'); setFormStep(1); return; }
    setSaving(true);
    setFormError('');
    try {
      const body = editing ? { ...form, expectedVersion: editing.version } : form;
      const result = await jsonRequest<MutationResponse>(editing ? `/api/quality/internal-risks/${editing.id}` : '/api/quality/internal-risks', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!result.report) throw new Error('保存结果为空');
      let savedReport = result.report;
      const failedAttachments: PendingRiskAttachment[] = [];
      for (const attachment of pendingAttachments) {
        try {
          savedReport = await uploadAttachmentToReport(savedReport.id, attachment);
        } catch (uploadError) {
          failedAttachments.push({
            ...attachment,
            error: uploadError instanceof Error ? uploadError.message : '附件上传失败',
          });
        }
      }
      updateReport(savedReport);
      if (failedAttachments.length) {
        setEditing(savedReport);
        setForm(reportToForm(savedReport));
        setPendingAttachments(failedAttachments);
        setFormStep(3);
        const failureSummary = failedAttachments.slice(0, 2).map(item => `${item.file.name}：${item.error || '上传失败'}`).join('；');
        setFormError(`草稿已保存，${pendingAttachments.length - failedAttachments.length} 个附件已上传，${failedAttachments.length} 个失败。${failureSummary}`);
        setToast('异常草稿已保存，部分附件仍需重试');
        void loadReports();
        return;
      }
      setPendingAttachments([]);
      setFormOpen(false);
      setToast(pendingAttachments.length
        ? `${editing ? '异常汇总草稿已更新' : '内部重大异常草稿已建立'}，${pendingAttachments.length} 个附件已上传到对象存储`
        : editing ? '异常汇总草稿已更新' : '内部重大异常草稿已建立');
      void loadReports();
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally { setSaving(false); }
  }

  async function previewArchive(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await jsonRequest<PreviewResponse>(`/api/quality/internal-risks/${selected.id}/archive-preview`, { method: 'POST' });
      setPublishWarning(true);
      setArchivePreview(result);
    } catch (previewError) { setToast(previewError instanceof Error ? previewError.message : '归档检查失败'); }
    finally { setSaving(false); }
  }

  async function confirmArchive(): Promise<void> {
    if (!archivePreview?.report || !archivePreview.readiness.ready) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${archivePreview.report.id}/archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: archivePreview.report.version, publishWarning }),
      });
      if (!result.report) throw new Error('归档结果为空');
      updateReport(result.report);
      setArchivePreview(null);
      setToast(publishWarning ? `R${result.report.currentRevisionNumber || ''} 已归档并发布产品警示` : `R${result.report.currentRevisionNumber || ''} 已归档留存，未发布现场警示`);
      void loadReports();
    } catch (archiveError) { setToast(archiveError instanceof Error ? archiveError.message : '归档失败'); }
    finally { setSaving(false); }
  }

  async function startRevision(): Promise<void> {
    if (!selected) return;
    if (!window.confirm('启动修订后可修改当前内容；上一归档版本的工单预警会继续有效，直到新版本归档。继续吗？')) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/revise`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selected.version }),
      });
      if (!result.report) throw new Error('启动修订结果为空');
      updateReport(result.report);
      setToast('已启动修订，上一归档预警继续有效');
    } catch (revisionError) { setToast(revisionError instanceof Error ? revisionError.message : '启动修订失败'); }
    finally { setSaving(false); }
  }

  async function transitionWorkflow(targetStatus: InternalQualityRiskDTO['status']): Promise<void> {
    if (!selected || selected.deletedAt || targetStatus === 'ARCHIVED') return;
    const needsNote = targetStatus === 'PENDING_CLOSE' || (selected.status === 'VERIFYING' && targetStatus === 'COLLABORATING');
    const note = needsNote ? window.prompt(targetStatus === 'PENDING_CLOSE' ? '请填写本次质量验证结论：' : '请说明退回原因：', '')?.trim() : '';
    if (needsNote && !note) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/workflow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selected.version, status: targetStatus, note }),
      });
      if (!result.report) throw new Error('流程流转结果为空');
      updateReport(result.report);
      setToast(`异常已进入“${workflowLabel[targetStatus]}”阶段`);
      void loadReports();
    } catch (transitionError) { setToast(transitionError instanceof Error ? transitionError.message : '流程流转失败'); }
    finally { setSaving(false); }
  }

  async function createTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !taskForm.title.trim() || !taskForm.department.trim()) { setTaskError('请填写任务标题和责任部门'); return; }
    setSaving(true); setTaskError('');
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/tasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskForm),
      });
      if (!result.report) throw new Error('协同任务建立结果为空');
      updateReport(result.report); setTaskOpen(false); setTaskForm(emptyTaskForm); setDetailTab('collaboration');
      setToast('协同任务已建立并进入部门协同');
    } catch (taskCreateError) { setTaskError(taskCreateError instanceof Error ? taskCreateError.message : '协同任务建立失败'); }
    finally { setSaving(false); }
  }

  async function uploadAttachment(file: File): Promise<void> {
    if (!selected) return;
    setUploading(true);
    try {
      const report = await uploadAttachmentToReport(selected.id, { id: `${file.name}-${file.lastModified}`, file, category: attachmentCategory });
      updateReport(report); setDetailTab('warning'); setToast('异常证据已安全上传到对象存储');
    } catch (uploadError) { setToast(uploadError instanceof Error ? uploadError.message : '异常证据上传失败'); }
    finally { setUploading(false); if (attachmentInputRef.current) attachmentInputRef.current.value = ''; }
  }

  async function removeAttachment(attachment: InternalQualityRiskAttachmentDTO): Promise<void> {
    if (!selected || !window.confirm(`删除附件“${attachment.displayName}”？该操作为软删除，审计记录会保留。`)) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/attachments/${attachment.id}`, { method: 'DELETE' });
      if (!result.report) throw new Error('附件删除结果为空');
      updateReport(result.report); setPreviewAttachment(null); setToast('附件已软删除');
    } catch (removeError) { setToast(removeError instanceof Error ? removeError.message : '附件删除失败'); }
    finally { setSaving(false); }
  }

  async function revokeWarning(): Promise<void> {
    if (!selected || !revokeReason.trim()) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/warning/revoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selected.version, reason: revokeReason }),
      });
      if (!result.report) throw new Error('警示撤销结果为空');
      updateReport(result.report); setRevokeOpen(false); setRevokeReason(''); setToast('产品警示已撤销，关联工单不再显示活动警示');
      void loadReports();
    } catch (revokeError) { setToast(revokeError instanceof Error ? revokeError.message : '产品警示撤销失败'); }
    finally { setSaving(false); }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || !deleteReason.trim()) return;
    setSaving(true);
    try {
      await jsonRequest<{ ok: boolean }>(`/api/quality/internal-risks/${deleteTarget.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: deleteTarget.version, reason: deleteReason }),
      });
      setDeleteTarget(null); setDeleteReason(''); setSelectedId(''); setToast('异常汇总已移入回收站；已撤销的警示不会自动重发'); void loadReports();
    } catch (deleteError) { setToast(deleteError instanceof Error ? deleteError.message : '删除失败'); }
    finally { setSaving(false); }
  }

  async function restoreReport(): Promise<void> {
    if (!selected?.deletedAt) return;
    setSaving(true);
    try {
      const result = await jsonRequest<MutationResponse>(`/api/quality/internal-risks/${selected.id}/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selected.version }),
      });
      if (!result.report) throw new Error('恢复结果为空');
      setStatus('ALL'); updateReport(result.report); setToast('异常汇总已恢复；已撤销的产品警示保持撤销状态');
    } catch (restoreError) { setToast(restoreError instanceof Error ? restoreError.message : '恢复失败'); }
    finally { setSaving(false); }
  }

  async function purgeReport(): Promise<void> {
    if (!purgeTarget || purgeConfirmation !== purgeTarget.reportNo) return;
    setSaving(true);
    try {
      const result = await jsonRequest<{ ok: boolean; cleanup?: { pending: number } }>(`/api/quality/internal-risks/${purgeTarget.id}/purge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: purgeConfirmation, reason: purgeReason }),
      });
      setPurgeTarget(null); setPurgeConfirmation(''); setSelectedId(''); setToast(result.cleanup?.pending ? `记录已删除；${result.cleanup.pending} 项附件待清理，可点击“重试附件清理”` : '异常汇总已彻底删除，操作日志仍保留'); void loadReports();
    } catch (purgeError) { setToast(purgeError instanceof Error ? purgeError.message : '彻底删除失败'); }
    finally { setSaving(false); }
  }

  async function retryCleanup() {
    setSaving(true);
    try {
      const result = await jsonRequest<{ completed: number; pending: number }>('/api/quality/internal-risks/cleanup', { method: 'POST' });
      setToast(`本次清理 ${result.completed} 项，剩余 ${result.pending} 项`);
    } catch (error) { setToast(error instanceof Error ? error.message : '清理重试失败'); }
    finally { setSaving(false); }
  }

  const statusItems: Array<[StatusFilter, number]> = [
    ['ALL', summary.total], ['DRAFT', summary.draft], ['SUBMITTED', summary.submitted], ['COLLABORATING', summary.collaborating], ['VERIFYING', summary.verifying], ['PENDING_CLOSE', summary.pendingClose], ['ARCHIVED', summary.archived], ['DELETED', summary.deleted],
  ];
  const issuePickerItems = options.issues.map(item => ({ id: item.id, title: `${item.code} · ${item.title}`, subtitle: `${item.workOrder?.displayCode || '未关联工单'} · ${item.status}`, badge: item.isMajorQuality ? (item.majorApprovalStatus === 'APPROVED' ? '重大·已批' : '重大·待批') : undefined }));
  const workOrderPickerItems = options.workOrders.map(item => ({ id: item.id, title: item.displayCode, subtitle: `${item.customerName || '客户未填'} · ${item.productName || '品名未填'}`, badge: item.planActive ? '当前' : '历史' }));
  const productPickerItems = options.products.map(item => ({ id: item.id, title: item.specification || item.productName || '未命名产品', subtitle: `${item.customerName || '客户未填'}${item.productName ? ` · ${item.productName}` : ''}` }));
  const eightDPickerItems = options.eightDReports.map(item => ({ id: item.id, title: item.reportNo, subtitle: `${item.title} · ${item.status === 'active' ? '在用' : '已归档'}` }));
  const productFilterItems = options.products.map(item => ({
    id: item.id,
    label: item.specification || item.productName || '未命名产品',
    meta: `${item.customerName || '客户未填'}${item.productName ? ` · ${item.productName}` : ''}`,
    searchText: `${item.specification || ''} ${item.productName || ''} ${item.customerName || ''} ${item.customerCode || ''}`,
  }));
  const issueFilterItems = options.issues.map(item => ({
    id: item.id,
    label: `${item.code} · ${item.title}`,
    meta: `${item.workOrder?.displayCode || '未关联工单'} · ${item.status}`,
    searchText: `${item.code} ${item.title} ${item.workOrder?.displayCode || ''} ${item.status}`,
  }));
  const workOrderFilterItems = options.workOrders.map(item => ({
    id: item.id,
    label: item.displayCode,
    meta: `${item.customerName || '客户未填'} · ${item.productName || '品名未填'}${item.specification ? ` · ${item.specification}` : ''}`,
    searchText: `${item.displayCode} ${item.code} ${item.businessCode || ''} ${item.customerName || ''} ${item.productName || ''} ${item.specification || ''}`,
  }));
  const completedTaskCount = selected?.tasks.filter(item => item.status === 'VERIFIED' || item.status === 'CANCELLED').length || 0;
  const workflowActiveIndex = selected ? (['REVISING', 'CONTAINMENT'].includes(selected.status) ? 2 : workflowOrder.indexOf(selected.status)) : -1;
  const nextWorkflowActions = selected ? ({
    DRAFT: [{ status: 'SUBMITTED' as const, label: '提交异常' }],
    SUBMITTED: [{ status: 'CONTAINMENT' as const, label: '需要现场遏制（按需）' }, { status: 'COLLABORATING' as const, label: '直接发起协同' }],
    CONTAINMENT: [{ status: 'COLLABORATING' as const, label: '进入部门协同' }],
    COLLABORATING: [{ status: 'VERIFYING' as const, label: '提交质量验证' }],
    VERIFYING: [{ status: 'PENDING_CLOSE' as const, label: '验证通过，待归档' }, { status: 'COLLABORATING' as const, label: '退回协同' }],
    PENDING_CLOSE: [{ status: 'COLLABORATING' as const, label: '退回整改' }],
    REVISING: [{ status: 'COLLABORATING' as const, label: '进入修订协同' }, { status: 'VERIFYING' as const, label: '提交修订验证' }, { status: 'PENDING_CLOSE' as const, label: '修订待归档' }],
    ARCHIVED: [],
  }[selected.status] || []) : [];

  return <main className="hm-workbench-root hm-cockpit-root internal-risk-shell">
    {initiateOpen && <QualityRiskInitiateDialog initialReport={intakeDraft} options={options} initialProductId={productId} onClose={() => setInitiateOpen(false)} onSaved={report => { updateReport(report); void loadReports(); }} />}
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality/internal-risks" subtitle="车间重大不良闭环与工单风险预知" menuItems={[]} hideHeader sidebarTriggerTargetId="internal-risk-navigation-trigger" />
    <div className="internal-risk-frame">
      <WorkbenchCockpitCommand
        navigationTargetId="internal-risk-navigation-trigger"
        icon={<ShieldAlert size={20} />}
        title="重大异常协同中心"
        subtitle="产品关联 / 质量发起 / 部门协同 / 归档沉淀 / 现场警示"
        context={<><span>{summary.submitted} 条待接单</span><span>{summary.collaborating} 条协同中</span><span>{summary.activeAlerts} 条已同步警示</span><span>{summary.overdueTasks} 项任务逾期</span></>}
        search={<label className="internal-risk-search"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、标题、原因、结论、产品或工单" />{keyword && <button type="button" onClick={() => setKeyword('')}><X size={13} /></button>}</label>}
        actions={<>{isAdmin && status === 'DELETED' && <button type="button" disabled={saving} onClick={() => void retryCleanup()}><RefreshCw size={15} />重试附件清理</button>}<button className="icon-only" type="button" title="刷新" disabled={loading} onClick={() => { void Promise.all([loadReports(), loadOptions()]); }}><RefreshCw className={loading ? 'spin' : ''} size={16} /></button>{canCreate && <button className="primary" type="button" onClick={openCreate}><Plus size={16} />质量发起异常</button>}</>}
      />
      <QualityModuleTabs active="internal-risks" riskCount={summary.total} canViewData={user.access.capabilities.includes('QUALITY_DATA:READ')} />
      <section className="internal-risk-status hm-cockpit-stage-rail" aria-label="异常汇总状态">
        {statusItems.map(([key, count]) => <button className={status === key ? 'active' : ''} type="button" key={key} onClick={() => setStatus(key)}><span>{statusLabels[key]}</span><strong>{count}</strong></button>)}
      </section>
      <section className="internal-risk-workspace">
        <aside className="risk-filter-panel">
          <header><div><Link2 size={15} /><strong>风险筛选</strong></div>{(severity !== 'ALL' || productId || issueId || workOrderId) && <button type="button" onClick={() => { setSeverity('ALL'); setProductId(''); setIssueId(''); setWorkOrderId(''); }}>清空</button>}</header>
          <section><strong>风险等级</strong><div className="risk-severity-filter">{(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(key => <button className={severity === key ? 'active' : ''} type="button" key={key} onClick={() => setSeverity(key)}><span className={`severity-dot severity-${key.toLowerCase()}`} />{key === 'ALL' ? '全部等级' : severityLabels[key]}</button>)}</div></section>
          <section className="risk-select-filters">
            <label>问题归属<select value={problemCategory} onChange={event => setProblemCategory(event.target.value)}><option value="">全部归属</option>{QUALITY_PROBLEM_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label>问题归属部门<select value={department} onChange={event => setDepartment(event.target.value)}><option value="">全部部门</option>{QUALITY_PROBLEM_CATEGORIES.map(item => <option value={item.department} key={item.id}>{item.department}</option>)}</select></label>
            <Link href="/workspace/quality-tasks">我的待处理任务</Link><Link href="/workspace/quality-confirmation">品质确认</Link>
            <strong>关联对象</strong>
            <SearchableRiskFilter label="产品" allLabel="全部产品" searchPlaceholder="搜索规格、品名或客户" value={productId} options={productFilterItems} onChange={setProductId} />
            <SearchableRiskFilter label="来源问题" allLabel="全部问题" searchPlaceholder="搜索问题编号、标题或工单" value={issueId} options={issueFilterItems} onChange={setIssueId} />
            <SearchableRiskFilter label="工单" allLabel="全部工单" searchPlaceholder="搜索工单号、产品、规格或客户" value={workOrderId} options={workOrderFilterItems} onChange={setWorkOrderId} />
          </section>
          <section className="risk-rule-card"><Sparkles size={16} /><div><strong>产品预知规则</strong><p>归档警示按产品主数据自动投影到现有及未来工单；知悉不解除警示，生产计划与执行同步显示。</p></div></section>
          <section className="risk-delete-rule"><Archive size={15} /><div><strong>管理员回收规则</strong><p>所有异常均可软删除；活动产品警示必须先单独撤销并记录原因，未形成归档和打印历史的记录可立即彻底删除；正式历史保留追溯。</p></div></section>
        </aside>
        <section className="risk-queue">
          <header><div><strong>{statusLabels[status]}</strong><span>{reports.length}</span></div><small>最近更新优先</small></header>
          <div className="risk-queue-list hm-scroll-region">
            {loading && <div className="risk-empty"><Loader2 className="spin" /><strong>正在加载异常汇总</strong></div>}
            {!loading && error && <div className="risk-empty error"><AlertTriangle /><strong>{error}</strong><button type="button" onClick={() => { void loadReports(); }}>重试</button></div>}
            {!loading && !error && !reports.length && <div className="risk-empty"><ShieldAlert /><strong>当前条件下没有异常汇总</strong><p>可调整筛选或建立一份车间重大异常草稿。</p>{canCreate && <button type="button" onClick={openCreate}>新建异常汇总</button>}</div>}
            {!loading && reports.map(report => <button className={`risk-card ${selectedId === report.id ? 'active' : ''} ${report.deletedAt ? 'deleted' : ''}`} type="button" key={report.id} onClick={() => setSelectedId(report.id)}>
              <header><span className={`risk-status status-${report.deletedAt ? 'deleted' : report.status.toLowerCase()}`}>{report.deletedAt ? '回收站' : statusLabels[report.status]}</span><em className={`risk-severity severity-${report.severity.toLowerCase()}`}>{severityLabels[report.severity]}</em></header>
              <strong>{report.reportNo}</strong><h3>{report.title}</h3><p>{report.defectPhenomenon || '不良现象待完善'}</p>
              <div><span><ClipboardCheck size={11} />{report.issues.length} 问题</span><span><Users size={11} />{report.tasks.length} 任务</span><span><Boxes size={11} />{report.products.length} 产品</span></div>
              <footer><span>{report.warningState === 'ACTIVE' ? `已发布警示 · ${printPolicyLabels[report.printPolicy]}` : report.currentRevisionNumber ? `R${report.currentRevisionNumber} · ${report.warningState}` : '未归档'}</span><time>{formatDate(report.updatedAt, true)}</time></footer>
              {selectedId === report.id && <ChevronRight className="selected-arrow" size={16} />}
            </button>)}
          </div>
        </section>
        <section className="risk-detail">
          {!selected ? <div className="risk-detail-empty"><ShieldAlert /><h2>选择一份内部重大异常</h2><p>查看原因、措施、关联、归档版本与工单预警。</p></div> : <>
            <header className="risk-detail-header"><div><span>{selected.reportNo} · {severityLabels[selected.severity]}</span><h2>{selected.title}</h2><small>{selected.workshopArea || '车间未填'} · {selected.processName || '工序未填'} · 更新于 {formatDate(selected.updatedAt, true)}</small></div><nav>
              {selected.deletedAt ? <>{isAdmin && <button type="button" disabled={saving} onClick={() => { void restoreReport(); }}><RotateCcw size={14} />恢复</button>}{isAdmin && <button className="danger" type="button" disabled={saving} title="查看彻底删除条件" onClick={() => { setPurgeTarget(selected); setPurgeConfirmation(''); setPurgeReason(''); }}><Trash2 size={14} />彻底删除</button>}</> : <>
                <Link className="print-preview" href={`/workspace/quality/internal-risks/${encodeURIComponent(selected.id)}/print-preview`} target="_blank"><Printer size={14} />工单附页预览</Link>
                {selected.status === 'ARCHIVED' && canArchive && <button type="button" disabled={saving} onClick={() => { void startRevision(); }}><History size={14} />启动修订</button>}
                {(selected.status === 'PENDING_CLOSE' || selected.status === 'REVISING') && canArchive && <button className="archive" type="button" disabled={saving} onClick={() => { void previewArchive(); }}><Archive size={14} />归档发布</button>}
                {selected.warningState === 'ACTIVE' && canArchive && <button className="warning-revoke" type="button" disabled={saving} title="撤销产品警示后才可回收异常" onClick={() => { setRevokeOpen(true); setRevokeReason(''); }}><Ban size={14} />撤销警示</button>}
                {isAdmin && <button className="danger icon" type="button" disabled={saving || selected.warningState === 'ACTIVE'} title={selected.warningState === 'ACTIVE' ? '请先撤销活动产品警示' : '移入回收站'} onClick={() => { setDeleteTarget(selected); setDeleteReason(''); }}><Trash2 size={14} /></button>}
              </>}
            </nav></header>
            <div className="risk-detail-tabs" role="tablist">{([['overview', '处理流程'], ['warning', '警示与证据'], ['relations', '关联对象'], ['archive', '归档同步']] as Array<[DetailTab, string]>).map(([key, label]) => <button className={detailTab === key ? 'active' : ''} type="button" key={key} onClick={() => setDetailTab(key)}>{label}{key === 'collaboration' && <em>{selected.tasks.length}</em>}{key === 'warning' && <em>{selected.attachments.length}</em>}{key === 'relations' && <em>{selected.issues.length + selected.workOrders.length + selected.products.length + selected.eightDReports.length}</em>}{key === 'archive' && <em>{selected.revisions.length}</em>}</button>)}</div>
            <div className="risk-detail-body hm-scroll-region">
              {['overview', 'collaboration', 'causes', 'actions'].includes(detailTab) ? <QualityWorkflowPanel key={selected.id} report={selected} user={user} users={options.assignees || []} onUpdated={updateReport} onEditDraft={() => { setIntakeDraft(selected); setInitiateOpen(true); }} /> : <>
              {detailTab === 'overview' && <>
                <section className={`risk-hero severity-${selected.severity.toLowerCase()}`}><div><span>{selected.deletedAt ? '已进入回收站' : `${statusLabels[selected.status]} · ${selected.warningState === 'ACTIVE' ? '产品警示已发布' : '警示未发布'}`}</span><h3>{selected.defectPhenomenon || '不良现象待完善'}</h3><p>{selected.riskScope || '风险影响范围待填写'}</p></div><dl><div><dt>协同任务</dt><dd>{completedTaskCount}/{selected.tasks.length}</dd></div><div><dt>覆盖工单</dt><dd>{selected.workOrders.length}</dd></div><div><dt>活动预警</dt><dd>{activeAlertCount}</dd></div></dl></section>
                <section className="risk-workflow-card"><header><div><CircleDot size={15} /><strong>异常协同处理流程</strong></div><span>每个阶段均写入审计活动</span></header><div className="risk-workflow-line">{workflowOrder.map((item, index) => { const current = selected.status === item || (['REVISING', 'CONTAINMENT'].includes(selected.status) && item === 'COLLABORATING'); const done = selected.status === 'ARCHIVED' || index < workflowActiveIndex; return <article className={`${current ? 'current' : ''} ${done ? 'done' : ''}`} key={item}><b>{done ? <Check size={13} /> : index + 1}</b><span><strong>{workflowLabel[item]}</strong><small>{item === 'COLLABORATING' ? `${selected.tasks.length} 项任务` : item === 'ARCHIVED' ? `R${selected.currentRevisionNumber || '—'}` : statusLabels[item]}</small></span></article>; })}</div>{!selected.deletedAt && canArchive && nextWorkflowActions.length > 0 && <footer>{nextWorkflowActions.map(action => <button className={action.status === 'COLLABORATING' && selected.status === 'VERIFYING' ? '' : 'primary'} type="button" disabled={saving} key={action.status} onClick={() => { void transitionWorkflow(action.status); }}>{action.status === 'SUBMITTED' ? <Send size={14} /> : <ChevronRight size={14} />}{action.label}</button>)}</footer>}</section>
                <section className="risk-overview-panels"><article><header><strong>产品与工单覆盖</strong><span>一对多自动继承</span></header><div><b>{selected.products.length}</b><small>关联产品</small><b>{selected.workOrders.length}</b><small>现有工单</small><b>{selected.alerts.length}</b><small>警示投影</small></div><p>归档后，同产品新工单首次进入计划或执行时会自动物化警示，无需逐单确认。</p></article><article><header><strong>现场警示策略</strong><span className={`warning-state state-${selected.warningState.toLowerCase()}`}>{selected.warningState}</span></header><h4>{selected.warningSummary || '警示摘要待完善'}</h4><p>{selected.requiredAction || '现场必须执行内容待完善'}</p><footer>{printPolicyLabels[selected.printPolicy]}</footer></article></section>
                <section className="risk-info-grid"><DetailValue label="发生日期" value={formatDate(selected.occurrenceDate)} /><DetailValue label="发现区域" value={selected.workshopArea} /><DetailValue label="涉及工序" value={selected.processName} /><DetailValue label="责任部门" value={selected.responsibleDepartment} /><DetailValue label="适用工序/检查点" value={selected.applicableProcess} wide /><DetailValue label="有效期" value={`${formatDate(selected.effectiveFrom)} → ${selected.effectiveUntil ? formatDate(selected.effectiveUntil) : '长期有效'}`} wide /></section>
              </>}
              {detailTab === 'collaboration' && <div className="risk-collaboration-view">
                <section className="risk-collaboration-summary"><div><Users size={22} /><span><strong>{selected.tasks.length} 项跨部门任务</strong><small>{completedTaskCount} 项已验证 · {selected.tasks.filter(item => item.dueAt && new Date(item.dueAt) < new Date() && !['VERIFIED', 'CANCELLED'].includes(item.status)).length} 项逾期</small></span></div>{canUpdate && selected.status !== 'ARCHIVED' && !selected.deletedAt && <button className="primary" type="button" onClick={() => { setTaskForm(emptyTaskForm); setTaskError(''); setTaskOpen(true); }}><Plus size={14} />新增协同任务</button>}</section>
                <section className="risk-task-list">{selected.tasks.map(task => { const overdue = Boolean(task.dueAt && new Date(task.dueAt) < new Date() && !['VERIFIED', 'CANCELLED'].includes(task.status)); return <article className={`task-${task.status.toLowerCase()} ${overdue ? 'overdue' : ''}`} key={task.id}><header><div><span>{taskTypeLabels[task.taskType]}</span><strong>{task.title}</strong></div><em>{taskStatusLabels[task.status]}</em></header><dl><div><dt>责任部门</dt><dd>{task.department}</dd></div><div><dt>负责人</dt><dd>{task.ownerName || '待指派'}</dd></div><div><dt>截止</dt><dd>{task.dueAt ? formatDate(task.dueAt) : '未设置'}</dd></div><div><dt>证据</dt><dd>{task.attachmentCount} 份</dd></div></dl><p>{task.requirement || '未填写任务要求'}</p>{task.result && <blockquote><b>处理结果</b>{task.result}</blockquote>}{!selected.deletedAt && selected.status !== 'ARCHIVED' && <QualityTaskActions reportId={selected.id} task={task} canManage={canUpdate} canVerify={canArchive} canHandle={canUpdate || task.ownerUserId === user.id} users={options.assignees || []} onUpdated={updateReport} />}</article>; })}{!selected.tasks.length && <div className="risk-empty compact"><Users /><strong>尚未建立协同任务</strong><p>按责任部门拆分遏制、原因、改善和验证任务，支持并行推进。</p></div>}</section>
              </div>}
              {detailTab === 'warning' && <div className="risk-warning-view">
                <section className={`risk-warning-banner state-${selected.warningState.toLowerCase()}`}><div><ShieldAlert size={24} /><span><strong>{selected.warningState === 'ACTIVE' ? '产品异常警示正在生效' : selected.warningState === 'REVOKED' ? '产品异常警示已撤销' : '产品异常警示尚未发布'}</strong><small>{selected.warningState === 'ACTIVE' ? `已覆盖 ${selected.alerts.length} 条工单，并持续匹配未来同产品工单` : selected.warningRevokeReason || '完成协同、质量验证与归档后自动发布'}</small></span></div><em>{printPolicyLabels[selected.printPolicy]}</em></section>
                <section className="risk-warning-content"><header><strong>现场执行卡</strong><span>归档后同步到图纸库、计划、执行与打印附页</span></header><div><DetailValue label="警示摘要" value={selected.warningSummary} wide /><DetailValue label="必须执行" value={selected.requiredAction} wide /><DetailValue label="检查方法" value={selected.inspectionMethod} /><DetailValue label="检查频次" value={selected.inspectionFrequency} /><DetailValue label="合格判定" value={selected.acceptanceCriteria} /><DetailValue label="停线/升级条件" value={selected.stopConditions} /><DetailValue label="升级联系人" value={selected.escalationContact} /><DetailValue label="打印策略" value={printPolicyLabels[selected.printPolicy]} /></div></section>
                <section className="risk-evidence-board"><header><div><FileImage size={15} /><span><strong>图文证据与解决方案</strong><small>照片、检验数据、处理前后对比及解决方案文件均存入对象存储</small></span></div>{canUpdate && selected.status !== 'ARCHIVED' && !selected.deletedAt && <div className="risk-evidence-upload"><select aria-label="证据分类" value={attachmentCategory} onChange={event => setAttachmentCategory(event.target.value as InternalQualityRiskAttachmentDTO['category'])}><option value="DEFECT">异常实物</option><option value="CAUSE">原因证据</option><option value="ACTION">措施证据</option><option value="VERIFICATION">验证证据</option><option value="SOLUTION">解决方案</option><option value="EVIDENCE">其他证据</option></select><input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); }} /><button type="button" disabled={uploading} onClick={() => attachmentInputRef.current?.click()}>{uploading ? <Loader2 className="spin" size={14} /> : <UploadCloud size={14} />}上传证据</button></div>}</header><div>{selected.attachments.map(attachment => <article key={attachment.id}>{attachment.mimeType.startsWith('image/') ? <button className="risk-evidence-thumb" type="button" onClick={() => setPreviewAttachment(attachment)}><img src={attachment.contentUrl} alt={attachment.caption || attachment.displayName} /></button> : <button className="risk-evidence-file" type="button" onClick={() => setPreviewAttachment(attachment)}><Paperclip size={26} /><span>{attachment.mimeType.split('/').pop()?.toUpperCase()}</span></button>}<section><span>{attachment.category}</span><strong title={attachment.displayName}>{attachment.displayName}</strong><small>{Math.max(1, Math.round(attachment.fileSize / 1024))} KB · {formatDate(attachment.createdAt, true)}</small></section><footer><button type="button" title="预览" onClick={() => setPreviewAttachment(attachment)}><Eye size={13} /></button>{canUpdate && selected.status !== 'ARCHIVED' && <button className="danger" type="button" title="删除附件" onClick={() => { void removeAttachment(attachment); }}><Trash2 size={13} /></button>}</footer>{canUpdate && selected.status !== 'ARCHIVED' && !selected.deletedAt && <QualityEvidencePrintEditor report={selected} attachment={attachment} onUpdated={updateReport} />}</article>)}{!selected.attachments.length && <div className="risk-empty compact"><Camera /><strong>尚无现场图文证据</strong><p>上传异常实物、测量过程、改善前后对比或解决方案文件。</p></div>}</div></section>
              </div>}
              {detailTab === 'causes' && <div className="risk-text-grid"><section><span>发生原因</span><p>{selected.occurrenceCause || '未填写'}</p></section><section><span>流出原因</span><p>{selected.escapeCause || '未填写'}</p></section><section><span>根本原因</span><p>{selected.rootCause || '未填写'}</p></section><section><span>系统原因</span><p>{selected.systemCause || '未填写'}</p></section><section><span>次要原因</span><p>{selected.secondaryCause || '未填写'}</p></section><section className="conclusion"><span>最终结论</span><p>{selected.finalConclusion || '未填写'}</p></section></div>}
              {detailTab === 'actions' && <div className="risk-text-grid"><section><span>临时遏制措施</span><p>{selected.containmentAction || '未填写'}</p></section><section><span>不良处置</span><p>{selected.disposition || '未填写'}</p></section><section><span>纠正措施</span><p>{selected.correctiveAction || '未填写'}</p></section><section><span>预防再发措施</span><p>{selected.preventiveAction || '未填写'}</p></section><section><span>验证结果</span><p>{selected.verificationResult || '未填写'}</p></section><section><span>证据摘要</span><p>{selected.evidenceSummary || '未填写'}</p></section></div>}
              {detailTab === 'relations' && <div className="risk-relation-sections"><section><header><ClipboardCheck size={14} /><strong>来源质量问题</strong><em>{selected.issues.length}</em></header>{selected.issues.map(item => <Link href={`/workspace/issues?issueId=${encodeURIComponent(item.id)}`} key={item.id}><span><b>{item.code} · {item.title}</b><small>{item.isMajorQuality ? `重大质量 · ${item.majorApproval?.status === 'APPROVED' ? '审批通过' : '审批未完成'}` : item.status}</small></span><ChevronRight size={14} /></Link>)}{!selected.issues.length && <p>未关联来源问题</p>}</section><section><header><Link2 size={14} /><strong>关联工单</strong><em>{selected.workOrders.length}</em></header>{selected.workOrders.map(item => <Link href={`/production?workOrderId=${encodeURIComponent(item.id)}`} key={item.id}><span><b>{item.displayCode}</b><small>{item.customerName || '客户未填'} · {item.source === 'PRODUCT_AUTO' ? '产品自动继承' : item.source === 'PRODUCT_CONFIRMATION' ? '历史产品确认' : '直接关联'}</small></span><ChevronRight size={14} /></Link>)}{!selected.workOrders.length && <p>未关联工单；归档时仍会自动匹配关联产品的工单</p>}</section><section><header><Boxes size={14} /><strong>关联产品</strong><em>{selected.products.length}</em></header>{selected.products.map(item => <div key={item.id}><span><b>{item.specification}</b><small>{item.customerName}{item.productName ? ` · ${item.productName}` : ''}</small></span></div>)}{!selected.products.length && <p>未关联产品</p>}</section><section><header><FileArchive size={14} /><strong>8D证据档案</strong><em>{selected.eightDReports.length}</em></header>{selected.eightDReports.map(item => <Link href={`/workspace/quality/8d?reportId=${encodeURIComponent(item.id)}`} key={item.id}><span><b>{item.reportNo}</b><small>{item.title}</small></span><ChevronRight size={14} /></Link>)}{!selected.eightDReports.length && <p>未关联8D档案</p>}</section></div>}
              {detailTab === 'archive' && <div className="risk-archive-view"><section className="risk-archive-summary"><header><div><Archive size={16} /><strong>归档版本与工单预警</strong></div><span>{selected.status === 'ARCHIVED' ? `当前 R${selected.currentRevisionNumber}` : selected.status === 'REVISING' ? `修订中 · 当前生效 R${selected.currentRevisionNumber}` : '尚未归档'}</span></header><div><article><span>归档版本</span><strong>{selected.revisions.length}</strong></article><article><span>生成预警</span><strong>{selected.alerts.length}</strong></article><article><span>活动预警</span><strong>{activeAlertCount}</strong></article><article><span>工单知悉</span><strong>{selected.alerts.reduce((sum, item) => sum + item.acknowledgementCount, 0)}</strong></article></div></section><section className="risk-alert-list"><header><strong>工单预警投影</strong><span>知悉不等于风险解除</span></header>{selected.alerts.map(alert => <article className={`state-${alert.state.toLowerCase()}`} key={alert.id}><span className={`severity-${alert.severity.toLowerCase()}`}><ShieldAlert size={14} /></span><div><strong>{alert.workOrder.displayCode}</strong><small>R{alert.revisionNumber} · {alert.source === 'DIRECT_ARCHIVE' ? '归档直接同步' : alert.source === 'PRODUCT_AUTO_ARCHIVE' ? '同产品自动继承' : '历史产品确认'} · {alert.state}</small></div><em>{alert.acknowledgementCount} 人知悉</em></article>)}{!selected.alerts.length && <p>尚未生成工单预警</p>}</section><section className="risk-activity-list"><header><strong>审计活动</strong><span>{selected.activities.length}</span></header>{selected.activities.map(item => <article key={item.id}><i /><div><header><strong>{activityLabels[item.action] || item.action}</strong><time>{formatDate(item.createdAt, true)}</time></header><p>{item.content || '无补充说明'}</p><small>{item.actorName}</small></div></article>)}</section></div>}
              </>}
            </div>
          </>}
        </section>
      </section>
    </div>

    {formOpen && <div className="risk-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><form className="risk-form-modal" role="dialog" aria-modal="true" aria-labelledby="risk-form-title" onSubmit={event => { void saveReport(event); }}>
      <header><div><span>{editing ? editing.status === 'REVISING' ? '归档修订稿' : '编辑异常草稿' : '建立内部重大异常'}</span><h2 id="risk-form-title">{editing ? `${editing.reportNo} · ${formSteps.find(item => item.step === formStep)?.title}` : '记录车间重大不良与质量风险'}</h2><p>可先保存草稿；归档前系统会检查原因、措施、证据、重大审批和关联完整性。</p></div><button type="button" disabled={saving} onClick={() => setFormOpen(false)}><X size={18} /></button></header>
      <nav className="risk-form-steps">{formSteps.map(item => <button className={`${formStep === item.step ? 'active' : ''} `} type="button" key={item.step} onClick={() => setFormStep(item.step)}><span><strong>{item.title}</strong><small>{item.hint}</small></span></button>)}</nav>
      <div className="risk-form-body hm-scroll-region">
        {formStep === 1 && <><section className="risk-form-card"><QualityAssigneeSelect value={form.ownerUserId} users={options.assignees || []} onChange={ownerUserId => setForm(current => ({ ...current, ownerUserId }))} />{editing?.ownerUserId !== form.ownerUserId && editing?.status !== 'DRAFT' && <label>负责人变更原因<input value={form.changeReason} onChange={event => setForm(current => ({ ...current, changeReason: event.target.value }))} /></label>}<header><strong>异常基本信息</strong><span>草稿阶段只强制编号和标题</span></header><div className="risk-form-grid"><label>异常汇总编号<input autoFocus value={form.reportNo} maxLength={80} onChange={event => setForm(current => ({ ...current, reportNo: event.target.value }))} /></label><label>风险等级<select value={form.severity} onChange={event => setForm(current => ({ ...current, severity: event.target.value as InternalQualityRiskSeverity }))}><option value="CRITICAL">重大风险</option><option value="HIGH">高风险</option><option value="MEDIUM">中风险</option><option value="LOW">低风险</option></select></label><label className="wide">异常标题<input value={form.title} maxLength={180} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="一句话说明不良或重大质量问题" /></label><label>发生日期<input type="date" value={form.occurrenceDate} onChange={event => setForm(current => ({ ...current, occurrenceDate: event.target.value }))} /></label><label>发现区域/车间<input value={form.workshopArea} onChange={event => setForm(current => ({ ...current, workshopArea: event.target.value }))} placeholder="如 前端裁线区" /></label><label>涉及工序<input value={form.processName} onChange={event => setForm(current => ({ ...current, processName: event.target.value }))} placeholder="如 端子压接" /></label><label>责任部门<input value={form.responsibleDepartment} onChange={event => setForm(current => ({ ...current, responsibleDepartment: event.target.value }))} /></label><label className="wide">不良现象<textarea rows={4} value={form.defectPhenomenon} onChange={event => setForm(current => ({ ...current, defectPhenomenon: event.target.value }))} placeholder="描述发现方式、批次、数量、失效表现和现场状态" /></label></div></section><div className="risk-picker-grid"><TogglePicker title="来源质量问题" icon={<ClipboardCheck size={14} />} items={issuePickerItems} selected={form.issueIds} onToggle={id => toggleFormRelation('issueIds', id)} emptyText="没有匹配的问题" /><TogglePicker title="关联工单" icon={<Link2 size={14} />} items={workOrderPickerItems} selected={form.workOrderIds} onToggle={id => toggleFormRelation('workOrderIds', id)} emptyText="没有匹配的工单" /></div></>}
        {formStep === 2 && <section className="risk-form-card"><header><strong>原因分析</strong><span>明确区分发生、流出、系统与根本原因</span></header><div className="risk-form-grid text"><label>发生原因<textarea rows={5} value={form.occurrenceCause} onChange={event => setForm(current => ({ ...current, occurrenceCause: event.target.value }))} placeholder="为什么会产生不良" /></label><label>流出原因<textarea rows={5} value={form.escapeCause} onChange={event => setForm(current => ({ ...current, escapeCause: event.target.value }))} placeholder="为什么未在前序检查中发现" /></label><label>系统原因<textarea rows={5} value={form.systemCause} onChange={event => setForm(current => ({ ...current, systemCause: event.target.value }))} placeholder="流程、标准、培训、设备或管理机制原因" /></label><label>根本原因<textarea rows={5} value={form.rootCause} onChange={event => setForm(current => ({ ...current, rootCause: event.target.value }))} placeholder="经证据确认的根因，避免只写现象" /></label><label className="wide">次要/促进原因<textarea rows={4} value={form.secondaryCause} onChange={event => setForm(current => ({ ...current, secondaryCause: event.target.value }))} placeholder="选填：放大风险或促成问题的其他因素" /></label></div></section>}
        {formStep === 3 && <><section className="risk-form-card"><header><strong>措施、验证与结论</strong><span>将临时止血、永久纠正和再发预防分开记录</span></header><div className="risk-form-grid text"><label>临时遏制措施<textarea rows={5} value={form.containmentAction} onChange={event => setForm(current => ({ ...current, containmentAction: event.target.value }))} /></label><label>不良品处置<textarea rows={5} value={form.disposition} onChange={event => setForm(current => ({ ...current, disposition: event.target.value }))} placeholder="返工、报废、隔离、让步等" /></label><label>纠正措施<textarea rows={5} value={form.correctiveAction} onChange={event => setForm(current => ({ ...current, correctiveAction: event.target.value }))} /></label><label>预防再发措施<textarea rows={5} value={form.preventiveAction} onChange={event => setForm(current => ({ ...current, preventiveAction: event.target.value }))} /></label><label>验证结果<textarea rows={5} value={form.verificationResult} onChange={event => setForm(current => ({ ...current, verificationResult: event.target.value }))} placeholder="说明样本、周期、数据和判定" /></label><label>最终结论<textarea rows={5} value={form.finalConclusion} onChange={event => setForm(current => ({ ...current, finalConclusion: event.target.value }))} placeholder="闭环固定必填：说明是否有效、残余风险与后续状态" /></label><label className="wide">证据摘要<textarea rows={4} value={form.evidenceSummary} onChange={event => setForm(current => ({ ...current, evidenceSummary: event.target.value }))} placeholder="简述检验记录、照片、附件或关联8D；是否必填由第5步归档策略决定" /></label></div></section>
        <section className="risk-draft-attachments">
          <header>
            <span><UploadCloud size={17} /><strong>附件与现场证据</strong><small>新建时可直接选择；保存草稿后自动上传到对象存储，不落本机服务器磁盘</small></span>
            <div>
              <select aria-label="待上传附件分类" value={attachmentCategory} onChange={event => setAttachmentCategory(event.target.value as InternalQualityRiskAttachmentDTO['category'])}><option value="DEFECT">异常实物</option><option value="CAUSE">原因证据</option><option value="ACTION">措施证据</option><option value="VERIFICATION">验证证据</option><option value="SOLUTION">解决方案</option><option value="EVIDENCE">其他证据</option></select>
              <input ref={draftAttachmentInputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" onChange={event => stageAttachments(event.target.files)} />
              <button type="button" onClick={() => draftAttachmentInputRef.current?.click()}><Plus size={14} />选择附件</button>
            </div>
          </header>
          <div className="risk-draft-attachment-list">
            {pendingAttachments.map(item => <article className={item.error ? 'failed' : ''} key={item.id}>
              <span className="risk-draft-file-icon">{item.file.type.startsWith('image/') ? <FileImage size={18} /> : <Paperclip size={18} />}</span>
              <div><strong title={item.file.name}>{item.file.name}</strong><small>{item.category} · {Math.max(1, Math.round(item.file.size / 1024))} KB · {item.error ? `失败：${item.error}` : '待上传'}</small></div>
              <button type="button" aria-label={`移除${item.file.name}`} title="移除待上传附件" onClick={() => setPendingAttachments(current => current.filter(file => file.id !== item.id))}><X size={14} /></button>
            </article>)}
            {!pendingAttachments.length && <button className="risk-draft-attachment-empty" type="button" onClick={() => draftAttachmentInputRef.current?.click()}><Camera size={22} /><span><strong>点击上传照片、检验记录或解决方案</strong><small>支持 JPG、PNG、WEBP 和 PDF 多选；服务端校验真实文件内容</small></span></button>}
          </div>
        </section></>}
        {formStep === 4 && <><section className="risk-product-suggestion automatic"><Sparkles size={17} /><div><strong>产品警示自动继承</strong><p>归档发布时会将所选产品现有工单全部纳入；以后新建或导入同产品工单，也会在计划/执行读取时自动收到同一警示。直接关联工单用于补充产品范围之外的特例。</p></div><span>{form.productIds.length} 个产品 · {form.workOrderIds.length} 个直接工单</span></section><div className="risk-picker-grid"><TogglePicker title="关联产品主数据（可一对多）" icon={<Boxes size={14} />} items={productPickerItems} selected={form.productIds} onToggle={id => toggleFormRelation('productIds', id)} emptyText="没有匹配的产品" /><TogglePicker title="8D证据档案" icon={<FileArchive size={14} />} items={eightDPickerItems} selected={form.eightDReportIds} onToggle={id => toggleFormRelation('eightDReportIds', id)} emptyText="没有匹配的8D档案" /></div></>}
        {formStep === 5 && <><section className="risk-form-card"><header><strong>产品警示与归档范围</strong><span>这些结构化字段会进入图纸资料库、计划、生产执行及固定 A4 打印附页</span></header><div className="risk-form-grid text"><label className="wide">警示摘要<textarea rows={3} value={form.warningSummary} onChange={event => setForm(current => ({ ...current, warningSummary: event.target.value }))} placeholder="用现场作业者能直接理解的一段话说明异常和风险" /></label><label className="wide">本批必须执行<textarea rows={4} value={form.requiredAction} onChange={event => setForm(current => ({ ...current, requiredAction: event.target.value }))} placeholder={'每行一项，例如：\n1. 开工前完成首件确认\n2. 每小时抽检5只并记录'} /></label><label>检查方法<input value={form.inspectionMethod} onChange={event => setForm(current => ({ ...current, inspectionMethod: event.target.value }))} placeholder="如 数显千分尺测量" /></label><label>检查频次<input value={form.inspectionFrequency} onChange={event => setForm(current => ({ ...current, inspectionFrequency: event.target.value }))} placeholder="如 首件 + 每小时5只" /></label><label>合格判定<input value={form.acceptanceCriteria} onChange={event => setForm(current => ({ ...current, acceptanceCriteria: event.target.value }))} placeholder="如 压接高度1.80±0.05mm" /></label><label>停线/升级条件<input value={form.stopConditions} onChange={event => setForm(current => ({ ...current, stopConditions: event.target.value }))} placeholder="如 出现1只不合格立即停线" /></label><label>升级联系人<input value={form.escalationContact} onChange={event => setForm(current => ({ ...current, escalationContact: event.target.value }))} placeholder="部门或联系人" /></label><label>图片排版<select value={form.printPhotoLayout} onChange={event => setForm(current => ({ ...current, printPhotoLayout: event.target.value as 'PAIR' | 'SINGLE' }))}><option value="PAIR">自动省纸 · 原比例排版</option><option value="SINGLE">大图细节 · 按需续页</option></select></label><label>打印策略<select value={form.printPolicy} onChange={event => setForm(current => ({ ...current, printPolicy: event.target.value as InternalQualityRiskPrintPolicy }))}><option value="REQUIRED">必须随工单打印</option><option value="OPTIONAL">计划可选附页</option><option value="SYSTEM_ONLY">仅系统警示</option></select></label><label className="wide">风险影响范围<textarea rows={3} value={form.riskScope} onChange={event => setForm(current => ({ ...current, riskScope: event.target.value }))} placeholder="涉及批次、产品族、客户、设备、材料或供应商范围" /></label><label className="wide">适用工序/检查点<input value={form.applicableProcess} onChange={event => setForm(current => ({ ...current, applicableProcess: event.target.value }))} placeholder="如 压接首件确认、拉力抽检、后端终检" /></label><label>生效日期<input type="date" value={form.effectiveFrom} onChange={event => setForm(current => ({ ...current, effectiveFrom: event.target.value }))} /></label><label>失效日期<input type="date" value={form.effectiveUntil} onChange={event => setForm(current => ({ ...current, effectiveUntil: event.target.value }))} /><small>留空表示长期有效；需失效时单独撤销警示并保留原因</small></label></div></section><ArchiveRequirementPanel value={form.archiveRequirements} onChange={(key, mode) => setForm(current => ({ ...current, archiveRequirements: { ...current.archiveRequirements, [key]: mode } }))} /><section className="risk-form-review"><header><strong>发布影响预览</strong><span>保存后先走协同与验证，待归档阶段才正式发布</span></header><div><article><ClipboardCheck /><span><b>{form.issueIds.length}</b><small>来源问题</small></span></article><article><Link2 /><span><b>{form.workOrderIds.length}</b><small>直接工单</small></span></article><article><Boxes /><span><b>{form.productIds.length}</b><small>自动继承产品</small></span></article><article><FileArchive /><span><b>{form.eightDReportIds.length + pendingAttachments.length}</b><small>8D / 待传附件</small></span></article></div><p><AlertTriangle size={14} />保存不会发布警示；归档仅阻断本单设为“必填”的字段、固定闭环项、未完成协同任务与重大审批。</p></section></>}
        {formError && <div className="risk-form-error"><AlertTriangle size={15} />{formError}</div>}
      </div>
      <footer><span>{editing?.reportNo} · 内容按职责分阶段填写，保存不等于完成流程</span><div><button type="button" disabled={saving} onClick={() => setFormOpen(false)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={14} />}保存当前修改</button></div></footer>
    </form></div>}

    {taskOpen && <div className="risk-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setTaskOpen(false); }}><form className="risk-task-modal" role="dialog" aria-modal="true" onSubmit={event => { void createTask(event); }}><header><div><span>并行部门协同</span><h2>新增处理任务</h2><p>按责任部门拆分任务；完成时必须填写结果，质量验证后才允许进入待归档。</p></div><button type="button" disabled={saving} onClick={() => setTaskOpen(false)}><X size={18} /></button></header><div className="risk-task-form-grid"><label>任务类型<select value={taskForm.taskType} onChange={event => setTaskForm(current => ({ ...current, taskType: event.target.value as RiskTaskForm['taskType'] }))}>{Object.entries(taskTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>责任部门<input value={taskForm.department} onChange={event => setTaskForm(current => ({ ...current, department: event.target.value }))} placeholder="如 工艺部" /></label><label className="wide">任务标题<input autoFocus value={taskForm.title} onChange={event => setTaskForm(current => ({ ...current, title: event.target.value }))} placeholder="例如：确认压接参数并发布作业要求" /></label><QualityAssigneeSelect label="任务负责人" value={taskForm.ownerUserId} users={options.assignees || []} onChange={ownerUserId => setTaskForm(current => ({ ...current, ownerUserId }))} /><label>截止日期<input type="date" value={taskForm.dueAt} onChange={event => setTaskForm(current => ({ ...current, dueAt: event.target.value }))} /></label><label className="wide">任务要求<textarea rows={5} value={taskForm.requirement} onChange={event => setTaskForm(current => ({ ...current, requirement: event.target.value }))} placeholder="说明交付物、判断标准和需要上传的证据" /></label></div>{taskError && <div className="risk-form-error"><AlertTriangle size={15} />{taskError}</div>}<footer><button type="button" disabled={saving} onClick={() => setTaskOpen(false)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving ? <Loader2 className="spin" size={14} /> : <Users size={14} />}建立协同任务</button></footer></form></div>}

    {previewAttachment && <div className="risk-modal-backdrop risk-attachment-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewAttachment(null); }}><section className="risk-attachment-preview" role="dialog" aria-modal="true"><header><div><span>{previewAttachment.category}</span><h2>{previewAttachment.displayName}</h2><p>SHA-256 {previewAttachment.sha256.slice(0, 16)}… · {Math.max(1, Math.round(previewAttachment.fileSize / 1024))} KB</p></div><nav><a href={previewAttachment.contentUrl} target="_blank" rel="noreferrer">在新窗口打开</a><button type="button" onClick={() => setPreviewAttachment(null)}><X size={18} /></button></nav></header><div>{previewAttachment.mimeType.startsWith('image/') ? <img src={previewAttachment.contentUrl} alt={previewAttachment.caption || previewAttachment.displayName} /> : <iframe title={previewAttachment.displayName} src={previewAttachment.contentUrl} />}</div><footer><span>{previewAttachment.caption || '无补充说明'}</span>{canUpdate && selected?.status !== 'ARCHIVED' && <button className="danger" type="button" onClick={() => { void removeAttachment(previewAttachment); }}><Trash2 size={14} />删除附件</button>}</footer></section></div>}

    {revokeOpen && selected && <div className="risk-modal-backdrop"><section className="risk-confirm-modal warning-withdraw" role="alertdialog" aria-modal="true"><Ban size={28} /><h2>撤销产品异常警示？</h2><p>{selected.reportNo} · 当前覆盖 {activeAlertCount} 条活动工单预警</p><span>撤销会停止计划、生产执行和图纸资料库中的活动警示，但不会删除归档版本、打印历史或人员知悉记录。若需重新发布，必须启动新修订并重新归档。</span><label>撤销原因<textarea autoFocus rows={4} value={revokeReason} maxLength={500} onChange={event => setRevokeReason(event.target.value)} placeholder="请填写问题已永久消除、适用期结束或警示替换依据" /></label><footer><button type="button" disabled={saving} onClick={() => setRevokeOpen(false)}>保持生效</button><button className="danger" type="button" disabled={saving || !revokeReason.trim()} onClick={() => { void revokeWarning(); }}>{saving && <Loader2 className="spin" size={14} />}确认撤销警示</button></footer></section></div>}

    {archivePreview && <div className="risk-modal-backdrop"><section className="risk-archive-modal" role="alertdialog" aria-modal="true"><header><div><span>归档发布门禁与同步预览</span><h2>{archivePreview.report.reportNo} · 将生成 R{archivePreview.readiness.revisionNumber}</h2><p>冻结归档版本、发布产品警示和创建工单投影在同一数据库事务中完成，任一步失败都不会部分生效。</p></div><button type="button" disabled={saving} onClick={() => setArchivePreview(null)}><X size={18} /></button></header><div className="risk-archive-modal-body"><label className="quality-publication-choice"><input type="checkbox" checked={publishWarning} onChange={event => setPublishWarning(event.target.checked)} /><span><strong>归档并发布现场警示</strong><small>取消勾选仅保存归档，不进入工单、图纸警示和员工扫码页。</small></span></label>{publishWarning && archivePreview.readiness.publicationBlockers?.map(item => <p className="risk-form-error" key={item.code}>{item.message}</p>)}<section className={`archive-readiness ${archivePreview.readiness.ready ? 'ready' : 'blocked'}`}>{archivePreview.readiness.ready ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}<div><strong>{archivePreview.readiness.ready ? '已满足归档留存条件' : `存在 ${archivePreview.readiness.blockers.length} 个阻断项`}</strong><p>{archivePreview.readiness.ready ? `确认后冻结 R${archivePreview.readiness.revisionNumber}${publishWarning ? `，同步 ${archivePreview.readiness.alertCount} 条工单质量预警` : '，仅归档不发布警示'}。` : '仅需处理本单设为必填的字段与固定闭环项；选填和不适用不会阻断。'}</p></div></section><div className="archive-impact-grid"><article><span>来源问题</span><strong>{archivePreview.readiness.issueCount}</strong></article><article><span>关联产品</span><strong>{archivePreview.readiness.productCount}</strong></article><article><span>覆盖工单</span><strong>{archivePreview.readiness.workOrderCount}</strong></article><article><span>新增预警</span><strong>{publishWarning ? archivePreview.readiness.alertCount : 0}</strong></article></div><section className="archive-policy-summary"><span><strong>{Object.values(archivePreview.report.archiveRequirements).filter(mode => mode === 'REQUIRED').length}</strong><small>本单必填</small></span><span><strong>{Object.values(archivePreview.report.archiveRequirements).filter(mode => mode === 'OPTIONAL').length}</strong><small>选填</small></span><span><strong>{Object.values(archivePreview.report.archiveRequirements).filter(mode => mode === 'NOT_APPLICABLE').length}</strong><small>不适用</small></span><p>最终结论、有效产品/工单、未关闭协同任务及重大问题审批属于固定闭环条件。</p></section>{archivePreview.readiness.blockers.length > 0 && <section className="archive-check-list blockers"><header><strong>本次必须处理</strong><span>按当前字段策略生成</span></header>{archivePreview.readiness.blockers.map(item => <div key={item.code} title={item.code}><AlertTriangle size={14} /><span><b>{item.message}</b></span></div>)}</section>}{archivePreview.readiness.warnings.length > 0 && <section className="archive-check-list warnings"><header><strong>建议补充</strong><span>不阻断归档</span></header>{archivePreview.readiness.warnings.map(item => <div key={item.code} title={item.code}><AlertTriangle size={14} /><span><b>{item.message}</b></span></div>)}</section>}</div><footer><span>预览使用与正式工单相同组件；未归档版本会带“不可用于生产”水印。</span><div><Link className="print-preview" href={`/workspace/quality/internal-risks/${encodeURIComponent(archivePreview.report.id)}/print-preview`} target="_blank"><Eye size={14} />预览工单附页</Link><button type="button" disabled={saving} onClick={() => setArchivePreview(null)}>返回工作台</button><button className="primary" type="button" disabled={saving || !archivePreview.readiness.ready || (publishWarning && Boolean(archivePreview.readiness.publicationBlockers?.length))} onClick={() => { void confirmArchive(); }}>{saving && <Loader2 className="spin" size={14} />}{publishWarning ? '确认归档并发布警示' : '仅归档留存'}</button></div></footer></section></div>}

    {deleteTarget && <div className="risk-modal-backdrop"><section className="risk-confirm-modal" role="alertdialog" aria-modal="true"><Archive size={28} /><h2>将异常汇总移入回收站？</h2><p>{deleteTarget.reportNo} · {deleteTarget.title}</p><span>异常正文、关联、协同任务、证据元数据和审计历史会保留，在未彻底删除前均可恢复。已撤销的警示不会因恢复自动重发。</span><label>删除原因<textarea autoFocus rows={4} value={deleteReason} maxLength={500} onChange={event => setDeleteReason(event.target.value)} placeholder="请填写重复建立、内容作废或其他业务原因" /></label><footer><button type="button" disabled={saving} onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" type="button" disabled={saving || !deleteReason.trim()} onClick={() => { void confirmDelete(); }}>{saving && <Loader2 className="spin" size={14} />}移入回收站</button></footer></section></div>}

    {purgeTarget && <div className="risk-modal-backdrop"><section className="risk-confirm-modal purge" role="alertdialog" aria-modal="true"><Trash2 size={28} /><h2>{purgeTarget.canPurge ? '彻底删除未形成正式历史的记录' : '此记录需要保留追溯'}</h2><p>{purgeTarget.reportNo} · {purgeTarget.title}</p>{purgeTarget.canPurge ? <><span>不再等待30天。操作不可恢复；未归档附件进入可重试的对象清理队列，独立审计日志保留。</span><label>删除原因<textarea value={purgeReason} onChange={event => setPurgeReason(event.target.value)} /></label><label>确认完整编号<input value={purgeConfirmation} onChange={event => setPurgeConfirmation(event.target.value)} placeholder={purgeTarget.reportNo} /></label></> : <ul>{purgeTarget.purgeBlockers?.map(reason => <li key={reason}>{reason}</li>)}</ul>}<footer><button type="button" onClick={() => { setPurgeTarget(null); setDetailTab('archive'); }}>查看归档与引用</button><button type="button" disabled={saving} onClick={() => setPurgeTarget(null)}>关闭</button>{purgeTarget.canPurge && <button className="danger" type="button" disabled={saving || !purgeReason.trim() || purgeConfirmation !== purgeTarget.reportNo} onClick={() => void purgeReport()}>不可恢复地删除</button>}</footer></section></div>}
  </main>;
}
