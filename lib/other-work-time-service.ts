import { createHash } from 'node:crypto';
import { Prisma, OtherWorkTimeStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { employeePolicyOnDate } from '@/lib/employee-attainment-policy-service';
import { parseWorkDate, dateKeyFromDatabase } from '@/lib/attendance';
import { resolveAccessContext, type AccessGrant } from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { createSystemNotification } from '@/lib/system-notifications';
import { otherWorkScope, canReviewOtherWork, canReadOtherWork, type OtherWorkActor as Actor } from '@/lib/other-work-time-access';
export { otherWorkScope, canReviewOtherWork, canReadOtherWork } from '@/lib/other-work-time-access';

type Tx = Prisma.TransactionClient;
export class OtherWorkError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const editable = ['DRAFT', 'REJECTED', 'WITHDRAWN'];
export const otherWorkInclude = {
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
  reviews: { include: { actor: { select: { displayName: true, username: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OtherWorkTimeRequestInclude;
type RecordWithDetail = Prisma.OtherWorkTimeRequestGetPayload<{ include: typeof otherWorkInclude }>;
type RecordScope = { createdById: string; employeeId: string; teamIdSnapshot: string | null; teamSnapshot: string | null };

function scopeWhere(actor: Actor): Prisma.OtherWorkTimeRequestWhereInput {
  const scope = otherWorkScope(actor);
  if (!scope.manage) throw new OtherWorkError('当前账号没有其他工时管理权限', 403);
  if (scope.global) return {};
  return { OR: [{ teamIdSnapshot: { in: scope.teams } }, { teamSnapshot: { in: scope.teams } }] };
}
export function serializeOtherWork(row: RecordWithDetail, actor: Actor) {
  return { ...row, workDate: dateKeyFromDatabase(row.workDate),
    attachments: row.attachments.map(({ objectKey: _key, ...file }) => ({ ...file, url: '/api/other-work-times/' + row.id + '/attachments/' + file.id })),
    permissions: { edit: row.createdById === actor.id && editable.includes(row.status),
      submit: row.createdById === actor.id && editable.includes(row.status),
      withdraw: row.createdById === actor.id && row.status === 'PENDING',
      review: canReviewOtherWork(actor, row) && row.status === 'PENDING',
      void: actor.laborRole === 'ADMIN' && row.status === 'APPROVED',
      requestCorrection: (row.createdById === actor.id || row.employeeId === actor.employeeId) && row.status === 'APPROVED' && !row.correctionRequestedAt } };
}
export function otherWorkToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function requiredText(raw: unknown, label: string, max = 1000) {
  if (typeof raw !== 'string' || raw.trim().length < 2 || raw.trim().length > max) throw new OtherWorkError(label + '须填写 2 至 ' + max + ' 个字符');
  return raw.trim();
}
function optionalText(raw: unknown, max = 300) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.trim().length > max) throw new OtherWorkError('文本过长或格式错误');
  return raw.trim() || null;
}
function positiveMinutes(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 1440) throw new OtherWorkError('实际耗时必须为 1 至 1440 分钟');
  return value;
}
export function parseOtherWorkInput(data: Record<string, unknown>, actor: Actor, now = new Date(), draft = false) {
  if (typeof data.workDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.workDate)) throw new OtherWorkError('工作日期格式不正确');
  let parsed: ReturnType<typeof parseWorkDate>;
  try { parsed = parseWorkDate(data.workDate); }
  catch { throw new OtherWorkError('工作日期无效'); }
  const today = otherWorkToday(now);
  if (data.workDate > today) throw new OtherWorkError('不能申报未来日期');
  const days = Math.round((parseWorkDate(today).value.getTime() - parsed.value.getTime()) / 86400000);
  const configured = Number(process.env.OTHER_WORK_BACKFILL_DAYS || 7);
  const windowDays = Number.isInteger(configured) && configured >= 1 && configured <= 90 ? configured : 7;
  if (days >= windowDays && actor.laborRole !== 'ADMIN') throw new OtherWorkError('仅可申报当天及近 ' + windowDays + ' 个自然日；更早日期请管理员补录');
  const backfillReason = days > 0 && !draft ? requiredText(data.backfillReason, '补报原因', 500) : optionalText(data.backfillReason, 500);
  const requestedMinutes = draft && (data.requestedMinutes === 0 || data.requestedMinutes === undefined) ? 0 : positiveMinutes(data.requestedMinutes);
  const startedAt = data.startedAt ? new Date(String(data.startedAt)) : null;
  const endedAt = data.endedAt ? new Date(String(data.endedAt)) : null;
  if (Boolean(startedAt) !== Boolean(endedAt)) throw new OtherWorkError('起止时间需要同时填写');
  if (startedAt && endedAt && (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())
    || otherWorkToday(startedAt) !== data.workDate || otherWorkToday(new Date(endedAt.getTime() - 1)) !== data.workDate
    || endedAt <= startedAt || requestedMinutes * 60000 > endedAt.getTime() - startedAt.getTime())) {
    throw new OtherWorkError('时段必须在工作日内，实际耗时不能超过起止时段');
  }
  if (endedAt && endedAt > now) throw new OtherWorkError('不能申报尚未结束的工作时段');
  if (typeof data.categoryId !== 'string' || !data.categoryId) throw new OtherWorkError('请选择事项分类');
  return { workDate: parsed.value, categoryId: data.categoryId, requestedMinutes,
    description: draft ? optionalText(data.description, 1000) || '' : requiredText(data.description, '工作说明'), arranger: optionalText(data.arranger),
    sampleReference: optionalText(data.sampleReference), backfillReason, startedAt, endedAt };
}
async function lockEmployee(tx: Tx, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-work:' + employeeId}))`;
}
async function audit(tx: Tx, row: { id: string; version: number }, actor: Actor, action: string, detail: Prisma.InputJsonValue, reason?: string | null) {
  await tx.otherWorkTimeReview.create({ data: { requestId: row.id, actorId: actor.id, action, requestVersion: row.version, detail, reason } });
}
async function recordFor(tx: Tx, id: string, actor: Actor) {
  const row = await tx.otherWorkTimeRequest.findUnique({ where: { id }, include: otherWorkInclude });
  if (!row || !canReadOtherWork(actor, row)) throw new OtherWorkError('申报不存在或没有查看权限', 404);
  return row;
}
async function mutable(tx: Tx, id: string, actor: Actor, version: unknown) {
  const row = await recordFor(tx, id, actor);
  if (!Number.isInteger(version) || row.version !== version) throw new OtherWorkError('记录已变化，请刷新后重试', 409);
  return row;
}
async function bump(tx: Tx, row: RecordWithDetail, data: Prisma.OtherWorkTimeRequestUpdateManyMutationInput) {
  const updated = await tx.otherWorkTimeRequest.updateMany({ where: { id: row.id, version: row.version, status: row.status }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) throw new OtherWorkError('记录已被其他人处理，请刷新', 409);
}
async function validateOverlap(tx: Tx, row: RecordWithDetail) {
  const sameDay = await tx.otherWorkTimeRequest.findMany({ where: { employeeId: row.employeeId, workDate: row.workDate,
    id: { not: row.id }, status: { in: ['PENDING', 'APPROVED'] } } });
  if (sameDay.some(other => other.categoryId === row.categoryId && other.requestedMinutes === row.requestedMinutes
    && other.description.trim() === row.description.trim() && String(other.startedAt) === String(row.startedAt))) throw new OtherWorkError('同日已有相同申报，请先核对原记录', 409);
  const total = sameDay.reduce((sum, other) => sum + (other.approvedMinutes ?? other.requestedMinutes), 0);
  if (total + row.requestedMinutes > 1440) throw new OtherWorkError('同日有效及待审其他工时合计不能超过 24 小时', 409);
  if (row.startedAt && row.endedAt && sameDay.some(other => other.startedAt && other.endedAt && other.startedAt < row.endedAt! && other.endedAt > row.startedAt!)) {
    throw new OtherWorkError('与同日其他工时的起止时段重叠，请核对', 409);
  }
}
async function reviewerIds(tx: Tx, row: RecordScope) {
  const now = new Date();
  const candidates = await tx.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE' },
    include: { employee: { include: { departmentRef: true } }, accessGrants: { include: { department: true } } } });
  return candidates.filter(u => {
    const grants = u.accessGrants.map(g => ({ ...g, departmentCode: g.department?.code })) as AccessGrant[];
    const access = resolveAccessContext(grants.length ? [...grants, ...(u.laborRole === 'ADMIN' ? legacyFallbackGrants(u) : [])] : legacyFallbackGrants(u), { accountActive: true, now });
    return (!u.employee || u.employee.isActive) && canReviewOtherWork({ ...u, access, dailyPlanningTeamIds: [] }, row);
  }).map(u => u.id);
}
async function notify(tx: Tx, row: RecordWithDetail, actor: Actor, action: string) {
  await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: 'other_work_time', sourceId: row.id }, completedAt: null },
    data: { completedAt: new Date(), completionKind: 'SYSTEM', completionReason: '申报状态已更新' } });
  const pending = action === 'SUBMIT';
  const ids = pending ? await reviewerIds(tx, row) : [row.createdById];
  await createSystemNotification(tx, { eventType: 'other_work_' + action.toLowerCase(), dedupeKey: 'other-work:' + row.id + ':' + (row.version + 1),
    category: pending ? 'APPROVAL' : 'SYSTEM', title: pending ? row.employeeNameSnapshot + '的其他工时待审批' : '其他工时处理结果',
    body: row.categoryNameSnapshot + ' · ' + dateKeyFromDatabase(row.workDate) + ' · ' + action,
    targetRoute: (pending ? '/workspace/other-hours/approvals?id=' : '/field-report/other-hours?id=') + row.id,
    sourceType: 'other_work_time', sourceId: row.id, actorId: actor.id, recipientUserIds: ids });
}

export async function refreshOtherWorkAfterPolicyChange(tx: Tx, requestId: string, actorId: string) {
  const row = await tx.otherWorkTimeRequest.findUniqueOrThrow({ where: { id: requestId }, include: otherWorkInclude });
  if (row.status !== 'PENDING') return;
  await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: 'other_work_time', sourceId: row.id }, completedAt: null },
    data: { completedAt: new Date(), completionKind: 'SYSTEM', completionReason: '调岗后重新分配审批范围' } });
  await createSystemNotification(tx, { eventType: 'other_work_policy_change', dedupeKey: `other-work-policy:${row.id}:${row.version}`,
    category: 'APPROVAL', title: row.employeeNameSnapshot + '的其他工时待审批', body: '调岗口径已同步 · ' + dateKeyFromDatabase(row.workDate),
    targetRoute: '/workspace/other-hours/approvals?id=' + row.id, sourceType: 'other_work_time', sourceId: row.id,
    actorId, recipientUserIds: await reviewerIds(tx, row) });
}

export async function createOtherWork(actor: Actor, data: Record<string, unknown>) {
  const input = parseOtherWorkInput(data, actor, new Date(), true);
  const employeeId = typeof data.employeeId === 'string' && actor.laborRole === 'ADMIN' ? data.employeeId : actor.employeeId;
  if (data.employeeId && data.employeeId !== actor.employeeId && actor.laborRole !== 'ADMIN') throw new OtherWorkError('只能为本人申报', 403);
  if (!employeeId) throw new OtherWorkError('请先将账号绑定到员工档案', 403);
  const key = requiredText(data.idempotencyKey, '提交标识', 100);
  const correctionOfId = optionalText(data.correctionOfId, 100);
  const hash = createHash('sha256').update(JSON.stringify({ ...input, employeeId, correctionOfId })).digest('hex');
  return prisma.$transaction(async tx => {
    await lockEmployee(tx, employeeId);
    const old = await tx.otherWorkTimeRequest.findUnique({ where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey: key } }, include: otherWorkInclude });
    if (old) {
      if (old.requestHash !== hash) throw new OtherWorkError('提交标识已用于不同内容，请刷新后重新填写', 409);
      return serializeOtherWork(old, actor);
    }
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee || (!employee.isActive && actor.laborRole !== 'ADMIN')) throw new OtherWorkError('员工档案不存在或已停用', 403);
    if ((employee.hireDate && input.workDate < employee.hireDate) || (employee.resignedAt && input.workDate > employee.resignedAt)) throw new OtherWorkError('工作日期不在员工任职期间');
    if (employeeId !== actor.employeeId) requiredText(data.backfillReason, '管理员补录原因', 500);
    const category = await tx.otherWorkTimeCategory.findUnique({ where: { id: input.categoryId } });
    if (!category?.isActive) throw new OtherWorkError('该分类已停用，请重新选择');
    if (correctionOfId) {
      const original = await recordFor(tx, correctionOfId, actor);
      if (original.employeeId !== employeeId || !['VOIDED', 'REJECTED', 'WITHDRAWN'].includes(original.status)) throw new OtherWorkError('只有作废、退回或撤回的本人记录可复制更正', 409);
      if (await tx.otherWorkTimeRequest.count({ where: { correctionOfId, status: { in: ['DRAFT', 'PENDING', 'APPROVED'] } } })) throw new OtherWorkError('原记录已有更正申请，请处理现有申请', 409);
    }
    const attendance = await tx.attendanceRecord.findFirst({ where: { employeeId, workDate: input.workDate } });
    const datedPolicy = await employeePolicyOnDate(tx, employee, input.workDate);
    const useDatedPolicy = !attendance?.attainmentPolicyOverride && (Boolean(datedPolicy.effectiveDate) || !attendance);
    const membership = await tx.productionPlanningMembership.findFirst({ where: { employeeId, isActive: true,
      effectiveFrom: { lte: input.workDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.workDate } }], teamId: { not: null } }, include: { team: true }, orderBy: { effectiveFrom: 'desc' } });
    const historicalTeam = useDatedPolicy ? datedPolicy.policy.team : attendance?.teamSnapshot;
    const teamName = historicalTeam || membership?.team?.name || employee.team;
    const team = historicalTeam
      ? await tx.productionTeam.findFirst({ where: { OR: [{ name: historicalTeam }, { legacyTeamName: historicalTeam }, { code: historicalTeam }] } })
      : membership?.team || (teamName ? await tx.productionTeam.findFirst({ where: { OR: [{ name: teamName }, { legacyTeamName: teamName }, { code: teamName }] } }) : null);
    const row = await tx.otherWorkTimeRequest.create({ data: { ...input, employeeId, createdById: actor.id,
      employeeNameSnapshot: employee.name, employeeNoSnapshot: employee.employeeNo, teamSnapshot: historicalTeam || team?.name || teamName,
      teamIdSnapshot: team?.id, attainmentEligibleSnapshot: useDatedPolicy ? datedPolicy.policy.attainmentEligible : attendance?.attainmentEligibleSnapshot ?? datedPolicy.policy.attainmentEligible,
      attainmentStreamSnapshot: useDatedPolicy ? datedPolicy.policy.attainmentStream : attendance?.attainmentStreamSnapshot ?? datedPolicy.policy.attainmentStream,
      categoryNameSnapshot: category.name, correctionOfId, idempotencyKey: key, requestHash: hash }, include: otherWorkInclude });
    await audit(tx, row, actor, 'CREATE', { ...input, workDate: input.workDate.toISOString(), startedAt: input.startedAt?.toISOString() ?? null, endedAt: input.endedAt?.toISOString() ?? null }, input.backfillReason);
    return serializeOtherWork(row, actor);
  });
}

export async function commandOtherWork(actor: Actor, id: string, data: Record<string, unknown>) {
  return prisma.$transaction(async tx => {
    const initial = await recordFor(tx, id, actor);
    await lockEmployee(tx, initial.employeeId);
    const row = await mutable(tx, id, actor, data.version);
    const action = String(data.action || '');
    let update: Prisma.OtherWorkTimeRequestUpdateManyMutationInput = {};
    const reason = optionalText(data.reason, 1000);
    if (['EDIT', 'SUBMIT', 'WITHDRAW', 'CORRECTION_REQUEST'].includes(action) && row.createdById !== actor.id && !(action === 'CORRECTION_REQUEST' && actor.employeeId === row.employeeId)) throw new OtherWorkError('只能操作本人申报', 403);
    if (action === 'EDIT') {
      if (!editable.includes(row.status)) throw new OtherWorkError('提交后内容已锁定，请先撤回', 409);
      const input = parseOtherWorkInput({ ...data, arranger: data.arranger === undefined ? row.arranger : data.arranger,
        sampleReference: data.sampleReference === undefined ? row.sampleReference : data.sampleReference }, actor, new Date(), true);
      if (dateKeyFromDatabase(input.workDate) !== dateKeyFromDatabase(row.workDate)) throw new OtherWorkError('修改工作日期请新建申报，以保留原日人员快照');
      const category = await tx.otherWorkTimeCategory.findUnique({ where: { id: input.categoryId } });
      if (!category?.isActive) throw new OtherWorkError('分类已停用');
      update = { ...input, categoryNameSnapshot: category.name, status: 'DRAFT' };
    } else if (action === 'SUBMIT') {
      if (!editable.includes(row.status)) throw new OtherWorkError('当前状态不能提交', 409);
      parseOtherWorkInput({ ...row, workDate: dateKeyFromDatabase(row.workDate) }, actor);
      if (row.employeeId !== actor.employeeId) requiredText(row.backfillReason, '管理员补录原因', 500);
      const category = await tx.otherWorkTimeCategory.findUnique({ where: { id: row.categoryId } });
      if (!category?.isActive) throw new OtherWorkError('分类已停用，请修改后重提');
      await validateOverlap(tx, row);
      update = { status: 'PENDING', submittedAt: new Date(), reviewedAt: null, approvedMinutes: null, reviewedByName: null };
    } else if (action === 'WITHDRAW') {
      if (row.status !== 'PENDING') throw new OtherWorkError('只能撤回待审批申请', 409);
      update = { status: 'WITHDRAWN' };
    } else if (action === 'APPROVE' || action === 'REJECT') {
      if (!canReviewOtherWork(actor, row)) throw new OtherWorkError('不能自审或审批授权范围外的申请', 403);
      if (row.status !== 'PENDING') throw new OtherWorkError('申请已处理，请刷新', 409);
      const minutes = action === 'APPROVE' ? positiveMinutes(data.approvedMinutes ?? row.requestedMinutes) : null;
      if (minutes && minutes > row.requestedMinutes) throw new OtherWorkError('批准时长不能超过申报时长');
      if (action === 'REJECT' || (minutes && minutes < row.requestedMinutes)) requiredText(reason, '退回或核减原因', 1000);
      update = { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', approvedMinutes: minutes, reviewedAt: new Date(), reviewedByName: actor.displayName || actor.username };
    } else if (action === 'VOID') {
      if (actor.laborRole !== 'ADMIN') throw new OtherWorkError('仅管理员可作废已通过记录', 403);
      if (row.status !== 'APPROVED') throw new OtherWorkError('仅已通过记录可作废', 409);
      requiredText(reason, '作废原因', 1000);
      update = { status: 'VOIDED', voidedAt: new Date() };
    } else if (action === 'CORRECTION_REQUEST') {
      if (row.status !== 'APPROVED' || row.correctionRequestedAt) throw new OtherWorkError('当前记录不能重复申请更正', 409);
      requiredText(reason, '更正原因', 1000);
      update = { correctionRequestedAt: new Date(), correctionReason: reason };
    } else throw new OtherWorkError('不支持的操作');
    await bump(tx, row, update);
    await audit(tx, row, actor, action, { before: { status: row.status, requestedMinutes: row.requestedMinutes, approvedMinutes: row.approvedMinutes, description: row.description },
      after: JSON.parse(JSON.stringify(update)), scope: otherWorkScope(actor), attachments: row.attachments.map(a => a.id) }, reason);
    if (action === 'CORRECTION_REQUEST') {
      const admins = await tx.user.findMany({ where: { laborRole: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', id: { not: actor.id } }, select: { id: true } });
      await createSystemNotification(tx, { eventType: 'other_work_correction', dedupeKey: 'other-correction:' + id + ':' + row.version, category: 'APPROVAL', title: row.employeeNameSnapshot + '申请更正其他工时', body: reason,
        sourceType: 'other_work_time', sourceId: id, actorId: actor.id, targetRoute: '/workspace/other-hours/approvals?id=' + id, recipientUserIds: admins.map(a => a.id) });
    } else if (action !== 'EDIT') await notify(tx, row, actor, action);
    return serializeOtherWork(await tx.otherWorkTimeRequest.findUniqueOrThrow({ where: { id }, include: otherWorkInclude }), actor);
  });
}

export function otherWorkListWhere(actor: Actor, query: URLSearchParams) {
  const manage = query.get('scope') === 'manage';
  const where: Prisma.OtherWorkTimeRequestWhereInput = manage ? scopeWhere(actor) : { OR: [{ createdById: actor.id }, ...(actor.employeeId ? [{ employeeId: actor.employeeId }] : [])] };
  const state = query.get('status');
  if (state === 'PROCESSED') where.status = { in: ['APPROVED', 'REJECTED', 'VOIDED'] };
  if (state && Object.values(OtherWorkTimeStatus).includes(state as OtherWorkTimeStatus)) where.status = state as OtherWorkTimeStatus;
  const conditions: Prisma.OtherWorkTimeRequestWhereInput[] = [];
  if (query.get('corrections') === '1') { conditions.push({ status: 'APPROVED' }); where.correctionRequestedAt = { not: null }; }
  if (query.get('employeeId')) where.employeeId = query.get('employeeId')!;
  if (query.get('from') || query.get('to')) where.workDate = { ...(query.get('from') ? { gte: parseWorkDate(query.get('from')).value } : {}), ...(query.get('to') ? { lte: parseWorkDate(query.get('to')).value } : {}) };
  const search = query.get('search')?.trim().slice(0, 100);
  if (search) conditions.push({ OR: ['employeeNameSnapshot', 'employeeNoSnapshot', 'description', 'categoryNameSnapshot'].map(key => ({ [key]: { contains: search, mode: 'insensitive' } })) });
  if (conditions.length) where.AND = conditions;
  if (query.get('categoryId')) where.categoryId = query.get('categoryId')!;
  return where;
}
export async function listOtherWork(actor: Actor, query: URLSearchParams) {
  const where = otherWorkListWhere(actor, query);
  const page = Math.max(1, Math.min(100000, Number(query.get('page')) || 1));
  const size = 30;
  // State chips select rows; totals share the same employee, date, search and category scope.
  const scopeQuery = new URLSearchParams(query); scopeQuery.delete('status');
  const summaryWhere = otherWorkListWhere(actor, scopeQuery);
  const [rows, total, statusTotals, categories, employees, byCategory] = await Promise.all([
    prisma.otherWorkTimeRequest.findMany({ where, include: otherWorkInclude, orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * size, take: size }),
    prisma.otherWorkTimeRequest.count({ where }),
    prisma.otherWorkTimeRequest.groupBy({ by: ['status'], where: summaryWhere, _sum: { approvedMinutes: true }, _count: true }),
    prisma.otherWorkTimeCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    actor.laborRole === 'ADMIN' ? prisma.employee.findMany({ select: { id: true, employeeNo: true, name: true }, orderBy: { employeeNo: 'asc' } }) : Promise.resolve([]),
    prisma.otherWorkTimeRequest.groupBy({ by: ['categoryNameSnapshot'], where: { AND: [summaryWhere, { status: 'APPROVED' }] }, _sum: { approvedMinutes: true }, _count: true }),
  ]);
  const statusCounts = Object.fromEntries(statusTotals.map(row => [row.status, row._count]));
  return { rows: rows.map(row => serializeOtherWork(row, actor)), pagination: { page, size, total }, statusCounts,
    summary: { approvedMinutes: statusTotals.find(row => row.status === 'APPROVED')?._sum.approvedMinutes || 0, pending: statusCounts.PENDING || 0 },
    categories, employees, byCategory, permissions: { ...otherWorkScope(actor), admin: actor.laborRole === 'ADMIN' }, today: otherWorkToday() };
}
export async function detailOtherWork(actor: Actor, id: string) {
  const row = await recordFor(prisma, id, actor);
  const [attendance, other, loss, executions, completions, reviewers] = await Promise.all([
    prisma.attendanceRecord.findFirst({ where: { employeeId: row.employeeId, workDate: row.workDate } }),
    prisma.otherWorkTimeRequest.findMany({ where: { employeeId: row.employeeId, workDate: row.workDate, status: { in: ['PENDING', 'APPROVED'] }, id: { not: id } }, select: { id: true, status: true, categoryNameSnapshot: true, requestedMinutes: true, approvedMinutes: true, startedAt: true, endedAt: true } }),
    prisma.abnormalTimeAllocation.findMany({ where: { employeeId: row.employeeId, workDate: row.workDate, event: { deletedAt: null, employeeExempt: true, qualityStatus: 'confirmed' } }, select: { durationMilliseconds: true, event: { select: { approvedDurationMilliseconds: true } } } }),
    prisma.processExecution.findMany({ where: { employeeId: row.employeeId, voidedAt: null, endedAt: { gte: new Date(row.workDate.getTime() - 8 * 3600000), lt: new Date(row.workDate.getTime() + 16 * 3600000) } }, select: { startedAt: true, endedAt: true, actualLaborMilliseconds: true } }),
    prisma.processCompletion.findMany({ where: { workDate: row.workDate, voidedAt: null, workStartedAt: { not: null }, workEndedAt: { not: null }, OR: [{ principalEmployeeId: row.employeeId }, { participants: { some: { employeeId: row.employeeId } } }] }, select: { id: true, workStartedAt: true, workEndedAt: true } }),
    row.status === 'PENDING' ? reviewerIds(prisma, row) : Promise.resolve([]),
  ]);
  return { row: serializeOtherWork(row, actor), context: { attendanceStatus: attendance?.status || 'missing', attendanceMilliseconds: attendance?.actualMilliseconds || 0,
    confirmedLossMilliseconds: loss.reduce((sum, a) => sum + (a.event.approvedDurationMilliseconds ?? a.durationMilliseconds), 0), other, executions, completions,
    reviewerAvailable: row.status !== 'PENDING' || reviewers.length > 0,
    reviewHint: '仅填时长时无法自动核实时间重叠，请结合安排和订单损耗核对；标准产出工时不等于实际耗时。' } };
}

export async function mutateOtherWorkAttachment(actor: Actor, id: string, version: number,
  file: { objectKey: string; originalName: string; mimeType: string; size: number } | { deleteId: string }) {
  return prisma.$transaction(async tx => {
    const row = await mutable(tx, id, actor, version);
    if (row.createdById !== actor.id || !editable.includes(row.status)) throw new OtherWorkError('只能修改本人未提交申请的照片', 403);
    if ('deleteId' in file) {
      if (!row.attachments.some(a => a.id === file.deleteId)) throw new OtherWorkError('附件不存在', 404);
      await bump(tx, row, {});
      await tx.otherWorkTimeAttachment.update({ where: { id: file.deleteId }, data: { deletedAt: new Date() } });
    } else {
      if (row.attachments.length >= 6) throw new OtherWorkError('最多上传 6 张照片');
      await bump(tx, row, {});
      await tx.otherWorkTimeAttachment.create({ data: { ...file, requestId: id, requestVersion: row.version, uploadedById: actor.id } });
    }
    await audit(tx, row, actor, 'deleteId' in file ? 'DELETE_PHOTO' : 'UPLOAD_PHOTO', 'deleteId' in file ? file : { name: file.originalName });
    return serializeOtherWork(await tx.otherWorkTimeRequest.findUniqueOrThrow({ where: { id }, include: otherWorkInclude }), actor);
  });
}
