import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  basisPoints,
  dateKeyFromDatabase,
  parseWorkDate,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import {
  attendanceDayMetrics,
  laborPerformanceMetrics,
} from '@/lib/report-labor-metrics';
import { safeLaborMilliseconds } from '@/lib/process-labor-service';
import { employeeReportRange, serializeEmployee } from '@/lib/process-time';
import { ReportDateRangeError, reportDateRange, reportRangeDateKeys } from '@/lib/report-date-range';
import {
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  isEmployeeHiredOnDate,
  productionEmployeeWhere,
} from '@/lib/production-workforce';
import {
  allocatePlanBatchCompletionQuantities,
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
  scheduledOverrideMilliseconds: number | null;
  plannedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  attendanceMilliseconds: number;
  leaveMilliseconds: number;
  actualLaborMilliseconds: number;
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
    scheduledOverrideMilliseconds: null,
    plannedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0,
    attendanceMilliseconds: 0,
    leaveMilliseconds: 0,
    actualLaborMilliseconds: 0,
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
  const attendance = attendanceDayMetrics({
    attendanceType: attendanceOfficial ? day.attendanceType : null,
    scheduledMilliseconds: attendanceOfficial
      ? day.scheduledOverrideMilliseconds ?? day.plannedMilliseconds
      : 0,
    plannedOvertimeMilliseconds: attendanceOfficial ? day.plannedOvertimeMilliseconds : 0,
    plannedOvertimeConfirmed: attendanceOfficial && day.scheduledOverrideMilliseconds !== null,
    actualOvertimeMilliseconds: attendanceOfficial ? day.actualOvertimeMilliseconds : 0,
    leaveMilliseconds: attendanceOfficial ? day.leaveMilliseconds : 0,
    actualAttendanceMilliseconds: attendanceOfficial ? day.attendanceMilliseconds : 0,
    overtimeBasis: 'actual_confirmed',
  });
  const hasCapacity = day.attainmentEligible
    && day.attainmentStream === 'batch'
    && day.attainmentFactorBasisPoints > 0
    && attendanceOfficial
    && day.attendanceMilliseconds > 0;
  const standardLabor = hasCapacity ? day.standardLaborMilliseconds : 0;
  const unmatchedStandardLabor = hasCapacity ? 0 : day.standardLaborMilliseconds;
  const performance = laborPerformanceMetrics({
    attendanceMilliseconds: attendance.actualAttendanceMilliseconds,
    actualLaborMilliseconds: attendanceOfficial ? day.actualLaborMilliseconds : 0,
    exemptAbnormalMilliseconds: attendanceOfficial ? day.exemptAbnormalMilliseconds : 0,
    standardLaborMilliseconds: standardLabor,
    attainmentFactorBasisPoints: hasCapacity ? day.attainmentFactorBasisPoints : 0,
  });
  return {
    date,
    status: day.status,
    attendanceType: day.attendanceType,
    plannedMilliseconds: attendance.scheduledMilliseconds,
    scheduledMilliseconds: attendance.scheduledMilliseconds,
    plannedOvertimeMilliseconds: attendance.plannedOvertimeMilliseconds,
    recognizedOvertimeMilliseconds: attendance.recognizedOvertimeMilliseconds,
    actualOvertimeMilliseconds: attendance.actualOvertimeMilliseconds,
    leaveDeductionMilliseconds: attendance.leaveDeductionMilliseconds,
    netExpectedMilliseconds: attendance.netExpectedMilliseconds,
    attendanceMilliseconds: attendance.actualAttendanceMilliseconds,
    extraAttendanceMilliseconds: attendance.extraAttendanceMilliseconds,
    leaveMilliseconds: attendanceOfficial ? day.leaveMilliseconds : 0,
    actualLaborMilliseconds: attendanceOfficial ? day.actualLaborMilliseconds : 0,
    standardLaborMilliseconds: standardLabor,
    unmatchedStandardLaborMilliseconds: unmatchedStandardLabor,
    exemptAbnormalMilliseconds: attendanceOfficial ? day.exemptAbnormalMilliseconds : 0,
    overlapMilliseconds: performance.overlapMilliseconds,
    unexplainedMilliseconds: performance.unexplainedMilliseconds,
    attainmentCapacityMilliseconds: performance.attainmentCapacityMilliseconds,
    attendanceRawBasisPoints: attendance.attendanceRawBasisPoints,
    attendanceBasisPoints: attendance.attendanceBasisPoints,
    utilizationBasisPoints: performance.utilizationBasisPoints,
    efficiencyBasisPoints: performance.efficiencyBasisPoints,
    attainmentBasisPoints: performance.targetAttainmentBasisPoints,
    overtimeSource: attendance.overtimeSource,
    attainmentEligible: day.attainmentEligible,
    attainmentFactorBasisPoints: day.attainmentFactorBasisPoints,
    attainmentStream: day.attainmentStream,
  };
}

function notEmployedDay(date: string): ReportOperationsEmployeeDayDTO {
  return {
    ...officialDay(emptyDay(false, 0, 'excluded'), date),
    status: 'not_employed',
    attendanceType: null,
  };
}

function emptyLaborRow(team: string): ReportOperationsLaborRowDTO {
  return {
    team,
    employeeCount: 0,
    attendancePeople: 0,
    confirmedRecords: 0,
    plannedMilliseconds: 0,
    scheduledMilliseconds: 0,
    plannedOvertimeMilliseconds: 0,
    recognizedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0,
    leaveDeductionMilliseconds: 0,
    netExpectedMilliseconds: 0,
    attendanceMilliseconds: 0,
    extraAttendanceMilliseconds: 0,
    leaveMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    actualLaborMilliseconds: 0,
    standardLaborMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0,
    overlapMilliseconds: 0,
    unexplainedMilliseconds: 0,
    attainmentCapacityMilliseconds: 0,
    attendanceRawBasisPoints: null,
    attendanceBasisPoints: null,
    utilizationBasisPoints: null,
    efficiencyBasisPoints: null,
    attainmentBasisPoints: null,
  };
}

function finalizeLaborRow(row: ReportOperationsLaborRowDTO): ReportOperationsLaborRowDTO {
  const attendanceRawBasisPoints = basisPoints(row.attendanceMilliseconds, row.netExpectedMilliseconds);
  return {
    ...row,
    attendanceRawBasisPoints,
    attendanceBasisPoints: attendanceRawBasisPoints === null ? null : Math.min(10_000, attendanceRawBasisPoints),
    utilizationBasisPoints: cappedBasisPoints(
      Math.min(row.attendanceMilliseconds, row.actualLaborMilliseconds + row.exemptAbnormalMilliseconds),
      row.attendanceMilliseconds,
    ),
    efficiencyBasisPoints: basisPoints(row.standardLaborMilliseconds, row.actualLaborMilliseconds),
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
        AND: [employeeHiredBeforeWhere(endDate)],
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

    const [attendanceRecords, capacityOverrides, laborClaims, executions, abnormalAllocations, batches] = await Promise.all([
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
          overtimeMilliseconds: true,
        },
      }) : Promise.resolve([]),
      employeeIds.length ? prisma.dailyCapacityOverride.findMany({
        where: {
          employeeId: { in: employeeIds },
          plan: {
            workDate: { gte: startDate, lt: endDate },
            status: { in: ['CONFIRMED', 'IN_PROGRESS', 'ARCHIVED'] },
          },
        },
        orderBy: { updatedAt: 'asc' },
        select: {
          employeeId: true,
          regularMilliseconds: true,
          overtimeMilliseconds: true,
          plan: { select: { workDate: true } },
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
          poolId: true,
          employeeId: true,
          workDate: true,
          standardLaborMilliseconds: true,
          pool: {
            select: {
              countsForEfficiency: true,
              completion: {
                select: {
                  workStartedAt: true,
                  workEndedAt: true,
                  participants: { select: { employeeId: true } },
                },
              },
            },
          },
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
          actualLaborMilliseconds: true,
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

    const planWorkOrderIds = [...new Set(batches.map(batch => batch.workOrderId).filter((id): id is string => Boolean(id)))];
    const allocationBatches = planWorkOrderIds.length ? await prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: { not: 'cancelled' },
        workOrderId: { in: planWorkOrderIds },
        plannedCompletionDate: { lt: end },
      },
      select: {
        id: true,
        quantity: true,
        plannedCompletionDate: true,
        workOrderId: true,
      },
    }) : [];
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
      day.actualOvertimeMilliseconds = Math.max(0, record.overtimeMilliseconds);
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
    // Capacity overrides belong to confirmed production plans. Ordered updates
    // intentionally overwrite an earlier cross-team entry for the same person/day
    // so one employee's daily capacity is never counted twice.
    for (const override of capacityOverrides) {
      const day = mutableDay(override.employeeId, dateKeyFromDatabase(override.plan.workDate));
      day.scheduledOverrideMilliseconds = Math.max(0, override.regularMilliseconds);
      day.plannedOvertimeMilliseconds = Math.max(0, override.overtimeMilliseconds);
    }
    const claimActualEvidence = new Set<string>();
    for (const claim of laborClaims) {
      if (!claim.pool.countsForEfficiency) continue;
      const day = mutableDay(claim.employeeId, dateKeyFromDatabase(claim.workDate));
      day.standardLaborMilliseconds += safeLaborMilliseconds(claim.standardLaborMilliseconds);
      const completion = claim.pool.completion;
      const evidenceKey = `${claim.poolId}:${claim.employeeId}`;
      if (
        completion.workStartedAt
        && completion.workEndedAt
        && completion.participants.some(participant => participant.employeeId === claim.employeeId)
        && !claimActualEvidence.has(evidenceKey)
      ) {
        day.actualLaborMilliseconds += Math.max(
          0,
          completion.workEndedAt.getTime() - completion.workStartedAt.getTime(),
        );
        claimActualEvidence.add(evidenceKey);
      }
    }
    for (const execution of executions) {
      const day = mutableDay(execution.employeeId, shanghaiDateKey(execution.endedAt));
      day.standardLaborMilliseconds += Math.max(0, execution.standardLaborMilliseconds);
      day.actualLaborMilliseconds += Math.max(0, execution.actualLaborMilliseconds);
    }
    for (const allocation of abnormalAllocations) {
      mutableDay(allocation.employeeId, dateKeyFromDatabase(allocation.workDate)).exemptAbnormalMilliseconds
        += Math.max(0, allocation.event.approvedDurationMilliseconds ?? allocation.durationMilliseconds);
    }

    const employeeMatrix: ReportOperationsEmployeeRowDTO[] = employees.map(employee => {
      const sourceDays = employeeDayMap.get(employee.id) || new Map<string, MutableDay>();
      const currentStream = normalizedAttainmentStream(employee.attainmentStream, employee.attainmentEligible);
      const days = dateKeys.map(date => {
        if (!isEmployeeHiredOnDate(employee, date)) return notEmployedDay(date);
        const source = sourceDays.get(date) || emptyDay(
          employee.attainmentEligible,
          employee.attainmentFactorBasisPoints,
          currentStream,
        );
        if (!employee.attainmentEligible || employee.attainmentFactorBasisPoints <= 0 || currentStream !== 'batch') {
          source.attainmentEligible = false;
          source.attainmentFactorBasisPoints = 0;
          source.attainmentStream = currentStream;
        }
        return officialDay(source, date);
      });
      const totals = days.reduce((sum, day) => ({
        plannedMilliseconds: sum.plannedMilliseconds + day.plannedMilliseconds,
        scheduledMilliseconds: sum.scheduledMilliseconds + day.scheduledMilliseconds,
        plannedOvertimeMilliseconds: sum.plannedOvertimeMilliseconds + day.plannedOvertimeMilliseconds,
        recognizedOvertimeMilliseconds: sum.recognizedOvertimeMilliseconds + day.recognizedOvertimeMilliseconds,
        actualOvertimeMilliseconds: sum.actualOvertimeMilliseconds + day.actualOvertimeMilliseconds,
        leaveDeductionMilliseconds: sum.leaveDeductionMilliseconds + day.leaveDeductionMilliseconds,
        netExpectedMilliseconds: sum.netExpectedMilliseconds + day.netExpectedMilliseconds,
        attendanceMilliseconds: sum.attendanceMilliseconds + day.attendanceMilliseconds,
        extraAttendanceMilliseconds: sum.extraAttendanceMilliseconds + day.extraAttendanceMilliseconds,
        leaveMilliseconds: sum.leaveMilliseconds + day.leaveMilliseconds,
        actualLaborMilliseconds: sum.actualLaborMilliseconds + day.actualLaborMilliseconds,
        standardLaborMilliseconds: sum.standardLaborMilliseconds + day.standardLaborMilliseconds,
        unmatchedStandardLaborMilliseconds: sum.unmatchedStandardLaborMilliseconds + day.unmatchedStandardLaborMilliseconds,
        exemptAbnormalMilliseconds: sum.exemptAbnormalMilliseconds + day.exemptAbnormalMilliseconds,
        overlapMilliseconds: sum.overlapMilliseconds + day.overlapMilliseconds,
        unexplainedMilliseconds: sum.unexplainedMilliseconds + day.unexplainedMilliseconds,
        attainmentCapacityMilliseconds: sum.attainmentCapacityMilliseconds + day.attainmentCapacityMilliseconds,
        confirmedDays: sum.confirmedDays + (day.status === 'confirmed' || day.status === 'rest' ? 1 : 0),
        draftDays: sum.draftDays + (day.status === 'draft' ? 1 : 0),
        missingDays: sum.missingDays + (day.status === 'missing' && day.date <= todayKey(now) ? 1 : 0),
      }), {
        plannedMilliseconds: 0,
        scheduledMilliseconds: 0,
        plannedOvertimeMilliseconds: 0,
        recognizedOvertimeMilliseconds: 0,
        actualOvertimeMilliseconds: 0,
        leaveDeductionMilliseconds: 0,
        netExpectedMilliseconds: 0,
        attendanceMilliseconds: 0,
        extraAttendanceMilliseconds: 0,
        leaveMilliseconds: 0,
        actualLaborMilliseconds: 0,
        standardLaborMilliseconds: 0,
        unmatchedStandardLaborMilliseconds: 0,
        exemptAbnormalMilliseconds: 0,
        overlapMilliseconds: 0,
        unexplainedMilliseconds: 0,
        attainmentCapacityMilliseconds: 0,
        confirmedDays: 0,
        draftDays: 0,
        missingDays: 0,
      });
      const attendanceRawBasisPoints = basisPoints(totals.attendanceMilliseconds, totals.netExpectedMilliseconds);
      return {
        employee: serializeEmployee(employee),
        team: teamLabel(employee),
        position: String(employee.position || '岗位未设置'),
        ...totals,
        attendanceRawBasisPoints,
        attendanceBasisPoints: attendanceRawBasisPoints === null ? null : Math.min(10_000, attendanceRawBasisPoints),
        utilizationBasisPoints: cappedBasisPoints(
          Math.min(totals.attendanceMilliseconds, totals.actualLaborMilliseconds + totals.exemptAbnormalMilliseconds),
          totals.attendanceMilliseconds,
        ),
        efficiencyBasisPoints: basisPoints(totals.standardLaborMilliseconds, totals.actualLaborMilliseconds),
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
      team.scheduledMilliseconds += row.scheduledMilliseconds;
      team.plannedOvertimeMilliseconds += row.plannedOvertimeMilliseconds;
      team.recognizedOvertimeMilliseconds += row.recognizedOvertimeMilliseconds;
      team.actualOvertimeMilliseconds += row.actualOvertimeMilliseconds;
      team.leaveDeductionMilliseconds += row.leaveDeductionMilliseconds;
      team.netExpectedMilliseconds += row.netExpectedMilliseconds;
      team.attendanceMilliseconds += row.attendanceMilliseconds;
      team.extraAttendanceMilliseconds += row.extraAttendanceMilliseconds;
      team.leaveMilliseconds += row.leaveMilliseconds;
      team.exemptAbnormalMilliseconds += row.exemptAbnormalMilliseconds;
      team.actualLaborMilliseconds += row.actualLaborMilliseconds;
      team.standardLaborMilliseconds += row.standardLaborMilliseconds;
      team.unmatchedStandardLaborMilliseconds += row.unmatchedStandardLaborMilliseconds;
      team.overlapMilliseconds += row.overlapMilliseconds;
      team.unexplainedMilliseconds += row.unexplainedMilliseconds;
      team.attainmentCapacityMilliseconds += row.attainmentCapacityMilliseconds;
      teamMonthlyMap.set(row.team, team);
    }
    const teamMonthly = [...teamMonthlyMap.values()].map(finalizeLaborRow).sort((left, right) =>
      (right.attainmentBasisPoints ?? -1) - (left.attainmentBasisPoints ?? -1)
      || left.team.localeCompare(right.team, 'zh-CN'));

    const teamDailyMap = new Map<string, ReportOperationsLaborRowDTO & { date: string }>();
    for (const employee of employeeMatrix) {
      for (const day of employee.days) {
        if (day.status === 'not_employed') continue;
        const key = `${day.date}\u0000${employee.team}`;
        const row = teamDailyMap.get(key) || { ...emptyLaborRow(employee.team), date: day.date };
        row.employeeCount += 1;
        row.attendancePeople += day.attendanceMilliseconds > 0 ? 1 : 0;
        row.confirmedRecords += day.status === 'confirmed' || day.status === 'rest' ? 1 : 0;
        row.plannedMilliseconds += day.plannedMilliseconds;
        row.scheduledMilliseconds += day.scheduledMilliseconds;
        row.plannedOvertimeMilliseconds += day.plannedOvertimeMilliseconds;
        row.recognizedOvertimeMilliseconds += day.recognizedOvertimeMilliseconds;
        row.actualOvertimeMilliseconds += day.actualOvertimeMilliseconds;
        row.leaveDeductionMilliseconds += day.leaveDeductionMilliseconds;
        row.netExpectedMilliseconds += day.netExpectedMilliseconds;
        row.attendanceMilliseconds += day.attendanceMilliseconds;
        row.extraAttendanceMilliseconds += day.extraAttendanceMilliseconds;
        row.leaveMilliseconds += day.leaveMilliseconds;
        row.exemptAbnormalMilliseconds += day.exemptAbnormalMilliseconds;
        row.actualLaborMilliseconds += day.actualLaborMilliseconds;
        row.standardLaborMilliseconds += day.standardLaborMilliseconds;
        row.unmatchedStandardLaborMilliseconds += day.unmatchedStandardLaborMilliseconds;
        row.overlapMilliseconds += day.overlapMilliseconds;
        row.unexplainedMilliseconds += day.unexplainedMilliseconds;
        row.attainmentCapacityMilliseconds += day.attainmentCapacityMilliseconds;
        teamDailyMap.set(key, row);
      }
    }
    const teamDaily = [...teamDailyMap.values()].map(row => ({ ...finalizeLaborRow(row), date: row.date }));

    const attendanceByDate = new Map(dateKeys.map(date => [date, {
      date,
      scheduledPeople: 0,
      plannedPeople: 0,
      attendancePeople: 0,
      leavePeople: 0,
      fullLeavePeople: 0,
      absentPeople: 0,
      restPeople: 0,
      confirmedRecords: 0,
      draftRecords: 0,
      plannedMilliseconds: 0,
      scheduledMilliseconds: 0,
      plannedOvertimeMilliseconds: 0,
      recognizedOvertimeMilliseconds: 0,
      actualOvertimeMilliseconds: 0,
      leaveDeductionMilliseconds: 0,
      netExpectedMilliseconds: 0,
      attendanceMilliseconds: 0,
      extraAttendanceMilliseconds: 0,
      attendanceRawBasisPoints: null as number | null,
      attendanceBasisPoints: null as number | null,
      hoursBasisPoints: null as number | null,
      planOvertimeRecords: 0,
      attendanceFallbackRecords: 0,
    }]));
    for (const employee of employeeMatrix) {
      for (const employeeDay of employee.days) {
        const day = attendanceByDate.get(employeeDay.date);
        if (!day) continue;
        if (employeeDay.status === 'draft') {
          day.draftRecords += 1;
          continue;
        }
        if (employeeDay.status === 'missing' || employeeDay.status === 'not_employed') continue;
        day.confirmedRecords += 1;
        if (employeeDay.attendanceType === 'rest') {
          day.restPeople += 1;
          continue;
        }
        if (employeeDay.scheduledMilliseconds > 0) day.scheduledPeople += 1;
        if (employeeDay.netExpectedMilliseconds > 0) day.plannedPeople += 1;
        if (employeeDay.attendanceMilliseconds > 0) day.attendancePeople += 1;
        if (employeeDay.attendanceType === 'leave') day.fullLeavePeople += 1;
        if (employeeDay.leaveDeductionMilliseconds > 0) day.leavePeople += 1;
        if (employeeDay.attendanceType === 'absent') day.absentPeople += 1;
        if (employeeDay.overtimeSource === 'confirmed_plan') day.planOvertimeRecords += 1;
        if (employeeDay.overtimeSource === 'attendance_fallback') day.attendanceFallbackRecords += 1;
        day.plannedMilliseconds += employeeDay.plannedMilliseconds;
        day.scheduledMilliseconds += employeeDay.scheduledMilliseconds;
        day.plannedOvertimeMilliseconds += employeeDay.plannedOvertimeMilliseconds;
        day.recognizedOvertimeMilliseconds += employeeDay.recognizedOvertimeMilliseconds;
        day.actualOvertimeMilliseconds += employeeDay.actualOvertimeMilliseconds;
        day.leaveDeductionMilliseconds += employeeDay.leaveDeductionMilliseconds;
        day.netExpectedMilliseconds += employeeDay.netExpectedMilliseconds;
        day.attendanceMilliseconds += employeeDay.attendanceMilliseconds;
        day.extraAttendanceMilliseconds += employeeDay.extraAttendanceMilliseconds;
      }
    }
    const dailyAttendance = [...attendanceByDate.values()].map(day => {
      const raw = basisPoints(day.attendanceMilliseconds, day.netExpectedMilliseconds);
      return {
        ...day,
        attendanceRawBasisPoints: raw,
        attendanceBasisPoints: cappedBasisPoints(day.attendancePeople, day.plannedPeople),
        hoursBasisPoints: raw === null ? null : Math.min(10_000, raw),
      };
    });

    const completedByWorkOrder = new Map<string, number>();
    for (const completion of finalCompletions) {
      completedByWorkOrder.set(
        completion.workOrderId,
        (completedByWorkOrder.get(completion.workOrderId) || 0) + Math.max(0, completion.goodQty),
      );
    }
    const allocatedByBatch = allocatePlanBatchCompletionQuantities(
      allocationBatches.map(batch => ({
        id: batch.id,
        workOrderId: batch.workOrderId,
        quantity: batch.quantity,
        plannedDateKey: shanghaiDateKey(batch.plannedCompletionDate),
      })),
      completedByWorkOrder,
    );
    const cutoffDateKey = todayKey(cutoffAt);
    const weeklyPlan = reportRangeWeekBuckets(dateKeys).map(bucket => ({
      ...bucket,
      scheduledBatches: 0,
      plannedBatches: 0,
      futureBatches: 0,
      completedBatches: 0,
      scheduledQuantity: 0,
      plannedQuantity: 0,
      futureQuantity: 0,
      completedQuantity: 0,
      batchCompletionBasisPoints: null as number | null,
      quantityCompletionBasisPoints: null as number | null,
    }));
    const weekMap = new Map(weeklyPlan.map(week => [week.key, week]));
    for (const batch of batches) {
      const plannedDateKey = shanghaiDateKey(batch.plannedCompletionDate);
      const week = weekMap.get(reportWeekKey(plannedDateKey));
      if (!week) continue;
      const plannedQuantity = Math.max(0, batch.quantity);
      week.scheduledBatches += 1;
      week.scheduledQuantity += plannedQuantity;
      if (plannedDateKey > cutoffDateKey) {
        week.futureBatches += 1;
        week.futureQuantity += plannedQuantity;
        continue;
      }
      const completedQuantity = allocatedByBatch.get(batch.id) || 0;
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
      scheduledMilliseconds: sum.scheduledMilliseconds + row.scheduledMilliseconds,
      plannedOvertimeMilliseconds: sum.plannedOvertimeMilliseconds + row.plannedOvertimeMilliseconds,
      recognizedOvertimeMilliseconds: sum.recognizedOvertimeMilliseconds + row.recognizedOvertimeMilliseconds,
      actualOvertimeMilliseconds: sum.actualOvertimeMilliseconds + row.actualOvertimeMilliseconds,
      leaveDeductionMilliseconds: sum.leaveDeductionMilliseconds + row.leaveDeductionMilliseconds,
      netExpectedMilliseconds: sum.netExpectedMilliseconds + row.netExpectedMilliseconds,
      attendanceMilliseconds: sum.attendanceMilliseconds + row.attendanceMilliseconds,
      extraAttendanceMilliseconds: sum.extraAttendanceMilliseconds + row.extraAttendanceMilliseconds,
      actualLaborMilliseconds: sum.actualLaborMilliseconds + row.actualLaborMilliseconds,
      standardLaborMilliseconds: sum.standardLaborMilliseconds + row.standardLaborMilliseconds,
      unmatchedStandardLaborMilliseconds: sum.unmatchedStandardLaborMilliseconds + row.unmatchedStandardLaborMilliseconds,
      exemptAbnormalMilliseconds: sum.exemptAbnormalMilliseconds + row.exemptAbnormalMilliseconds,
      overlapMilliseconds: sum.overlapMilliseconds + row.overlapMilliseconds,
      unexplainedMilliseconds: sum.unexplainedMilliseconds + row.unexplainedMilliseconds,
      attainmentCapacityMilliseconds: sum.attainmentCapacityMilliseconds + row.attainmentCapacityMilliseconds,
      confirmedAttendanceRecords: sum.confirmedAttendanceRecords + row.confirmedDays,
      draftAttendanceRecords: sum.draftAttendanceRecords + row.draftDays,
      missingAttendanceRecords: sum.missingAttendanceRecords + row.missingDays,
    }), {
      plannedMilliseconds: 0,
      scheduledMilliseconds: 0,
      plannedOvertimeMilliseconds: 0,
      recognizedOvertimeMilliseconds: 0,
      actualOvertimeMilliseconds: 0,
      leaveDeductionMilliseconds: 0,
      netExpectedMilliseconds: 0,
      attendanceMilliseconds: 0,
      extraAttendanceMilliseconds: 0,
      actualLaborMilliseconds: 0,
      standardLaborMilliseconds: 0,
      unmatchedStandardLaborMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      overlapMilliseconds: 0,
      unexplainedMilliseconds: 0,
      attainmentCapacityMilliseconds: 0,
      confirmedAttendanceRecords: 0,
      draftAttendanceRecords: 0,
      missingAttendanceRecords: 0,
    });
    const planSummary = weeklyPlan.reduce((sum, week) => ({
      scheduledBatches: sum.scheduledBatches + week.scheduledBatches,
      plannedBatches: sum.plannedBatches + week.plannedBatches,
      futureBatches: sum.futureBatches + week.futureBatches,
      completedBatches: sum.completedBatches + week.completedBatches,
      scheduledQuantity: sum.scheduledQuantity + week.scheduledQuantity,
      plannedQuantity: sum.plannedQuantity + week.plannedQuantity,
      futureQuantity: sum.futureQuantity + week.futureQuantity,
      completedQuantity: sum.completedQuantity + week.completedQuantity,
    }), {
      scheduledBatches: 0,
      plannedBatches: 0,
      futureBatches: 0,
      completedBatches: 0,
      scheduledQuantity: 0,
      plannedQuantity: 0,
      futureQuantity: 0,
      completedQuantity: 0,
    });

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
        attendanceRawBasisPoints: basisPoints(laborSummary.attendanceMilliseconds, laborSummary.netExpectedMilliseconds),
        attendanceBasisPoints: cappedBasisPoints(laborSummary.attendanceMilliseconds, laborSummary.netExpectedMilliseconds),
        utilizationBasisPoints: cappedBasisPoints(
          Math.min(laborSummary.attendanceMilliseconds, laborSummary.actualLaborMilliseconds + laborSummary.exemptAbnormalMilliseconds),
          laborSummary.attendanceMilliseconds,
        ),
        efficiencyBasisPoints: basisPoints(laborSummary.standardLaborMilliseconds, laborSummary.actualLaborMilliseconds),
        attainmentBasisPoints: basisPoints(laborSummary.standardLaborMilliseconds, laborSummary.attainmentCapacityMilliseconds),
        dataCoverageBasisPoints: basisPoints(
          laborSummary.confirmedAttendanceRecords,
          laborSummary.confirmedAttendanceRecords
            + laborSummary.draftAttendanceRecords
            + laborSummary.missingAttendanceRecords,
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
        '净应出勤 = 排班常规工时 + 已确认实际加班 - 已确认请假；实际出勤已经包含加班，不重复相加。',
        '出勤得分按实际出勤 ÷ 净应出勤计算并封顶 100%，超出部分单列；整日请假和休息日剔除基数，部分请假缩减基数，正式缺勤仍保留在出勤基数。草稿与缺失考勤不按 0 计算。',
        '工时利用率 = min(实际出勤，生产实耗工时 + 已确认免责异常工时) ÷ 实际出勤；标准工时效率 = 标准工时 ÷ 生产实耗工时；目标达成率 = 标准工时 ÷（有效出勤 × 95% × 个人计入比例）。',
        '周计划按计划完成日期分周，只以统计截止日前已到期批次为达成率基数；未来批次显示为未到期。最终工序良品按同一工单的批次先后顺序一次分配，不重复计入多个批次。',
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
