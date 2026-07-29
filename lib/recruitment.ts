import {
  RecruitmentCandidateStatus,
  RecruitmentDemandStatus,
  RecruitmentInterviewStatus,
  RecruitmentPriority,
  type Prisma,
} from '@prisma/client';
import type {
  RecruitmentActivityDTO,
  RecruitmentCandidateDTO,
  RecruitmentCandidateStatusDTO,
  RecruitmentDemandDTO,
  RecruitmentDemandStatusDTO,
  RecruitmentInterviewDTO,
  RecruitmentPriorityDTO,
  RecruitmentSummaryDTO,
} from '@/types';

export const RECRUITMENT_ACTIVE_DEMAND_STATUSES: RecruitmentDemandStatus[] = [
  RecruitmentDemandStatus.DRAFT,
  RecruitmentDemandStatus.PENDING_APPROVAL,
  RecruitmentDemandStatus.RECRUITING,
  RecruitmentDemandStatus.INTERVIEWING,
  RecruitmentDemandStatus.OFFER,
];

export const recruitmentDemandInclude = {
  requester: true,
  coordinator: true,
  candidates: {
    include: {
      employee: true,
      interviews: {
        include: { interviewer: true },
        orderBy: [{ round: 'asc' as const }],
      },
    },
    orderBy: [{ updatedAt: 'desc' as const }],
  },
  activities: {
    include: {
      actor: {
        select: { id: true, username: true, displayName: true },
      },
    },
    orderBy: [{ createdAt: 'desc' as const }],
    take: 30,
  },
} satisfies Prisma.RecruitmentDemandInclude;

type RecruitmentDemandRecord = Prisma.RecruitmentDemandGetPayload<{
  include: typeof recruitmentDemandInclude;
}>;

type RecruitmentCandidateRecord = RecruitmentDemandRecord['candidates'][number];
type RecruitmentInterviewRecord = RecruitmentCandidateRecord['interviews'][number];
type RecruitmentActivityRecord = RecruitmentDemandRecord['activities'][number];

const demandStatusText: Record<RecruitmentDemandStatusDTO, string> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审批',
  RECRUITING: '招聘中',
  INTERVIEWING: '面试中',
  OFFER: '待录用',
  CLOSED: '已完成',
  CANCELLED: '已取消',
};

const priorityText: Record<RecruitmentPriorityDTO, string> = {
  NORMAL: '常规',
  HIGH: '优先',
  URGENT: '紧急',
};

const candidateStatusText: Record<RecruitmentCandidateStatusDTO, string> = {
  SCREENING: '筛选中',
  INTERVIEW: '面试中',
  OFFER: '待录用',
  HIRED: '已入职',
  REJECTED: '未通过',
  WITHDRAWN: '已退出',
};

const interviewStatusText: Record<string, string> = {
  SCHEDULED: '待面试',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const interviewResultText: Record<string, string> = {
  pending: '待评估',
  pass: '通过',
  hold: '待定',
  reject: '未通过',
  no_show: '未到场',
};

const employmentTypeText: Record<string, string> = {
  full_time: '正式员工',
  temporary: '临时用工',
  intern: '实习',
  contractor: '劳务协作',
};

const activityText: Record<string, string> = {
  create: '创建招聘需求',
  update: '更新需求信息',
  submit: '提交需求审批',
  approve: '审批通过并启动招聘',
  return_draft: '退回需求修改',
  cancel: '取消招聘需求',
  reopen: '重新开启招聘需求',
  add_candidate: '录入候选人',
  update_candidate: '更新候选人',
  schedule_interview: '安排面试',
  complete_interview: '完成面试评估',
  cancel_interview: '取消面试',
  hire_candidate: '录用并建立员工档案',
  close: '完成招聘需求',
};

export class RecruitmentInputError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RecruitmentInputError';
    this.statusCode = statusCode;
  }
}

export function cleanRecruitmentText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function parseRecruitmentDate(value: unknown, fieldName: string): Date | null {
  const text = cleanRecruitmentText(value, 30);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new RecruitmentInputError(`${fieldName}格式不正确`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new RecruitmentInputError(`${fieldName}格式不正确`);
  return date;
}

export function parseRecruitmentDateTime(value: unknown, fieldName: string): Date | null {
  const text = cleanRecruitmentText(value, 60);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new RecruitmentInputError(`${fieldName}格式不正确`);
  return date;
}

export function parseDemandCreateInput(body: Record<string, unknown>) {
  const department = cleanRecruitmentText(body.department, 80);
  const position = cleanRecruitmentText(body.position, 100);
  const reason = cleanRecruitmentText(body.reason, 500);
  const headcount = Number(body.headcount);
  if (!department) throw new RecruitmentInputError('请选择用人部门');
  if (!position) throw new RecruitmentInputError('请填写招聘岗位');
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 999) {
    throw new RecruitmentInputError('招聘人数应为 1–999 的整数');
  }
  if (!reason) throw new RecruitmentInputError('请填写招聘原因');
  const priority = cleanRecruitmentText(body.priority, 20) || RecruitmentPriority.NORMAL;
  if (!Object.values(RecruitmentPriority).includes(priority as RecruitmentPriority)) {
    throw new RecruitmentInputError('招聘优先级不正确');
  }
  const employmentType = cleanRecruitmentText(body.employmentType, 30) || 'full_time';
  if (!Object.hasOwn(employmentTypeText, employmentType)) {
    throw new RecruitmentInputError('用工类型不正确');
  }
  return {
    department,
    position,
    team: cleanRecruitmentText(body.team, 80) || null,
    headcount,
    employmentType,
    priority: priority as RecruitmentPriority,
    reason,
    requirements: cleanRecruitmentText(body.requirements, 2_000) || null,
    targetDate: parseRecruitmentDate(body.targetDate, '期望到岗日期'),
    requesterId: cleanRecruitmentText(body.requesterId, 80) || null,
    coordinatorId: cleanRecruitmentText(body.coordinatorId, 80) || null,
  };
}

export function parseDemandUpdateInput(
  body: Record<string, unknown>,
  current: {
    department: string;
    position: string;
    team: string | null;
    headcount: number;
    employmentType: string;
    priority: RecruitmentPriority;
    reason: string;
    requirements: string | null;
    targetDate: Date | null;
    requesterId: string | null;
    coordinatorId: string | null;
  },
) {
  return parseDemandCreateInput({
    department: body.department === undefined ? current.department : body.department,
    position: body.position === undefined ? current.position : body.position,
    team: body.team === undefined ? current.team : body.team,
    headcount: body.headcount === undefined ? current.headcount : body.headcount,
    employmentType: body.employmentType === undefined ? current.employmentType : body.employmentType,
    priority: body.priority === undefined ? current.priority : body.priority,
    reason: body.reason === undefined ? current.reason : body.reason,
    requirements: body.requirements === undefined ? current.requirements : body.requirements,
    targetDate: body.targetDate === undefined
      ? current.targetDate?.toISOString().slice(0, 10)
      : body.targetDate,
    requesterId: body.requesterId === undefined ? current.requesterId : body.requesterId,
    coordinatorId: body.coordinatorId === undefined ? current.coordinatorId : body.coordinatorId,
  });
}

export function prepareDemandTransition(
  status: RecruitmentDemandStatus,
  action: string,
  hiredCount: number,
  headcount: number,
): {
  nextStatus: RecruitmentDemandStatus;
  approvedAt?: Date | null;
  openedAt?: Date | null;
  closedAt?: Date | null;
  cancelledAt?: Date | null;
} {
  const now = new Date();
  if (action === 'submit' && status === RecruitmentDemandStatus.DRAFT) {
    return { nextStatus: RecruitmentDemandStatus.PENDING_APPROVAL };
  }
  if (action === 'approve' && status === RecruitmentDemandStatus.PENDING_APPROVAL) {
    return {
      nextStatus: RecruitmentDemandStatus.RECRUITING,
      approvedAt: now,
      openedAt: now,
      cancelledAt: null,
    };
  }
  if (action === 'return_draft' && status === RecruitmentDemandStatus.PENDING_APPROVAL) {
    return { nextStatus: RecruitmentDemandStatus.DRAFT, approvedAt: null };
  }
  const inactiveStatuses = new Set<RecruitmentDemandStatus>([
    RecruitmentDemandStatus.CLOSED,
    RecruitmentDemandStatus.CANCELLED,
  ]);
  if (action === 'cancel' && !inactiveStatuses.has(status)) {
    return { nextStatus: RecruitmentDemandStatus.CANCELLED, cancelledAt: now };
  }
  if (action === 'reopen' && status === RecruitmentDemandStatus.CANCELLED) {
    return {
      nextStatus: RecruitmentDemandStatus.DRAFT,
      approvedAt: null,
      openedAt: null,
      closedAt: null,
      cancelledAt: null,
    };
  }
  if (action === 'reopen' && status === RecruitmentDemandStatus.CLOSED) {
    return {
      nextStatus: RecruitmentDemandStatus.RECRUITING,
      openedAt: now,
      closedAt: null,
      cancelledAt: null,
    };
  }
  const closeableStatuses = new Set<RecruitmentDemandStatus>([
    RecruitmentDemandStatus.RECRUITING,
    RecruitmentDemandStatus.INTERVIEWING,
    RecruitmentDemandStatus.OFFER,
  ]);
  if (action === 'close' && closeableStatuses.has(status)) {
    if (hiredCount < headcount) {
      throw new RecruitmentInputError(`尚缺 ${headcount - hiredCount} 人，不能完成招聘需求`, 409);
    }
    return { nextStatus: RecruitmentDemandStatus.CLOSED, closedAt: now };
  }
  throw new RecruitmentInputError('当前状态不能执行此操作', 409);
}

export function demandStatusForCandidate(
  current: RecruitmentDemandStatus,
  candidateStatus: RecruitmentCandidateStatus,
): RecruitmentDemandStatus {
  const inactiveStatuses = new Set<RecruitmentDemandStatus>([
    RecruitmentDemandStatus.CLOSED,
    RecruitmentDemandStatus.CANCELLED,
  ]);
  if (inactiveStatuses.has(current)) return current;
  if (candidateStatus === RecruitmentCandidateStatus.INTERVIEW) return RecruitmentDemandStatus.INTERVIEWING;
  if (candidateStatus === RecruitmentCandidateStatus.OFFER) return RecruitmentDemandStatus.OFFER;
  return current === RecruitmentDemandStatus.DRAFT || current === RecruitmentDemandStatus.PENDING_APPROVAL
    ? current
    : RecruitmentDemandStatus.RECRUITING;
}

export function assertCandidateTransition(
  current: RecruitmentCandidateStatus,
  next: RecruitmentCandidateStatus,
): void {
  if (current === next) return;
  const allowed: Record<RecruitmentCandidateStatusDTO, RecruitmentCandidateStatusDTO[]> = {
    SCREENING: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
    INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
    OFFER: ['REJECTED', 'WITHDRAWN'],
    HIRED: [],
    REJECTED: ['SCREENING'],
    WITHDRAWN: ['SCREENING'],
  };
  if (!allowed[current].includes(next)) {
    throw new RecruitmentInputError('候选人当前状态不能执行此操作', 409);
  }
}

function serializePerson(employee: {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
} | null) {
  if (!employee) return null;
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    team: employee.team,
  };
}

function serializeInterview(interview: RecruitmentInterviewRecord): RecruitmentInterviewDTO {
  return {
    id: interview.id,
    candidateId: interview.candidateId,
    round: interview.round,
    scheduledAt: interview.scheduledAt.toISOString(),
    durationMinutes: interview.durationMinutes,
    interviewer: serializePerson(interview.interviewer),
    method: interview.method,
    location: interview.location,
    status: interview.status,
    statusText: interviewStatusText[interview.status] || interview.status,
    result: interview.result,
    resultText: interviewResultText[interview.result] || interview.result,
    feedback: interview.feedback,
    completedAt: interview.completedAt?.toISOString() || null,
    createdAt: interview.createdAt.toISOString(),
    updatedAt: interview.updatedAt.toISOString(),
  };
}

function serializeCandidate(candidate: RecruitmentCandidateRecord): RecruitmentCandidateDTO {
  return {
    id: candidate.id,
    sequence: candidate.sequence,
    code: `RC-${String(candidate.sequence).padStart(5, '0')}`,
    demandId: candidate.demandId,
    name: candidate.name,
    phone: candidate.phone,
    source: candidate.source,
    currentCompany: candidate.currentCompany,
    currentPosition: candidate.currentPosition,
    experienceYears: candidate.experienceYears,
    expectedSalary: candidate.expectedSalary,
    notes: candidate.notes,
    status: candidate.status,
    statusText: candidateStatusText[candidate.status],
    nextActionAt: candidate.nextActionAt?.toISOString() || null,
    rejectionReason: candidate.rejectionReason,
    employee: serializePerson(candidate.employee),
    hiredAt: candidate.hiredAt?.toISOString() || null,
    interviews: candidate.interviews.map(serializeInterview),
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

function serializeActivity(activity: RecruitmentActivityRecord): RecruitmentActivityDTO {
  return {
    id: activity.id,
    action: activity.action,
    actionText: activityText[activity.action] || activity.action,
    fromStatus: activity.fromStatus as RecruitmentDemandStatusDTO | null,
    toStatus: activity.toStatus as RecruitmentDemandStatusDTO | null,
    content: activity.content,
    actor: activity.actor,
    createdAt: activity.createdAt.toISOString(),
  };
}

export function serializeRecruitmentDemand(demand: RecruitmentDemandRecord): RecruitmentDemandDTO {
  const candidates = demand.candidates.map(serializeCandidate);
  const hiredCount = candidates.filter(item => item.status === 'HIRED').length;
  const activeCandidateCount = candidates.filter(item => ![
    'HIRED',
    'REJECTED',
    'WITHDRAWN',
  ].includes(item.status)).length;
  const interviewCount = candidates.reduce(
    (sum, candidate) => sum + candidate.interviews.filter(item => item.status !== 'CANCELLED').length,
    0,
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const overdue = Boolean(
    demand.targetDate
    && demand.targetDate < today
    && demand.status !== RecruitmentDemandStatus.CLOSED
    && demand.status !== RecruitmentDemandStatus.CANCELLED,
  );
  return {
    id: demand.id,
    code: demand.code,
    department: demand.department,
    position: demand.position,
    team: demand.team,
    headcount: demand.headcount,
    employmentType: demand.employmentType,
    employmentTypeText: employmentTypeText[demand.employmentType] || demand.employmentType,
    priority: demand.priority,
    priorityText: priorityText[demand.priority],
    reason: demand.reason,
    requirements: demand.requirements,
    targetDate: demand.targetDate?.toISOString().slice(0, 10) || null,
    status: demand.status,
    statusText: demandStatusText[demand.status],
    requester: serializePerson(demand.requester),
    coordinator: serializePerson(demand.coordinator),
    candidateCount: candidates.length,
    activeCandidateCount,
    interviewCount,
    hiredCount,
    remainingHeadcount: Math.max(0, demand.headcount - hiredCount),
    overdue,
    version: demand.version,
    approvedAt: demand.approvedAt?.toISOString() || null,
    openedAt: demand.openedAt?.toISOString() || null,
    closedAt: demand.closedAt?.toISOString() || null,
    cancelledAt: demand.cancelledAt?.toISOString() || null,
    candidates,
    activities: demand.activities.map(serializeActivity),
    createdAt: demand.createdAt.toISOString(),
    updatedAt: demand.updatedAt.toISOString(),
  };
}

export function summarizeRecruitmentDemands(demands: RecruitmentDemandDTO[]): RecruitmentSummaryDTO {
  return demands.reduce<RecruitmentSummaryDTO>((summary, demand) => {
    summary.demandCount += 1;
    if (!['CLOSED', 'CANCELLED'].includes(demand.status)) summary.activeDemandCount += 1;
    if (demand.status === 'PENDING_APPROVAL') summary.pendingApprovalCount += 1;
    summary.plannedHeadcount += demand.headcount;
    summary.remainingHeadcount += demand.remainingHeadcount;
    summary.candidateCount += demand.candidateCount;
    summary.interviewCount += demand.interviewCount;
    summary.hiredCount += demand.hiredCount;
    if (demand.overdue) summary.overdueCount += 1;
    return summary;
  }, {
    demandCount: 0,
    activeDemandCount: 0,
    pendingApprovalCount: 0,
    plannedHeadcount: 0,
    remainingHeadcount: 0,
    candidateCount: 0,
    interviewCount: 0,
    hiredCount: 0,
    overdueCount: 0,
  });
}

export function statusAfterInterviewResult(result: string): RecruitmentCandidateStatus {
  if (result === 'pass') return RecruitmentCandidateStatus.OFFER;
  if (result === 'reject') return RecruitmentCandidateStatus.REJECTED;
  if (result === 'no_show') return RecruitmentCandidateStatus.WITHDRAWN;
  return RecruitmentCandidateStatus.INTERVIEW;
}

export function isValidInterviewResult(value: string): boolean {
  return Object.hasOwn(interviewResultText, value);
}

export function isInterviewStatus(value: string): value is RecruitmentInterviewStatus {
  return Object.values(RecruitmentInterviewStatus).includes(value as RecruitmentInterviewStatus);
}
