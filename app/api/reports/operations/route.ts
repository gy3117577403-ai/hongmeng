import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  attainmentCapacityMilliseconds,
  basisPoints,
  dateKeyFromDatabase,
  parseWorkDate,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { safeLaborMilliseconds } from '@/lib/process-labor-service';
import { employeeReportRange, serializeEmployee } from '@/lib/process-time';
import { ReportDateRangeError, reportDateRange, reportRangeDateKeys } from '@/lib/report-date-range';
import { attendanceRecordScopeWhere, productionEmployeeWhere } from '@/lib/production-workforce';
import {
  cappedBasisPoints,
  parseReportMonth,
  reportRangeWeekBuckets,
  reportWeekKey,
} from '@/lib/report-operations';
import type {
  AttainmentStream,
  AttendanceType,
  ReportOperationsDTO,
  ReportOperationsEmployeeDayDTO,
  ReportOperationsEmployeeRowDTO,
  ReportOperationsLaborRowDTO,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MutableDay = {
  status: 'missing' | 'draft' | 'confirmed' | 'rest';
  attendanceType: AttendanceType | null;
  plannedMilliseconds: number;
  attendanceMilliseconds: number;
  leaveMilliseconds: number;
  standardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
};

function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function shanghaiDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function dayLabel(dateKey: string): { weekday: string; isWeekend: boolean } {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  const day = date.getUTCDay();
  return {
    weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day],
    isWeekend: day === 0 || day === 6,
  };
}

function emptyDay(
  attainmentEligible = true,
  attainmentFactorBasisPoints = attainmentEligible ? 10_000 : 0,
  attainmentStream: AttainmentStream = attainmentEligible ? 'batch' : 'excluded',
): MutableDay {
  return {
    status: 'missing',
    attendanceType: null,
    plannedMilliseconds: 0,
    attendanceMilliseconds: 0,
    leaveMilliseconds: 0,
    standardLaborMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    attainmentEligible,
    attainmentFactorBasisPoints,
    attainmentStream,
  };
}

function teamLabel(employee: { team?: string | null; position?: string | null }): string {
  return String(employee.team || employee.position || '未分组').trim() || '未分组';
}

function normalizedAttainmentStream(value: unknown, eligible = true): AttainmentStream {
  if (value === 'sample' || value === 'excluded') return value;
  return eligible ? 'batch' : 'excluded';
}

function officialDay(day: MutableDay, date: string): ReportOperationsEmployeeDayDTO {
  const attendanceOfficial = day.status === 'confirmed' || day.status === 'rest';
  const hasCapacity = day.attainmentEligible
    && day.attainmentStream === 'batch'
    && day.attainmentFactorBasisPoints > 0
    && attendanceOfficial
    && day.attendanceMilliseconds > 0;
  const effectiveAttendance = hasCapacity
    ? Math.max(0, day.attendanceMilliseconds - day.exemptAbnormalMilliseconds)
    : 0;
  const capacity = Math.round(
    attainmentCapacityMilliseconds(effectiveAttendance) * day.attainmentFactorBasisPoints / 10_000,
  );
  const standardLabor = hasCapacity ? day.standardLaborMilliseconds : 0;
  const unmatchedStandardLabor = hasCapacity ? 0 : day.standardLaborMilliseconds;
  return {
    date,
    status: day.status,
    attendanceType: day.attendanceType,
    plannedMilliseconds: attendanceOfficial && day.status !== 'rest' ? day.plannedMilliseconds : 0,
    attendanceMilliseconds: attendanceOfficial ? day.attendanceMilliseconds : 0,
    leaveMilliseconds: attendanceOfficial ? day.leaveMilliseconds : 0,
    standardLaborMilliseconds: standardLabor,
    unmatchedStandardLaborMilliseconds: unmatchedStandardLabor,
    exemptAbnormalMilliseconds: attendanceOfficial ? day.exemptAbnormalMilliseconds : 0,
    attainmentCapacityMilliseconds: capacity,
    attainmentBasisPoints: basisPoints(standardLabor, capacity),
    attainmentEligible: day.attainmentEligible,
    attainmentFactorBasisPoints: day.attainmentFactorBasisPoints,
    attainmentStream: day.attainmentStream,
  };
}

function emptyLaborRow(team: string): ReportOperationsLaborRowDTO {
  return {
    team,
    employeeCount: 0,
    attendancePeople: 0,
    confirmedRecords: 0,
    plannedMilliseconds: 0,
    attendanceMilliseconds: 0,
    leaveMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0,
    attainmentCapacityMilliseconds: 0,
    attendanceBasisPoints: null,
    attainmentBasisPoints: null,
  };
}

function finalizeLaborRow(row: ReportOperationsLaborRowDTO): ReportOperationsLaborRowDTO {
  return {
    ...row,
    attendanceBasisPoints: basisPoints(row.attendanceMilliseconds, row.plannedMilliseconds),
    attainmentBasisPoints: basisPoints(row.standardLaborMilliseconds, row.attainmentCapacityMilliseconds),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const now = new Date();
    const month = parseReportMonth(req.nextUrl.searchParams.get('month'), todayKey(now));
    const hasPeriodQuery = Boolean(req.nextUrl.searchParams.get('period'));
    const range = hasPeriodQuery
      ? reportDateRange({
          period: req.nextUrl.searchParams.get('period'),
          date: req.nextUrl.searchParams.get('date'),
          startDate: req.nextUrl.searchParams.get('startDate'),
          endDate: req.nextUrl.searchParams.get('endDate'),
        })
      : { period: 'month' as const, ...employeeReportRange('month', `${month}-15`) };
    const { period, date, start, end } = range;
    const startDate = parseWorkDate(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const endDate = parseWorkDate(end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const cutoffAt = new Date(Math.min(now.getTime(), end.getTime() - 1));
    const dateKeys = reportRangeDateKeys(start, end);

    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          productionEmployeeWhere({ requireActive: false, requireAttendance: false }),
          {
            attendanceRecords: {
              some: {
                workDate: { gte: startDate, lt: endDate },
                ...attendanceRecordScopeWhere('PRODUCTION'),
              },
            },
          },
        ],
      },
      orderBy: [{ team: 'asc' }, { employeeNo: 'asc' }],
    });
    const employeeIds = employees.map(employee => employee.id);

    const [attendanceRecords, laborClaims, executions, abnormalAllocations, batches] = await Promise.all([
      employeeIds.length ? prisma.attendanceRecord.findMany({
        where: {
          employeeId: { in: employeeIds },
          workDate: { gte: startDate, lt: endDate },
          ...attendanceRecordScopeWhere('PRODUCTION'),
        },
        select: {
          employeeId: true,
          workDate: true,
          status: true,
          attendanceType: true,
          attainmentEligibleSnapshot: true,
          attainmentFactorBasisPointsSnapshot: true,
          attainmentStreamSnapshot: true,
          plannedMilliseconds: true,
          leaveMilliseconds: true,
          actualMilliseconds: true,
        },
      }) : Promise.resolve([]),
      employeeIds.length ? prisma.processLaborClaim.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'ACTIVE',
          standardLaborMilliseconds: { gt: 0 },
          workDate: { gte: startDate, lt: endDate },
        },
        select: {
          employeeId: true,
          workDate: true,
          standardLaborMilliseconds: true,
          pool: { select: { countsForEfficiency: true } },
        },
      }) : Promise.resolve([]),
      employeeIds.length ? prisma.processExecution.findMany({
        where: {
          employeeId: { in: employeeIds },
          voidedAt: null,
          endedAt: { gte: start, lt: end },
          countsForEfficiency: true,
        },
        select: {
          employeeId: true,
          endedAt: true,
          standardLaborMilliseconds: true,
        },
      }) : Promise.resolve([]),
      employeeIds.length ? prisma.abnormalTimeAllocation.findMany({
        where: {
          employeeId: { in: employeeIds },
          workDate: { gte: startDate, lt: endDate },
          event: { deletedAt: null, employeeExempt: true, qualityStatus: 'confirmed' },
        },
        select: {
          employeeId: true,
          workDate: true,
          durationMilliseconds: true,
          event: { select: { approvedDurationMilliseconds: true } },
        },
      }) : Promise.resolve([]),
      prisma.productionPlanBatch.findMany({
        where: {
          deletedAt: null,
          releaseState: { not: 'cancelled' },
          plannedCompletionDate: { gte: start, lt: end },
        },
        select: {
          id: true,
          quantity: true,
          plannedCompletionDate: true,
          workOrderId: true,
          workOrder: {
            select: {
              processRoute: {
                select: {
                  steps: {
                    where: { retiredAt: null },
                    orderBy: { position: 'desc' },
                    take: 1,
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
        take: 5000,
      }),
    ]);

    const finalStepIds = batches.flatMap(batch => batch.workOrder?.processRoute?.steps.map(step => step.id) || []);
    const finalCompletions = finalStepIds.length ? await prisma.processCompletion.findMany({
      where: {
        voidedAt: null,
        stepId: { in: finalStepIds },
        completedAt: { lt: cutoffAt },
      },
      select: { workOrderId: true, goodQty: true },
      take: 50_000,
    }) : [];

    const employeeDayMap = new Map<string, Map<string, MutableDay>>();
    const employeeConfiguration = new Map(employees.map(employee => [employee.id, {
      eligible: employee.attainmentEligible,
      factor: employee.attainmentFactorBasisPoints,
      stream: normalizedAttainmentStream(employee.attainmentStream, employee.attainmentEligible),
    }]));
    const mutableDay = (employeeId: string, date: string) => {
      let days = employeeDayMap.get(employeeId);
      if (!days) {
        days = new Map();
        employeeDayMap.set(employeeId, days);
      }
      let day = days.get(date);
      if (!day) {
        const configuration = employeeConfiguration.get(employeeId);
        day = emptyDay(
          configuration?.eligible ?? true,
          configuration?.factor ?? (configuration?.eligible === false ? 0 : 10_000),
          configuration?.stream ?? (configuration?.eligible === false ? 'excluded' : 'batch'),
        );
        days.set(date, day);
      }
      return day;
    };

    for (const record of attendanceRecords) {
      const date = dateKeyFromDatabase(record.workDate);
      const day = mutableDay(record.employeeId, date);
      day.status = record.status === 'confirmed'
        ? record.attendanceType === 'rest' ? 'rest' : 'confirmed'
        : 'draft';
      day.attendanceType = ['partial_leave', 'leave', 'absent', 'rest'].includes(record.attendanceType)
        ? record.attendanceType as AttendanceType
        : 'normal';
      day.plannedMilliseconds = Math.max(0, record.plannedMilliseconds);
      day.leaveMilliseconds = Math.max(0, record.leaveMilliseconds);
      day.attendanceMilliseconds = Math.max(0, record.actualMilliseconds);
      day.attainmentEligible = record.attainmentEligibleSnapshot
        ?? employeeConfiguration.get(record.employeeId)?.eligible
        ?? true;
      day.attainmentFactorBasisPoints = record.attainmentFactorBasisPointsSnapshot
        ?? employeeConfiguration.get(record.employeeId)?.factor
        ?? (day.attainmentEligible ? 10_000 : 0);
      const stream = record.attainmentStreamSnapshot
        ?? employeeConfiguration.get(record.employeeId)?.stream
        ?? (day.attainmentEligible ? 'batch' : 'excluded');
      day.attainmentStream = normalizedAttainmentStream(stream, day.attainmentEligible);
    }
    for (const claim of laborClaims) {
      if (!claim.pool.countsForEfficiency) continue;
      mutableDay(claim.employeeId, dateKeyFromDatabase(claim.workDate)).standardLaborMilliseconds
        += safeLaborMilliseconds(claim.standardLaborMilliseconds);
    }
    for (const execution of executions) {
      mutableDay(execution.employeeId, shanghaiDateKey(execution.endedAt)).standardLaborMilliseconds
        += Math.max(0, execution.standardLaborMilliseconds);
    }
    for (const allocation of abnormalAllocations) {
      mutableDay(allocation.employeeId, dateKeyFromDatabase(allocation.workDate)).exemptAbnormalMilliseconds
        += Math.max(0, allocation.event.approvedDurationMilliseconds ?? allocation.durationMilliseconds);
    }

    const employeeMatrix: ReportOperationsEmployeeRowDTO[] = employees.map(employee => {
      const sourceDays = employeeDayMap.get(employee.id) || new Map<string, MutableDay>();
      const days = dateKeys.map(date => officialDay(
        sourceDays.get(date) || emptyDay(
          employee.attainmentEligible,
          employee.attainmentFactorBasisPoints,
          normalizedAttainmentStream(employee.attainmentStream, employee.attainmentEligible),
        ),
        date,
      ));
      const totals = days.reduce((sum, day) => ({
        plannedMilliseconds: sum.plannedMilliseconds + day.plannedMilliseconds,
        attendanceMilliseconds: sum.attendanceMilliseconds + day.attendanceMilliseconds,
        leaveMilliseconds: sum.leaveMilliseconds + day.leaveMilliseconds,
        standardLaborMilliseconds: sum.standardLaborMilliseconds + day.standardLaborMilliseconds,
        unmatchedStandardLaborMilliseconds: sum.unmatchedStandardLaborMilliseconds + day.unmatchedStandardLaborMilliseconds,
        exemptAbnormalMilliseconds: sum.exemptAbnormalMilliseconds + day.exemptAbnormalMilliseconds,
        attainmentCapacityMilliseconds: sum.attainmentCapacityMilliseconds + day.attainmentCapacityMilliseconds,
        confirmedDays: sum.confirmedDays + (day.status === 'confirmed' || day.status === 'rest' ? 1 : 0),
        draftDays: sum.draftDays + (day.status === 'draft' ? 1 : 0),
      }), {
        plannedMilliseconds: 0,
        attendanceMilliseconds: 0,
        leaveMilliseconds: 0,
        standardLaborMilliseconds: 0,
        unmatchedStandardLaborMilliseconds: 0,
        exemptAbnormalMilliseconds: 0,
        attainmentCapacityMilliseconds: 0,
        confirmedDays: 0,
        draftDays: 0,
      });
      return {
        employee: serializeEmployee(employee),
        team: teamLabel(employee),
        position: String(employee.position || '岗位未设置'),
        ...totals,
        attendanceBasisPoints: basisPoints(totals.attendanceMilliseconds, totals.plannedMilliseconds),
        attainmentBasisPoints: basisPoints(totals.standardLaborMilliseconds, totals.attainmentCapacityMilliseconds),
        attainmentEligible: days.some(day => day.attainmentEligible && day.attainmentStream === 'batch' && day.attainmentFactorBasisPoints > 0),
        attainmentFactorBasisPoints: employee.attainmentFactorBasisPoints,
        attainmentStream: normalizedAttainmentStream(employee.attainmentStream, employee.attainmentEligible),
        days,
      };
    }).filter(row => row.employee.isActive
      || row.confirmedDays > 0
      || row.draftDays > 0
      || row.standardLaborMilliseconds > 0
      || row.unmatchedStandardLaborMilliseconds > 0);

    const teamMonthlyMap = new Map<string, ReportOperationsLaborRowDTO>();
    for (const row of employeeMatrix) {
      const team = teamMonthlyMap.get(row.team) || emptyLaborRow(row.team);
      team.employeeCount += 1;
      team.attendancePeople += row.attendanceMilliseconds > 0 ? 1 : 0;
      team.confirmedRecords += row.confirmedDays;
      team.plannedMilliseconds += row.plannedMilliseconds;
      team.attendanceMilliseconds += row.attendanceMilliseconds;
      team.leaveMilliseconds += row.leaveMilliseconds;
      team.exemptAbnormalMilliseconds += row.exemptAbnormalMilliseconds;
      team.standardLaborMilliseconds += row.standardLaborMilliseconds;
      team.unmatchedStandardLaborMilliseconds += row.unmatchedStandardLaborMilliseconds;
      team.attainmentCapacityMilliseconds += row.attainmentCapacityMilliseconds;
      teamMonthlyMap.set(row.team, team);
    }
    const teamMonthly = [...teamMonthlyMap.values()].map(finalizeLaborRow).sort((left, right) =>
      (right.attainmentBasisPoints ?? -1) - (left.attainmentBasisPoints ?? -1)
      || left.team.localeCompare(right.team, 'zh-CN'));

    const teamDailyMap = new Map<string, ReportOperationsLaborRowDTO & { date: string }>();
    for (const employee of employeeMatrix) {
      for (const day of employee.days) {
        const key = `${day.date}\u0000${employee.team}`;
        const row = teamDailyMap.get(key) || { ...emptyLaborRow(employee.team), date: day.date };
        row.employeeCount += 1;
        row.attendancePeople += day.attendanceMilliseconds > 0 ? 1 : 0;
        row.confirmedRecords += day.status === 'confirmed' || day.status === 'rest' ? 1 : 0;
        row.plannedMilliseconds += day.plannedMilliseconds;
        row.attendanceMilliseconds += day.attendanceMilliseconds;
        row.leaveMilliseconds += day.leaveMilliseconds;
        row.exemptAbnormalMilliseconds += day.exemptAbnormalMilliseconds;
        row.standardLaborMilliseconds += day.standardLaborMilliseconds;
        row.unmatchedStandardLaborMilliseconds += day.unmatchedStandardLaborMilliseconds;
        row.attainmentCapacityMilliseconds += day.attainmentCapacityMilliseconds;
        teamDailyMap.set(key, row);
      }
    }
    const teamDaily = [...teamDailyMap.values()].map(row => ({ ...finalizeLaborRow(row), date: row.date }));

    const attendanceByDate = new Map(dateKeys.map(date => [date, {
      date,
      plannedPeople: 0,
      attendancePeople: 0,
      leavePeople: 0,
      absentPeople: 0,
      restPeople: 0,
      confirmedRecords: 0,
      draftRecords: 0,
      plannedMilliseconds: 0,
      attendanceMilliseconds: 0,
      attendanceBasisPoints: null as number | null,
      hoursBasisPoints: null as number | null,
    }]));
    for (const record of attendanceRecords) {
      const day = attendanceByDate.get(dateKeyFromDatabase(record.workDate));
      if (!day) continue;
      if (record.status !== 'confirmed') {
        day.draftRecords += 1;
        continue;
      }
      day.confirmedRecords += 1;
      if (record.attendanceType === 'rest') {
        day.restPeople += 1;
        continue;
      }
      if (record.plannedMilliseconds > 0) day.plannedPeople += 1;
      if (record.actualMilliseconds > 0) day.attendancePeople += 1;
      if (record.attendanceType === 'leave' || record.leaveMilliseconds > 0) day.leavePeople += 1;
      if (record.attendanceType === 'absent') day.absentPeople += 1;
      day.plannedMilliseconds += Math.max(0, record.plannedMilliseconds);
      day.attendanceMilliseconds += Math.max(0, record.actualMilliseconds);
    }
    const dailyAttendance = [...attendanceByDate.values()].map(day => ({
      ...day,
      attendanceBasisPoints: basisPoints(day.attendancePeople, day.plannedPeople),
      hoursBasisPoints: basisPoints(day.attendanceMilliseconds, day.plannedMilliseconds),
    }));

    const completedByWorkOrder = new Map<string, number>();
    for (const completion of finalCompletions) {
      completedByWorkOrder.set(
        completion.workOrderId,
        (completedByWorkOrder.get(completion.workOrderId) || 0) + Math.max(0, completion.goodQty),
      );
    }
    const weeklyPlan = reportRangeWeekBuckets(dateKeys).map(bucket => ({
      ...bucket,
      plannedBatches: 0,
      completedBatches: 0,
      plannedQuantity: 0,
      completedQuantity: 0,
      batchCompletionBasisPoints: null as number | null,
      quantityCompletionBasisPoints: null as number | null,
    }));
    const weekMap = new Map(weeklyPlan.map(week => [week.key, week]));
    for (const batch of batches) {
      const week = weekMap.get(reportWeekKey(shanghaiDateKey(batch.plannedCompletionDate)));
      if (!week) continue;
      const plannedQuantity = Math.max(0, batch.quantity);
      const completedQuantity = batch.workOrderId
        ? Math.min(plannedQuantity, completedByWorkOrder.get(batch.workOrderId) || 0)
        : 0;
      week.plannedBatches += 1;
      week.plannedQuantity += plannedQuantity;
      week.completedQuantity += completedQuantity;
      if (plannedQuantity > 0 && completedQuantity >= plannedQuantity) week.completedBatches += 1;
    }
    for (const week of weeklyPlan) {
      week.batchCompletionBasisPoints = cappedBasisPoints(week.completedBatches, week.plannedBatches);
      week.quantityCompletionBasisPoints = cappedBasisPoints(week.completedQuantity, week.plannedQuantity);
    }

    const dailyAttainmentAverage = dateKeys.map(date => {
      const rows = employeeMatrix.map(row => row.days.find(day => day.date === date)).filter(Boolean);
      const standard = rows.reduce((sum, day) => sum + (day?.standardLaborMilliseconds || 0), 0);
      const capacity = rows.reduce((sum, day) => sum + (day?.attainmentCapacityMilliseconds || 0), 0);
      return {
        date,
        employeeCount: rows.filter(day => (day?.attainmentCapacityMilliseconds || 0) > 0).length,
        attainmentBasisPoints: basisPoints(standard, capacity),
      };
    });

    const laborSummary = employeeMatrix.reduce((sum, row) => ({
      plannedMilliseconds: sum.plannedMilliseconds + row.plannedMilliseconds,
      attendanceMilliseconds: sum.attendanceMilliseconds + row.attendanceMilliseconds,
      standardLaborMilliseconds: sum.standardLaborMilliseconds + row.standardLaborMilliseconds,
      unmatchedStandardLaborMilliseconds: sum.unmatchedStandardLaborMilliseconds + row.unmatchedStandardLaborMilliseconds,
      exemptAbnormalMilliseconds: sum.exemptAbnormalMilliseconds + row.exemptAbnormalMilliseconds,
      attainmentCapacityMilliseconds: sum.attainmentCapacityMilliseconds + row.attainmentCapacityMilliseconds,
      confirmedAttendanceRecords: sum.confirmedAttendanceRecords + row.confirmedDays,
      draftAttendanceRecords: sum.draftAttendanceRecords + row.draftDays,
    }), {
      plannedMilliseconds: 0,
      attendanceMilliseconds: 0,
      standardLaborMilliseconds: 0,
      unmatchedStandardLaborMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      attainmentCapacityMilliseconds: 0,
      confirmedAttendanceRecords: 0,
      draftAttendanceRecords: 0,
    });
    const planSummary = weeklyPlan.reduce((sum, week) => ({
      plannedBatches: sum.plannedBatches + week.plannedBatches,
      completedBatches: sum.completedBatches + week.completedBatches,
      plannedQuantity: sum.plannedQuantity + week.plannedQuantity,
      completedQuantity: sum.completedQuantity + week.completedQuantity,
    }), { plannedBatches: 0, completedBatches: 0, plannedQuantity: 0, completedQuantity: 0 });

    const response: ReportOperationsDTO = {
      month,
      period,
      date,
      workforceScope: 'PRODUCTION',
      workforceLabel: '生产部',
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      cutoffAt: cutoffAt.toISOString(),
      generatedAt: now.toISOString(),
      targetBasisPoints: 9_500,
      dates: dateKeys.map(date => {
        const label = dayLabel(date);
        return {
          date,
          day: Number(date.slice(-2)),
          ...label,
          isFuture: date > todayKey(now),
        };
      }),
      summary: {
        employeeCount: employeeMatrix.length,
        teamCount: teamMonthly.length,
        ...laborSummary,
        attendanceBasisPoints: basisPoints(laborSummary.attendanceMilliseconds, laborSummary.plannedMilliseconds),
        attainmentBasisPoints: basisPoints(laborSummary.standardLaborMilliseconds, laborSummary.attainmentCapacityMilliseconds),
        dataCoverageBasisPoints: basisPoints(
          laborSummary.confirmedAttendanceRecords,
          laborSummary.confirmedAttendanceRecords + laborSummary.draftAttendanceRecords,
        ),
        ...planSummary,
        batchCompletionBasisPoints: cappedBasisPoints(planSummary.completedBatches, planSummary.plannedBatches),
        quantityCompletionBasisPoints: cappedBasisPoints(planSummary.completedQuantity, planSummary.plannedQuantity),
      },
      teamMonthly,
      teamDaily,
      weeklyPlan,
      dailyAttendance,
      employeeMatrix,
      dailyAttainmentAverage,
      dataNotes: [
        '批量工时达成率 = 已匹配标准产出工时 ÷（确认实际出勤工时 × 95% × 当天个人计入比例）；部分请假按实际出勤小时计算，样品组独立分账。',
        '出勤率同时保留人数口径与工时口径；草稿考勤不进入正式指标，仅计入数据覆盖率。',
        '周计划批次与数量按计划完成日期分周，完成量取截至统计截止时点的最终工序良品并封顶到计划数量。',
        '金额与产值尚无权威单价来源，本模块不生成推测值；待单价主数据接入后再启用。',
      ],
    };
    const result = NextResponse.json({ ok: true, report: response });
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('operations report failed', error);
    return NextResponse.json({ ok: false, error: '生产数据总表加载失败' }, { status: 500 });
  }
}
