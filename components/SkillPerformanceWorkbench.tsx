'use client';

import {
  AlertTriangle,
  Award,
  BadgeCheck,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  GraduationCap,
  Grid3X3,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import type {
  EmployeeDTO,
  EmployeeSkillCertificationDTO,
  PositionSkillRequirementDTO,
  SkillAssessmentDTO,
  SkillAssessmentTemplateDTO,
  SkillDefinitionDTO,
  SkillWorkbenchSummaryDTO,
} from '@/types';

type SkillView = 'matrix' | 'people' | 'assessments';
type SkillDialog = 'skill' | 'requirement' | 'template' | 'launch' | 'assessment' | null;

export type SkillWorkbenchResponse = {
  ok: boolean;
  employees?: EmployeeDTO[];
  skills?: SkillDefinitionDTO[];
  requirements?: PositionSkillRequirementDTO[];
  certifications?: EmployeeSkillCertificationDTO[];
  templates?: SkillAssessmentTemplateDTO[];
  assessments?: SkillAssessmentDTO[];
  summary?: SkillWorkbenchSummaryDTO;
  assessment?: SkillAssessmentDTO;
  error?: string;
};

type TemplateItemDraft = {
  section: string;
  title: string;
  maxScore: string;
  weight: string;
  isRequired: boolean;
  isCritical: boolean;
};

const levelLabels = ['未认证', 'L1 了解', 'L2 独立', 'L3 熟练', 'L4 专家'];
const statusLabels: Record<SkillAssessmentDTO['status'], string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  RETURNED: '已退回',
  APPROVED: '已通过',
  CANCELLED: '已取消',
};

const emptySummary: SkillWorkbenchSummaryDTO = {
  skillCount: 0,
  requiredPositionCount: 0,
  certifiedEmployeeCount: 0,
  pendingReviewCount: 0,
  expiringCertificationCount: 0,
  coverageBasisPoints: null,
};

const defaultTemplateItems: TemplateItemDraft[] = [
  { section: '理论与规范', title: '理解岗位作业标准、质量要求与安全注意事项', maxScore: '20', weight: '20', isRequired: true, isCritical: true },
  { section: '岗位实操', title: '按标准独立完成关键操作并保持过程稳定', maxScore: '60', weight: '60', isRequired: true, isCritical: true },
  { section: '质量与交接', title: '正确识别异常并完成记录、隔离和交接', maxScore: '20', weight: '20', isRequired: true, isCritical: false },
];

function employeeLabel(employee: EmployeeDTO | null | undefined): string {
  if (!employee) return '人员待确认';
  return `${employee.name} · ${employee.position || '岗位待维护'}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待配置';
  return `${(value / 100).toFixed(1)}%`;
}

function requirementMatches(requirement: PositionSkillRequirementDTO, employee: EmployeeDTO): boolean {
  return requirement.department === (employee.department || '')
    && requirement.position === (employee.position || '')
    && (!requirement.team || requirement.team === (employee.team || ''));
}

export default function SkillPerformanceWorkbench({
  fallbackEmployees,
  initialData,
}: {
  fallbackEmployees: EmployeeDTO[];
  initialData?: SkillWorkbenchResponse;
}) {
  const [activeView, setActiveView] = useState<SkillView>('matrix');
  const [employees, setEmployees] = useState<EmployeeDTO[]>(initialData?.employees || fallbackEmployees);
  const [skills, setSkills] = useState<SkillDefinitionDTO[]>(initialData?.skills || []);
  const [requirements, setRequirements] = useState<PositionSkillRequirementDTO[]>(initialData?.requirements || []);
  const [certifications, setCertifications] = useState<EmployeeSkillCertificationDTO[]>(initialData?.certifications || []);
  const [templates, setTemplates] = useState<SkillAssessmentTemplateDTO[]>(initialData?.templates || []);
  const [assessments, setAssessments] = useState<SkillAssessmentDTO[]>(initialData?.assessments || []);
  const [summary, setSummary] = useState<SkillWorkbenchSummaryDTO>(initialData?.summary || emptySummary);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<SkillDialog>(null);
  const [dialogError, setDialogError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialData?.employees?.find(employee => employee.isActive)?.id || '');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialData?.templates?.[0]?.id || '');
  const [templateBaseId, setTemplateBaseId] = useState('');
  const [skillDraft, setSkillDraft] = useState({
    name: '',
    category: 'PROCESS',
    description: '',
    defaultValidityMonths: '12',
    isCritical: false,
  });
  const [requirementDraft, setRequirementDraft] = useState({
    department: '',
    position: '',
    team: '',
    skillId: '',
    targetLevel: '2',
  });
  const [templateDraft, setTemplateDraft] = useState({
    name: '',
    department: '',
    position: '',
    team: '',
    skillId: '',
    passScore: '80',
    targetLevel: '2',
    validityMonths: '12',
    instructions: '考核人现场评分，红线项必须全部通过；审核通过后方形成员工技能认证。',
    items: defaultTemplateItems,
  });
  const [launchDraft, setLaunchDraft] = useState({
    employeeId: '',
    templateId: '',
    assessorId: '',
    reviewerId: '',
    proposedLevel: '2',
  });
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, { score: string; passed: boolean; comment: string }>>({});
  const [reviewComment, setReviewComment] = useState('');
  const [proposedLevel, setProposedLevel] = useState('2');
  useToastBridge(toast, setToast);

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/skills/workbench', { cache: 'no-store' });
      const body = await response.json() as SkillWorkbenchResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || '技能绩效工作台加载失败');
      const nextEmployees = body.employees || fallbackEmployees;
      setEmployees(nextEmployees);
      setSkills(body.skills || []);
      setRequirements(body.requirements || []);
      setCertifications(body.certifications || []);
      setTemplates(body.templates || []);
      setAssessments(body.assessments || []);
      setSummary(body.summary || emptySummary);
      setSelectedEmployeeId(current => (
        nextEmployees.some(employee => employee.id === current) ? current : nextEmployees.find(employee => employee.isActive)?.id || ''
      ));
      setSelectedTemplateId(current => (
        (body.templates || []).some(template => template.id === current) ? current : (body.templates || [])[0]?.id || ''
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '技能绩效工作台加载失败');
    } finally {
      setLoading(false);
    }
  }, [fallbackEmployees]);

  useEffect(() => {
    if (initialData) return;
    void loadWorkbench();
  }, [initialData, loadWorkbench]);

  const activeEmployees = useMemo(
    () => employees.filter(employee => employee.isActive),
    [employees],
  );
  const departments = useMemo(
    () => [...new Set(activeEmployees.map(employee => employee.department || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [activeEmployees],
  );
  const positions = useMemo(
    () => [...new Set(activeEmployees
      .filter(employee => !departmentFilter || employee.department === departmentFilter)
      .map(employee => employee.position || '')
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [activeEmployees, departmentFilter],
  );
  const visibleEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    return activeEmployees.filter(employee => {
      if (departmentFilter && employee.department !== departmentFilter) return false;
      if (positionFilter && employee.position !== positionFilter) return false;
      if (!normalized) return true;
      return `${employee.employeeNo} ${employee.name} ${employee.department || ''} ${employee.position || ''} ${employee.team || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized);
    });
  }, [activeEmployees, departmentFilter, keyword, positionFilter]);
  const visibleSkills = useMemo(
    () => skills.filter(skill => skill.isActive),
    [skills],
  );
  const selectedEmployee = employees.find(employee => employee.id === selectedEmployeeId) || null;
  const selectedAssessment = assessments.find(assessment => assessment.id === selectedAssessmentId) || null;
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId) || null;
  const certificationsByPair = useMemo(
    () => new Map(certifications.map(certification => [`${certification.employeeId}:${certification.skillId}`, certification])),
    [certifications],
  );
  const employeeRequirements = useMemo(
    () => selectedEmployee ? requirements.filter(requirement => requirementMatches(requirement, selectedEmployee)) : [],
    [requirements, selectedEmployee],
  );
  const employeeSkillIds = useMemo(
    () => new Set([
      ...employeeRequirements.map(requirement => requirement.skillId),
      ...certifications.filter(certification => certification.employeeId === selectedEmployeeId).map(certification => certification.skillId),
    ]),
    [certifications, employeeRequirements, selectedEmployeeId],
  );
  const employeeSkills = visibleSkills.filter(skill => employeeSkillIds.has(skill.id));
  const filteredTemplates = templates.filter(template => template.status === 'ACTIVE');

  async function postJson(url: string, payload: Record<string, unknown>, method = 'POST'): Promise<SkillWorkbenchResponse> {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as SkillWorkbenchResponse;
    if (!response.ok || !body.ok) throw new Error(body.error || '操作失败');
    return body;
  }

  async function execute(action: () => Promise<void>): Promise<void> {
    setSaving(true);
    setDialogError('');
    try {
      await action();
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setSaving(false);
    }
  }

  function openSkillDialog(): void {
    setSkillDraft({ name: '', category: 'PROCESS', description: '', defaultValidityMonths: '12', isCritical: false });
    setDialogError('');
    setDialog('skill');
  }

  function openRequirementDialog(employee = selectedEmployee): void {
    setRequirementDraft({
      department: employee?.department || departments[0] || '',
      position: employee?.position || positions[0] || '',
      team: employee?.team || '',
      skillId: visibleSkills[0]?.id || '',
      targetLevel: '2',
    });
    setDialogError('');
    setDialog('requirement');
  }

  function openTemplateDialog(baseTemplate?: SkillAssessmentTemplateDTO): void {
    setTemplateDraft({
      name: baseTemplate?.name || '',
      department: baseTemplate?.department || selectedEmployee?.department || departments[0] || '',
      position: baseTemplate?.position || selectedEmployee?.position || positions[0] || '',
      team: baseTemplate?.team || selectedEmployee?.team || '',
      skillId: baseTemplate?.skillId || visibleSkills[0]?.id || '',
      passScore: String(baseTemplate?.passScore || 80),
      targetLevel: String(baseTemplate?.targetLevel || 2),
      validityMonths: String(baseTemplate?.validityMonths || 12),
      instructions: baseTemplate?.instructions || '考核人现场评分，红线项必须全部通过；审核通过后方形成员工技能认证。',
      items: baseTemplate?.items.map(item => ({
        section: item.section,
        title: item.title,
        maxScore: String(item.maxScore),
        weight: String(item.weight),
        isRequired: item.isRequired,
        isCritical: item.isCritical,
      })) || defaultTemplateItems,
    });
    setTemplateBaseId(baseTemplate?.id || '');
    setDialogError('');
    setDialog('template');
  }

  function openLaunchDialog(employeeId = selectedEmployeeId, templateId = selectedTemplateId): void {
    const employee = employees.find(item => item.id === employeeId);
    const applicable = filteredTemplates.find(template => (
      template.id === templateId
      && template.department === (employee?.department || '')
      && template.position === (employee?.position || '')
      && (!template.team || template.team === (employee?.team || ''))
    )) || filteredTemplates.find(template => (
      template.department === (employee?.department || '')
      && template.position === (employee?.position || '')
      && (!template.team || template.team === (employee?.team || ''))
    ));
    const assessor = employee || activeEmployees[0];
    const reviewer = activeEmployees.find(item => item.id !== employeeId && item.id !== assessor?.id);
    setLaunchDraft({
      employeeId,
      templateId: applicable?.id || '',
      assessorId: assessor?.id || '',
      reviewerId: reviewer?.id || '',
      proposedLevel: String(applicable?.targetLevel || 2),
    });
    setDialogError('');
    setDialog('launch');
  }

  function openAssessment(assessment: SkillAssessmentDTO): void {
    setSelectedAssessmentId(assessment.id);
    setAnswerDrafts(Object.fromEntries(assessment.template.items.map(item => {
      const answer = assessment.answers.find(candidate => candidate.itemId === item.id);
      return [item.id, {
        score: answer?.score === null || answer?.score === undefined ? '' : String(answer.score),
        passed: answer?.passed ?? true,
        comment: answer?.comment || '',
      }];
    })));
    setReviewComment(assessment.reviewComment || '');
    setProposedLevel(String(assessment.proposedLevel));
    setDialogError('');
    setDialog('assessment');
  }

  async function syncProcesses(): Promise<void> {
    await execute(async () => {
      const body = await postJson('/api/skills/catalog', { action: 'sync_processes' });
      const result = body as SkillWorkbenchResponse & { result?: { created: number; updated: number } };
      setDialog(null);
      setToast(`工序技能目录已同步：新增 ${result.result?.created || 0}，更新 ${result.result?.updated || 0}`);
      await loadWorkbench();
    });
  }

  async function createSkill(): Promise<void> {
    await execute(async () => {
      await postJson('/api/skills/catalog', { action: 'create', ...skillDraft });
      setDialog(null);
      setToast('技能已加入目录');
      await loadWorkbench();
    });
  }

  async function saveRequirement(): Promise<void> {
    await execute(async () => {
      await postJson('/api/skills/requirements', {
        action: 'upsert',
        ...requirementDraft,
        targetLevel: Number(requirementDraft.targetLevel),
      });
      setDialog(null);
      setToast('岗位技能要求已保存');
      await loadWorkbench();
    });
  }

  async function createTemplate(): Promise<void> {
    await execute(async () => {
      await postJson('/api/skills/templates', {
        ...templateDraft,
        baseTemplateId: templateBaseId,
        passScore: Number(templateDraft.passScore),
        targetLevel: Number(templateDraft.targetLevel),
        validityMonths: Number(templateDraft.validityMonths),
        items: templateDraft.items.map(item => ({
          ...item,
          maxScore: Number(item.maxScore),
          weight: Number(item.weight),
        })),
      });
      setDialog(null);
      setToast(templateBaseId ? '新版考核表已建立，旧版已冻结' : '岗位技能考核表已创建');
      await loadWorkbench();
    });
  }

  async function launchAssessment(): Promise<void> {
    await execute(async () => {
      const body = await postJson('/api/skills/assessments', {
        ...launchDraft,
        proposedLevel: Number(launchDraft.proposedLevel),
      });
      setDialog(null);
      setToast('技能考核任务已创建');
      await loadWorkbench();
      if (body.assessment) openAssessment(body.assessment);
    });
  }

  async function updateAssessment(action: 'save' | 'submit' | 'approve' | 'return' | 'cancel'): Promise<void> {
    if (!selectedAssessment) return;
    await execute(async () => {
      const body = await postJson(`/api/skills/assessments/${selectedAssessment.id}`, {
        action,
        version: selectedAssessment.version,
        proposedLevel: Number(proposedLevel),
        reviewComment,
        answers: selectedAssessment.template.items.map(item => ({
          itemId: item.id,
          score: answerDrafts[item.id]?.score === '' ? null : Number(answerDrafts[item.id]?.score),
          passed: answerDrafts[item.id]?.passed ?? true,
          comment: answerDrafts[item.id]?.comment || '',
        })),
      }, 'PATCH');
      if (body.assessment) {
        setAssessments(current => current.map(item => item.id === body.assessment!.id ? body.assessment! : item));
        setSelectedAssessmentId(body.assessment.id);
      }
      setToast(action === 'submit' ? '已提交审核' : action === 'approve' ? '审核通过，技能认证已生效' : action === 'return' ? '已退回修改' : action === 'cancel' ? '考核已取消' : '考核草稿已保存');
      if (action !== 'save') setDialog(null);
      await loadWorkbench();
    });
  }

  function changeEmployee(employee: EmployeeDTO): void {
    setSelectedEmployeeId(employee.id);
    setActiveView('people');
  }

  function matrixCell(employee: EmployeeDTO, skill: SkillDefinitionDTO) {
    const requirement = requirements.find(item => item.skillId === skill.id && requirementMatches(item, employee));
    const certification = certificationsByPair.get(`${employee.id}:${skill.id}`);
    const expired = certification?.expiresAt && new Date(certification.expiresAt).getTime() < Date.now();
    const level = certification?.level || 0;
    const meets = Boolean(requirement && certification && !expired && certification.status === 'ACTIVE' && level >= requirement.targetLevel);
    const tone = expired ? 'expired' : meets ? 'qualified' : requirement ? 'gap' : certification ? 'certified' : 'empty';
    const label = expired ? '过期' : certification ? `L${level}` : requirement ? '待评' : '—';
    return (
      <button
        type="button"
        className={`skill-matrix-cell ${tone}`}
        title={`${employee.name} · ${skill.name}：${certification ? levelLabels[level] : '尚未认证'}${requirement ? `，岗位要求 L${requirement.targetLevel}` : ''}`}
        onClick={() => changeEmployee(employee)}
      >
        <strong>{label}</strong>
        {requirement && <small>需 L{requirement.targetLevel}</small>}
      </button>
    );
  }

  function renderMatrix() {
    return (
      <div className="skill-view-body skill-matrix-view">
        <section className="skill-commandbar">
          <label><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索员工、编号、岗位或班组" /></label>
          <select value={departmentFilter} onChange={event => { setDepartmentFilter(event.target.value); setPositionFilter(''); }}>
            <option value="">全部部门</option>
            {departments.map(department => <option value={department} key={department}>{department}</option>)}
          </select>
          <select value={positionFilter} onChange={event => setPositionFilter(event.target.value)}>
            <option value="">全部岗位</option>
            {positions.map(position => <option value={position} key={position}>{position}</option>)}
          </select>
          <button type="button" className="skill-secondary-button" onClick={() => openRequirementDialog()}><BookOpenCheck />配置岗位要求</button>
          <button type="button" className="skill-primary-button" onClick={openSkillDialog}><Plus />新增技能</button>
        </section>
        {!visibleSkills.length ? (
          <section className="skill-empty-state">
            <span><Grid3X3 /></span>
            <div>
              <small>技能目录尚未建立</small>
              <h2>从现有产品工序生成第一版技能目录</h2>
              <p>只读取已发布的工序名称，不会修改工时、生产路线或人员达成率；同步后再为岗位配置目标等级。</p>
              <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void syncProcesses()}>
                {saving ? <Loader2 className="spin" /> : <RefreshCw />}同步现有工序
              </button>
            </div>
          </section>
        ) : (
          <section className="skill-matrix-panel">
            <header>
              <div><span className="skill-eyebrow">员工 × 技能</span><h2>技能矩阵</h2></div>
              <div className="skill-level-legend">
                <span><i className="l0" />未认证</span>
                <span><i className="l1" />L1 了解</span>
                <span><i className="l2" />L2 独立</span>
                <span><i className="l3" />L3 熟练</span>
                <span><i className="l4" />L4 专家</span>
              </div>
            </header>
            <div className="skill-matrix-scroll">
              <div className="skill-matrix-grid" style={{ gridTemplateColumns: `250px repeat(${visibleSkills.length}, minmax(112px, 1fr))` }}>
                <div className="skill-matrix-person sticky"><strong>人员 / 岗位</strong><small>{visibleEmployees.length} 人</small></div>
                {visibleSkills.map(skill => (
                  <div className="skill-matrix-skill" key={skill.id}>
                    <span>{skill.category === 'PROCESS' ? '工序技能' : '岗位能力'}</span>
                    <strong>{skill.name}</strong>
                    {skill.isCritical && <small>关键技能</small>}
                  </div>
                ))}
                {visibleEmployees.map(employee => (
                  <div className="skill-matrix-row" key={employee.id} style={{ display: 'contents' }}>
                    <button type="button" className="skill-matrix-person sticky" onClick={() => changeEmployee(employee)}>
                      <b>{employee.name.slice(0, 1)}</b>
                      <span><strong>{employee.name}</strong><small>{employee.position || '岗位待维护'} · {employee.team || employee.department || '未分组'}</small></span>
                      <ChevronRight />
                    </button>
                    {visibleSkills.map(skill => <div key={`${employee.id}-${skill.id}`}>{matrixCell(employee, skill)}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderPeople() {
    const currentCertifications = certifications.filter(certification => certification.employeeId === selectedEmployeeId);
    const qualifiedCount = employeeRequirements.filter(requirement => {
      const certification = certificationsByPair.get(`${selectedEmployeeId}:${requirement.skillId}`);
      return certification && certification.level >= requirement.targetLevel;
    }).length;
    return (
      <div className="skill-people-layout">
        <aside className="skill-people-list">
          <header><div><span className="skill-eyebrow">员工技能</span><h2>人员列表</h2></div><em>{visibleEmployees.length} 人</em></header>
          <label><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索员工或岗位" /></label>
          <div>
            {visibleEmployees.map(employee => {
              const count = certifications.filter(certification => certification.employeeId === employee.id && certification.status === 'ACTIVE').length;
              return (
                <button type="button" className={selectedEmployeeId === employee.id ? 'selected' : ''} key={employee.id} onClick={() => setSelectedEmployeeId(employee.id)}>
                  <b>{employee.name.slice(0, 1)}</b>
                  <span><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || '岗位待维护'}</small></span>
                  <em>{count} 项</em>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="skill-person-workspace">
          {selectedEmployee ? (
            <>
              <header className="skill-person-identity">
                <b>{selectedEmployee.name.slice(0, 1)}</b>
                <div>
                  <span className="skill-eyebrow">技能档案</span>
                  <h1>{selectedEmployee.name}<small>{selectedEmployee.employeeNo}</small></h1>
                  <p>{selectedEmployee.department || '部门待维护'} · {selectedEmployee.position || '岗位待维护'} · {selectedEmployee.team || '班组待维护'}</p>
                </div>
                <div className="skill-person-identity-stats">
                  <span><small>岗位必备</small><strong>{employeeRequirements.length}</strong></span>
                  <span><small>已认证</small><strong>{currentCertifications.length}</strong></span>
                  <span><small>达到要求</small><strong>{qualifiedCount}/{employeeRequirements.length}</strong></span>
                </div>
                <button type="button" className="skill-primary-button" onClick={() => openLaunchDialog(selectedEmployee.id)}><ClipboardCheck />发起考核</button>
              </header>
              <div className="skill-person-main">
                <section className="skill-person-skills">
                  <header><div><span className="skill-eyebrow">能力证据</span><h2>岗位技能与认证</h2></div><button type="button" onClick={() => openRequirementDialog(selectedEmployee)}><Plus />补充岗位技能</button></header>
                  <div>
                    {employeeSkills.map(skill => {
                      const requirement = employeeRequirements.find(item => item.skillId === skill.id);
                      const certification = certificationsByPair.get(`${selectedEmployee.id}:${skill.id}`);
                      const level = certification?.level || 0;
                      const expired = certification?.expiresAt && new Date(certification.expiresAt).getTime() < Date.now();
                      return (
                        <article key={skill.id} className={expired ? 'expired' : certification ? 'certified' : 'gap'}>
                          <header>
                            <span><Award /></span>
                            <div><small>{requirement ? `岗位要求 L${requirement.targetLevel}` : '扩展技能'}</small><h3>{skill.name}</h3></div>
                            <b>{expired ? '已过期' : certification ? levelLabels[level] : '待考核'}</b>
                          </header>
                          <div className="skill-level-track">
                            {[1, 2, 3, 4].map(value => <i className={value <= level && !expired ? 'active' : ''} key={value}>L{value}</i>)}
                          </div>
                          <footer>
                            <span><small>最近得分</small><strong>{certification?.score ?? '—'}</strong></span>
                            <span><small>有效期至</small><strong>{formatDate(certification?.expiresAt)}</strong></span>
                            <button type="button" onClick={() => {
                              const template = filteredTemplates.find(item => item.skillId === skill.id && item.position === (selectedEmployee.position || ''));
                              openLaunchDialog(selectedEmployee.id, template?.id);
                            }}>考核 / 复评<ChevronRight /></button>
                          </footer>
                        </article>
                      );
                    })}
                    {!employeeSkills.length && (
                      <div className="skill-inline-empty"><GraduationCap /><strong>该岗位尚未配置技能要求</strong><p>先为岗位添加必备技能，再发起员工考核。</p><button type="button" onClick={() => openRequirementDialog(selectedEmployee)}>配置岗位技能</button></div>
                    )}
                  </div>
                </section>
                <aside className="skill-person-side">
                  <section>
                    <header><span className="skill-eyebrow">本期状态</span><h2>技能覆盖</h2></header>
                    <div className="skill-coverage-ring" style={{ '--skill-progress': `${employeeRequirements.length ? Math.round((qualifiedCount / employeeRequirements.length) * 100) : 0}%` } as CSSProperties}>
                      <strong>{employeeRequirements.length ? Math.round((qualifiedCount / employeeRequirements.length) * 100) : 0}%</strong>
                      <small>岗位要求达成</small>
                    </div>
                  </section>
                  <section>
                    <header><span className="skill-eyebrow">考核记录</span><h2>最近动态</h2></header>
                    <div className="skill-person-timeline">
                      {assessments.filter(assessment => assessment.employeeId === selectedEmployee.id).slice(0, 5).map(assessment => (
                        <button type="button" key={assessment.id} onClick={() => openAssessment(assessment)}>
                          <i />
                          <span><strong>{assessment.skill.name}</strong><small>{statusLabels[assessment.status]} · {formatDate(assessment.updatedAt)}</small></span>
                          <ChevronRight />
                        </button>
                      ))}
                      {!assessments.some(assessment => assessment.employeeId === selectedEmployee.id) && <p>尚无考核记录</p>}
                    </div>
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <div className="skill-empty-state"><span><UserRound /></span><div><h2>请选择员工</h2><p>从左侧列表选择员工后查看技能档案。</p></div></div>
          )}
        </section>
      </div>
    );
  }

  function renderAssessments() {
    const pending = assessments.filter(assessment => assessment.status === 'PENDING_REVIEW');
    const activeTemplate = templates.find(template => template.id === selectedTemplateId) || null;
    return (
      <div className="skill-assessment-layout">
        <aside className="skill-template-list">
          <header><div><span className="skill-eyebrow">岗位标准</span><h2>考核表</h2></div><button type="button" onClick={() => openTemplateDialog()}><Plus /></button></header>
          <div>
            {templates.map(template => (
              <button type="button" className={selectedTemplateId === template.id ? 'selected' : ''} onClick={() => setSelectedTemplateId(template.id)} key={template.id}>
                <span><FileCheck2 /></span>
                <div><small>{template.department} · {template.position}</small><strong>{template.name}</strong><em>V{template.version} · {template.items.length} 项 · 合格 {template.passScore} 分</em></div>
                <b>{template.status === 'ACTIVE' ? '生效中' : '已冻结'}</b>
              </button>
            ))}
            {!templates.length && <div className="skill-list-empty"><FileText /><strong>暂无岗位考核表</strong><button type="button" onClick={() => openTemplateDialog()}>创建第一张</button></div>}
          </div>
        </aside>
        <section className="skill-assessment-workspace">
          <header className="skill-assessment-heading">
            <div>
              <span className="skill-eyebrow">技能考核与审核</span>
              <h1>{activeTemplate?.name || '岗位技能考核工作台'}</h1>
              <p>{activeTemplate ? `${activeTemplate.department} · ${activeTemplate.position} · V${activeTemplate.version} · 目标 L${activeTemplate.targetLevel}` : '建立岗位模板后，可在线填报、指定审核人并形成技能认证。'}</p>
            </div>
            <div>
              {activeTemplate && <button type="button" className="skill-secondary-button" onClick={() => window.open(`/workspace/employees/skills/templates/${activeTemplate.id}/print`, '_blank', 'noopener,noreferrer')}><Printer />空白表打印</button>}
              {activeTemplate && <button type="button" className="skill-secondary-button" onClick={() => openTemplateDialog(activeTemplate)}><FileText />复制为新版</button>}
              <button type="button" className="skill-primary-button" disabled={!activeTemplate} onClick={() => openLaunchDialog(selectedEmployeeId, activeTemplate?.id)}><Plus />发起考核</button>
            </div>
          </header>
          <section className="skill-assessment-kpis">
            <button type="button"><span><ClipboardCheck /></span><small>全部考核</small><strong>{assessments.length}</strong></button>
            <button type="button" className={pending.length ? 'attention' : ''}><span><Clock3 /></span><small>待我审核</small><strong>{pending.length}</strong></button>
            <button type="button"><span><CheckCircle2 /></span><small>认证通过</small><strong>{assessments.filter(item => item.status === 'APPROVED').length}</strong></button>
            <button type="button"><span><AlertTriangle /></span><small>退回修改</small><strong>{assessments.filter(item => item.status === 'RETURNED').length}</strong></button>
          </section>
          <section className="skill-assessment-table">
            <header><span>员工 / 技能</span><span>岗位考核表</span><span>填报与审核</span><span>得分 / 等级</span><span>状态</span><span>操作</span></header>
            <div>
              {assessments.map(assessment => (
                <article className={assessment.status === 'PENDING_REVIEW' ? 'pending' : ''} key={assessment.id}>
                  <span><b>{assessment.employee.name.slice(0, 1)}</b><strong>{assessment.employee.name}<small>{assessment.skill.name}</small></strong></span>
                  <span><strong>{assessment.template.name}</strong><small>V{assessment.templateVersion} · {assessment.code}</small></span>
                  <span><strong>{assessment.assessor?.name || '待确认'} → {assessment.reviewer?.name || '待确认'}</strong><small>更新 {formatDate(assessment.updatedAt)}</small></span>
                  <span><strong>{assessment.totalScore ?? '—'} 分</strong><small>拟认证 L{assessment.proposedLevel}</small></span>
                  <span><em className={`status-${assessment.status.toLowerCase()}`}>{statusLabels[assessment.status]}</em></span>
                  <span>
                    <button type="button" onClick={() => openAssessment(assessment)}>{assessment.status === 'PENDING_REVIEW' ? '进入审核' : assessment.status === 'DRAFT' || assessment.status === 'RETURNED' ? '继续填报' : '查看记录'}</button>
                    <button type="button" title="打印或导出 PDF" onClick={() => window.open(`/workspace/employees/skills/assessments/${assessment.id}/print`, '_blank', 'noopener,noreferrer')}><Printer /></button>
                  </span>
                </article>
              ))}
              {!assessments.length && <div className="skill-inline-empty"><ClipboardCheck /><strong>暂无技能考核任务</strong><p>选择岗位考核表并发起第一项考核。</p></div>}
            </div>
          </section>
        </section>
      </div>
    );
  }

  const assessmentReadOnly = selectedAssessment
    ? ['APPROVED', 'CANCELLED'].includes(selectedAssessment.status)
    : true;

  return (
    <div className="skill-workbench">
      <section className="skill-hero">
        <div>
          <span className="skill-eyebrow"><Sparkles />技能绩效 · 人员能力工作台</span>
          <h1>员工技能、岗位矩阵与考核认证</h1>
          <p>技能等级只由岗位考核和审核结果形成；生产达成率仍在报表中心独立核算。</p>
        </div>
        <div className="skill-hero-actions">
          <a href="/workspace/reports" className="skill-secondary-button">生产绩效报表<ChevronRight /></a>
          <button type="button" className="skill-primary-button" onClick={() => openLaunchDialog()}><ClipboardCheck />发起技能考核</button>
        </div>
      </section>

      <section className="skill-health-strip">
        <div><span><Grid3X3 /></span><small>技能目录</small><strong>{summary.skillCount}</strong><em>{summary.requiredPositionCount} 个岗位已配置</em></div>
        <div><span><ShieldCheck /></span><small>岗位技能覆盖</small><strong>{formatPercent(summary.coverageBasisPoints)}</strong><em>按岗位要求与有效认证统计</em></div>
        <div><span><UsersRound /></span><small>已认证员工</small><strong>{summary.certifiedEmployeeCount}</strong><em>当前有效技能认证</em></div>
        <div className={summary.pendingReviewCount ? 'attention' : ''}><span><ClipboardCheck /></span><small>待审核考核</small><strong>{summary.pendingReviewCount}</strong><em>审核后才更新技能等级</em></div>
        <div className={summary.expiringCertificationCount ? 'warning' : ''}><span><CalendarClock /></span><small>30 天内到期</small><strong>{summary.expiringCertificationCount}</strong><em>建议安排复评</em></div>
      </section>

      <nav className="skill-subnav" aria-label="技能绩效功能">
        <button type="button" className={activeView === 'matrix' ? 'active' : ''} onClick={() => setActiveView('matrix')}><Grid3X3 />技能矩阵</button>
        <button type="button" className={activeView === 'people' ? 'active' : ''} onClick={() => setActiveView('people')}><UserRound />员工技能</button>
        <button type="button" className={activeView === 'assessments' ? 'active' : ''} onClick={() => setActiveView('assessments')}><ClipboardCheck />岗位考核与审核{summary.pendingReviewCount > 0 && <em>{summary.pendingReviewCount}</em>}</button>
        <button type="button" className="refresh" title="刷新技能数据" onClick={() => void loadWorkbench()}><RefreshCw /></button>
      </nav>

      {error ? (
        <div className="skill-error"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => void loadWorkbench()}>重新加载</button></div>
      ) : (
        <div className="skill-view-stage">
          {activeView === 'matrix' && renderMatrix()}
          {activeView === 'people' && renderPeople()}
          {activeView === 'assessments' && renderAssessments()}
        </div>
      )}

      {loading && <div className="skill-loading"><Loader2 className="spin" />正在汇总技能绩效数据</div>}

      {dialog && (
        <div className="skill-dialog-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && !saving) setDialog(null);
        }}>
          <section className={`skill-dialog dialog-${dialog}`} role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="skill-eyebrow">
                  {dialog === 'skill' ? '技能目录' : dialog === 'requirement' ? '岗位标准' : dialog === 'template' ? '考核模板' : dialog === 'launch' ? '考核任务' : '在线考核'}
                </span>
                <h2>
                  {dialog === 'skill' ? '新增技能' : dialog === 'requirement' ? '配置岗位技能要求' : dialog === 'template' ? `${templateBaseId ? '建立新版' : '新建'}岗位技能考核表` : dialog === 'launch' ? '发起技能考核' : selectedAssessment?.template.name}
                </h2>
                {dialog === 'assessment' && selectedAssessment && <p>{selectedAssessment.employee.name} · {selectedAssessment.skill.name} · {statusLabels[selectedAssessment.status]}</p>}
              </div>
              <button type="button" aria-label="关闭" disabled={saving} onClick={() => setDialog(null)}><X /></button>
            </header>

            <div className="skill-dialog-body">
              {dialog === 'skill' && (
                <div className="skill-form-grid">
                  <label><span>技能名称 *</span><input value={skillDraft.name} onChange={event => setSkillDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：压接设备独立操作" /></label>
                  <label><span>技能分类 *</span><select value={skillDraft.category} onChange={event => setSkillDraft(current => ({ ...current, category: event.target.value }))}><option value="PROCESS">生产工序</option><option value="QUALITY">质量检验</option><option value="WAREHOUSE">仓库作业</option><option value="SAFETY">安全规范</option><option value="MANAGEMENT">管理能力</option><option value="GENERAL">通用能力</option></select></label>
                  <label><span>默认有效期（月）</span><input type="number" min="1" max="120" value={skillDraft.defaultValidityMonths} onChange={event => setSkillDraft(current => ({ ...current, defaultValidityMonths: event.target.value }))} /></label>
                  <label className="skill-check"><input type="checkbox" checked={skillDraft.isCritical} onChange={event => setSkillDraft(current => ({ ...current, isCritical: event.target.checked }))} /><span><strong>关键技能</strong><small>考核时默认作为重点能力</small></span></label>
                  <label className="wide"><span>技能说明</span><textarea value={skillDraft.description} onChange={event => setSkillDraft(current => ({ ...current, description: event.target.value }))} placeholder="适用范围、独立操作标准和注意事项" /></label>
                  <button type="button" className="skill-inline-action wide" disabled={saving} onClick={() => void syncProcesses()}><RefreshCw />也可以从产品工序与工时同步全部现有工序</button>
                </div>
              )}

              {dialog === 'requirement' && (
                <div className="skill-form-grid">
                  <label><span>部门 *</span><select value={requirementDraft.department} onChange={event => setRequirementDraft(current => ({ ...current, department: event.target.value, position: '', team: '' }))}><option value="">请选择</option>{departments.map(department => <option value={department} key={department}>{department}</option>)}</select></label>
                  <label><span>岗位 *</span><select value={requirementDraft.position} onChange={event => setRequirementDraft(current => ({ ...current, position: event.target.value }))}><option value="">请选择</option>{[...new Set(activeEmployees.filter(employee => employee.department === requirementDraft.department).map(employee => employee.position || '').filter(Boolean))].map(position => <option value={position} key={position}>{position}</option>)}</select></label>
                  <label><span>班组（可选）</span><select value={requirementDraft.team} onChange={event => setRequirementDraft(current => ({ ...current, team: event.target.value }))}><option value="">岗位全部人员</option>{[...new Set(activeEmployees.filter(employee => employee.department === requirementDraft.department && employee.position === requirementDraft.position).map(employee => employee.team || '').filter(Boolean))].map(team => <option value={team} key={team}>{team}</option>)}</select></label>
                  <label><span>必备技能 *</span><select value={requirementDraft.skillId} onChange={event => setRequirementDraft(current => ({ ...current, skillId: event.target.value }))}><option value="">请选择</option>{visibleSkills.map(skill => <option value={skill.id} key={skill.id}>{skill.name}</option>)}</select></label>
                  <label className="wide"><span>岗位目标等级 *</span><div className="skill-level-picker">{[1, 2, 3, 4].map(level => <button type="button" className={requirementDraft.targetLevel === String(level) ? 'active' : ''} onClick={() => setRequirementDraft(current => ({ ...current, targetLevel: String(level) }))} key={level}><strong>L{level}</strong><small>{levelLabels[level].replace(`L${level} `, '')}</small></button>)}</div></label>
                </div>
              )}

              {dialog === 'template' && (
                <div className="skill-template-editor">
                  {templateBaseId && selectedTemplate && <div className="skill-version-note"><ShieldCheck /><span><strong>旧版 V{selectedTemplate.version} 不会被覆盖</strong><small>保存后生成新版，已使用旧版的考核记录保持不变。</small></span></div>}
                  <div className="skill-form-grid">
                    <label><span>考核表名称 *</span><input value={templateDraft.name} onChange={event => setTemplateDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：压接工岗位 L2 技能考核表" /></label>
                    <label><span>关联技能 *</span><select value={templateDraft.skillId} onChange={event => setTemplateDraft(current => ({ ...current, skillId: event.target.value }))}><option value="">请选择</option>{visibleSkills.map(skill => <option value={skill.id} key={skill.id}>{skill.name}</option>)}</select></label>
                    <label><span>适用部门 *</span><select value={templateDraft.department} onChange={event => setTemplateDraft(current => ({ ...current, department: event.target.value, position: '', team: '' }))}><option value="">请选择</option>{departments.map(department => <option value={department} key={department}>{department}</option>)}</select></label>
                    <label><span>适用岗位 *</span><select value={templateDraft.position} onChange={event => setTemplateDraft(current => ({ ...current, position: event.target.value }))}><option value="">请选择</option>{[...new Set(activeEmployees.filter(employee => employee.department === templateDraft.department).map(employee => employee.position || '').filter(Boolean))].map(position => <option value={position} key={position}>{position}</option>)}</select></label>
                    <label><span>适用班组</span><select value={templateDraft.team} onChange={event => setTemplateDraft(current => ({ ...current, team: event.target.value }))}><option value="">岗位全部人员</option>{[...new Set(activeEmployees.filter(employee => employee.department === templateDraft.department && employee.position === templateDraft.position).map(employee => employee.team || '').filter(Boolean))].map(team => <option value={team} key={team}>{team}</option>)}</select></label>
                    <label><span>目标等级</span><select value={templateDraft.targetLevel} onChange={event => setTemplateDraft(current => ({ ...current, targetLevel: event.target.value }))}>{[1, 2, 3, 4].map(level => <option value={level} key={level}>{levelLabels[level]}</option>)}</select></label>
                    <label><span>合格分</span><input type="number" min="1" max="100" value={templateDraft.passScore} onChange={event => setTemplateDraft(current => ({ ...current, passScore: event.target.value }))} /></label>
                    <label><span>认证有效期（月）</span><input type="number" min="1" max="120" value={templateDraft.validityMonths} onChange={event => setTemplateDraft(current => ({ ...current, validityMonths: event.target.value }))} /></label>
                    <label className="wide"><span>考核说明</span><textarea value={templateDraft.instructions} onChange={event => setTemplateDraft(current => ({ ...current, instructions: event.target.value }))} /></label>
                  </div>
                  <section className="skill-template-items">
                    <header><div><span className="skill-eyebrow">评分项目</span><h3>考核明细</h3></div><button type="button" onClick={() => setTemplateDraft(current => ({ ...current, items: [...current.items, { section: '岗位实操', title: '', maxScore: '10', weight: '10', isRequired: true, isCritical: false }] }))}><Plus />新增项目</button></header>
                    <div>
                      {templateDraft.items.map((item, index) => (
                        <article key={index}>
                          <b>{String(index + 1).padStart(2, '0')}</b>
                          <input value={item.section} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, section: event.target.value } : candidate) }))} placeholder="项目分组" />
                          <input className="title" value={item.title} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, title: event.target.value } : candidate) }))} placeholder="考核项目与可观察标准" />
                          <label><span>满分</span><input type="number" min="1" value={item.maxScore} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, maxScore: event.target.value } : candidate) }))} /></label>
                          <label><span>权重</span><input type="number" min="1" value={item.weight} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, weight: event.target.value } : candidate) }))} /></label>
                          <label className="flag"><input type="checkbox" checked={item.isRequired} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, isRequired: event.target.checked } : candidate) }))} />必考</label>
                          <label className="flag danger"><input type="checkbox" checked={item.isCritical} onChange={event => setTemplateDraft(current => ({ ...current, items: current.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, isCritical: event.target.checked } : candidate) }))} />红线</label>
                          <button type="button" title="删除项目" disabled={templateDraft.items.length <= 1} onClick={() => setTemplateDraft(current => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></button>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {dialog === 'launch' && (
                <div className="skill-form-grid">
                  <label className="wide"><span>被考核员工 *</span><select value={launchDraft.employeeId} onChange={event => {
                    const employee = employees.find(item => item.id === event.target.value);
                    const template = filteredTemplates.find(item => item.department === (employee?.department || '') && item.position === (employee?.position || '') && (!item.team || item.team === (employee?.team || '')));
                    setLaunchDraft(current => ({ ...current, employeeId: event.target.value, templateId: template?.id || '', assessorId: event.target.value, reviewerId: current.reviewerId === event.target.value ? '' : current.reviewerId, proposedLevel: String(template?.targetLevel || 2) }));
                  }}><option value="">请选择</option>{activeEmployees.map(employee => <option value={employee.id} key={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
                  <label className="wide"><span>岗位技能考核表 *</span><select value={launchDraft.templateId} onChange={event => {
                    const template = templates.find(item => item.id === event.target.value);
                    setLaunchDraft(current => ({ ...current, templateId: event.target.value, proposedLevel: String(template?.targetLevel || current.proposedLevel) }));
                  }}><option value="">请选择适用考核表</option>{filteredTemplates.filter(template => {
                    const employee = employees.find(item => item.id === launchDraft.employeeId);
                    return !employee || (template.department === (employee.department || '') && template.position === (employee.position || '') && (!template.team || template.team === (employee.team || '')));
                  }).map(template => <option value={template.id} key={template.id}>{template.name} · V{template.version}</option>)}</select></label>
                  <label><span>填报 / 考核人 *</span><select value={launchDraft.assessorId} onChange={event => setLaunchDraft(current => ({ ...current, assessorId: event.target.value }))}><option value="">请选择</option>{activeEmployees.filter(employee => employee.id !== launchDraft.reviewerId).map(employee => <option value={employee.id} key={employee.id}>{employeeLabel(employee)}</option>)}</select><small>可由员工本人在线自评，也可由组长现场填报</small></label>
                  <label><span>审核人 *</span><select value={launchDraft.reviewerId} onChange={event => setLaunchDraft(current => ({ ...current, reviewerId: event.target.value }))}><option value="">请选择</option>{activeEmployees.filter(employee => employee.id !== launchDraft.employeeId && employee.id !== launchDraft.assessorId).map(employee => <option value={employee.id} key={employee.id}>{employeeLabel(employee)}</option>)}</select><small>审核人必须与被考核人、填报人分开</small></label>
                  <label className="wide"><span>拟认证等级</span><div className="skill-level-picker">{[1, 2, 3, 4].map(level => <button type="button" className={launchDraft.proposedLevel === String(level) ? 'active' : ''} onClick={() => setLaunchDraft(current => ({ ...current, proposedLevel: String(level) }))} key={level}><strong>L{level}</strong><small>{levelLabels[level].replace(`L${level} `, '')}</small></button>)}</div></label>
                  <div className="skill-version-note wide"><ShieldCheck /><span><strong>考核表版本会在任务创建时冻结</strong><small>后续模板升级不会改变本次评分项目、合格线和审核记录。</small></span></div>
                </div>
              )}

              {dialog === 'assessment' && selectedAssessment && (
                <div className="skill-online-assessment">
                  <section className="skill-assessment-context">
                    <div><small>被考核员工</small><strong>{employeeLabel(selectedAssessment.employee)}</strong></div>
                    <div><small>填报 / 考核人</small><strong>{employeeLabel(selectedAssessment.assessor)}</strong></div>
                    <div><small>审核人</small><strong>{employeeLabel(selectedAssessment.reviewer)}</strong></div>
                    <div><small>模板与合格线</small><strong>V{selectedAssessment.templateVersion} · {selectedAssessment.template.passScore} 分</strong></div>
                  </section>
                  {selectedAssessment.status === 'RETURNED' && selectedAssessment.reviewComment && <div className="skill-return-note"><AlertTriangle /><span><strong>审核退回</strong><small>{selectedAssessment.reviewComment}</small></span></div>}
                  <section className="skill-score-sheet">
                    <header><span>考核项目</span><span>满分</span><span>得分</span><span>红线判定</span><span>现场说明</span></header>
                    <div>
                      {selectedAssessment.template.items.map((item, index) => {
                        const draftAnswer = answerDrafts[item.id] || { score: '', passed: true, comment: '' };
                        return (
                          <article key={item.id} className={item.isCritical ? 'critical' : ''}>
                            <span><b>{String(index + 1).padStart(2, '0')}</b><div><small>{item.section}{item.isRequired ? ' · 必考' : ''}{item.isCritical ? ' · 红线' : ''}</small><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div></span>
                            <span>{item.maxScore}</span>
                            <span><input disabled={assessmentReadOnly || selectedAssessment.status === 'PENDING_REVIEW'} type="number" min="0" max={item.maxScore} value={draftAnswer.score} onChange={event => setAnswerDrafts(current => ({ ...current, [item.id]: { ...draftAnswer, score: event.target.value } }))} /></span>
                            <span><button type="button" disabled={assessmentReadOnly || selectedAssessment.status === 'PENDING_REVIEW' || !item.isCritical} className={draftAnswer.passed ? 'pass' : 'fail'} onClick={() => setAnswerDrafts(current => ({ ...current, [item.id]: { ...draftAnswer, passed: !draftAnswer.passed } }))}>{!item.isCritical ? '非红线' : draftAnswer.passed ? '通过' : '未通过'}</button></span>
                            <span><input disabled={assessmentReadOnly || selectedAssessment.status === 'PENDING_REVIEW'} value={draftAnswer.comment} onChange={event => setAnswerDrafts(current => ({ ...current, [item.id]: { ...draftAnswer, comment: event.target.value } }))} placeholder="记录观察证据或改进项" /></span>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                  <section className="skill-review-panel">
                    <label><span>拟认证等级</span><select disabled={assessmentReadOnly || selectedAssessment.status === 'PENDING_REVIEW'} value={proposedLevel} onChange={event => setProposedLevel(event.target.value)}>{[1, 2, 3, 4].map(level => <option value={level} key={level}>{levelLabels[level]}</option>)}</select></label>
                    <label className="wide"><span>{selectedAssessment.status === 'PENDING_REVIEW' ? '审核意见' : '填报说明'}</span><textarea disabled={assessmentReadOnly} value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder={selectedAssessment.status === 'PENDING_REVIEW' ? '通过可留空；退回时必须填写修改意见' : '补充考核场景、设备或证据说明'} /></label>
                  </section>
                  <section className="skill-audit-trail">
                    <header><span className="skill-eyebrow">留痕记录</span><h3>考核流转</h3></header>
                    <div>{selectedAssessment.activities.slice(0, 6).map(activity => <span key={activity.id}><i /><strong>{activity.content || activity.action}</strong><small>{formatDate(activity.createdAt)}</small></span>)}</div>
                  </section>
                </div>
              )}

              {dialogError && <div className="skill-dialog-error" role="alert"><AlertTriangle />{dialogError}</div>}
            </div>

            <footer>
              <button type="button" className="skill-secondary-button" disabled={saving} onClick={() => setDialog(null)}>取消</button>
              {dialog === 'skill' && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void createSkill()}>{saving ? <Loader2 className="spin" /> : <Save />}保存技能</button>}
              {dialog === 'requirement' && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void saveRequirement()}>{saving ? <Loader2 className="spin" /> : <Save />}保存岗位要求</button>}
              {dialog === 'template' && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void createTemplate()}>{saving ? <Loader2 className="spin" /> : <FileCheck2 />}生成并启用考核表</button>}
              {dialog === 'launch' && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void launchAssessment()}>{saving ? <Loader2 className="spin" /> : <Plus />}创建考核任务</button>}
              {dialog === 'assessment' && selectedAssessment && (
                <>
                  <button type="button" className="skill-secondary-button" onClick={() => window.open(`/workspace/employees/skills/assessments/${selectedAssessment.id}/print`, '_blank', 'noopener,noreferrer')}><Download />打印 / 导出 PDF</button>
                  {['DRAFT', 'RETURNED'].includes(selectedAssessment.status) && <button type="button" className="skill-secondary-button" disabled={saving} onClick={() => void updateAssessment('save')}><Save />保存草稿</button>}
                  {['DRAFT', 'RETURNED'].includes(selectedAssessment.status) && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void updateAssessment('submit')}><Send />提交审核</button>}
                  {selectedAssessment.status === 'PENDING_REVIEW' && <button type="button" className="skill-return-button" disabled={saving} onClick={() => void updateAssessment('return')}>退回修改</button>}
                  {selectedAssessment.status === 'PENDING_REVIEW' && <button type="button" className="skill-primary-button" disabled={saving} onClick={() => void updateAssessment('approve')}><BadgeCheck />审核通过并认证</button>}
                </>
              )}
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
