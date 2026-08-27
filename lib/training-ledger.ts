import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reportDateRange } from '@/lib/report-date-range';
import { TrainingInputError } from '@/lib/training';
import { parseTrainingLocalTime, trainingDateKey } from '@/lib/training-time';
import type { TrainingWorkbookRow } from '@/lib/training-workbook';

export function trainingLedgerFilter(params: URLSearchParams) {
  const planId = (params.get('planId') || '').trim();
  const department = (params.get('department') || '').trim();
  const employee = (params.get('employee') || '').trim();
  const planKeyword = (params.get('planKeyword') || '').trim();
  let range: ReturnType<typeof reportDateRange> | null = null;
  if (!planId) {
    if (params.get('period') === 'custom') {
      for (const field of ['startDate', 'endDate']) {
        try { parseTrainingLocalTime((params.get(field) || '') + 'T00:00'); }
        catch { throw new TrainingInputError('请选择有效的开始日期和结束日期'); }
      }
    }
    range = reportDateRange({ period: params.get('period'), startDate: params.get('startDate'), endDate: params.get('endDate'), fallbackPeriod: 'month' });
  }
  const participantWhere: Prisma.TrainingParticipantWhereInput = {
    ...(department ? { departmentSnapshot: department } : {}),
    ...(employee ? { OR: [{ employeeNoSnapshot: { contains: employee, mode: 'insensitive' } }, { employeeNameSnapshot: { contains: employee, mode: 'insensitive' } }] } : {}),
  };
  const where: Prisma.TrainingPlanWhereInput = {
    deletedAt: null, status: 'COMPLETED',
    ...(planId ? { id: planId } : { startAt: { gte: range!.start, lt: range!.end } }),
    ...(planKeyword ? { OR: [{ title: { contains: planKeyword, mode: 'insensitive' } }, { code: { contains: planKeyword, mode: 'insensitive' } }] } : {}),
  };
  return { where, participantWhere, range, planId };
}

export async function readTrainingLedger(params: URLSearchParams) {
  const { where, participantWhere, range, planId } = trainingLedgerFilter(params);
  const plans = await prisma.trainingPlan.findMany({
    where,
    include: { course: { select: { name: true } }, participants: { where: participantWhere, orderBy: [{ employeeNoSnapshot: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ startAt: 'asc' }, { code: 'asc' }],
  });
  if (planId && !plans.length) throw new TrainingInputError('仅可导出已完成且未删除的培训计划', 409);
  const trainerIds = [...new Set(plans.flatMap(plan => plan.trainerId ? [plan.trainerId] : []))];
  const trainers = new Map((await prisma.employee.findMany({ where: { id: { in: trainerIds } }, select: { id: true, name: true } })).map(row => [row.id, row.name]));
  const rows: TrainingWorkbookRow[] = plans.flatMap(plan => plan.participants.map(person => ({
    planCode: plan.code, planTitle: plan.title, courseName: plan.course?.name || '临时培训',
    startAt: plan.startAt, endAt: plan.endAt, planStatus: plan.status,
    trainerName: plan.trainerId ? trainers.get(plan.trainerId) || '' : '',
    employeeNo: person.employeeNoSnapshot, employeeName: person.employeeNameSnapshot,
    department: person.departmentSnapshot, team: person.teamSnapshot, position: person.positionSnapshot,
    attendanceStatus: person.attendanceStatus, actualMinutes: person.actualMinutes,
    assessmentMode: plan.assessmentMode, theoryScore: person.theoryScore, practicalScore: person.practicalScore,
    score: person.score, result: person.result, reviewStatus: person.reviewStatus, certificationId: person.certificationId,
    note: [person.absenceNote, person.reviewComment].filter(Boolean).join('；'),
  })));
  return {
    rows, planCount: plans.filter(plan => plan.participants.length > 0).length,
    employeeCount: new Set(plans.flatMap(plan => plan.participants.map(person => person.employeeId))).size,
    startDate: range ? trainingDateKey(range.start) : trainingDateKey(plans[0].startAt),
    endDate: range ? trainingDateKey(new Date(range.end.getTime() - 1)) : trainingDateKey(plans[0].endAt),
  };
}
