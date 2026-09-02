import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { ReportDateRangeError, reportRangeQuery } from '@/lib/report-date-range';
import { prisma } from '@/lib/prisma';
import { PRODUCTION_CONTROL_SELECT, productionCustomerDate, serializeProductionControl } from '@/lib/production-control';
import {
  parseReportQuantity,
  reportBasisPoints,
  reportCompletenessBasisPoints,
  reportDateKey,
  reportDateLabel,
  reportPlanningDateKey,
  reportRangeDayKeys,
  reportRisk,
  reportSampleStatus,
  reportWorkOrderStatus,
} from '@/lib/report-center';
import type {
  ReportCenterFocusItemDTO,
  ReportCenterFocusStatusDTO,
  ReportCenterModeDTO,
  ReportCenterOverviewDTO,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const workOrderSelect = Prisma.validator<Prisma.WorkOrderSelect>()({
  ...PRODUCTION_CONTROL_SELECT,
  id: true,
  code: true,
  customerName: true,
  productName: true,
  specification: true,
  productionTargetQty: true,
  completedQty: true,
  progress: true,
  stage: true,
  status: true,
  priority: true,
  plannedAt: true,
  startedAt: true,
  completedAt: true,
  productionOwner: true,
  materialStatus: true,
  processRoute: {
    select: {
      status: true,
      steps: {
        where: { retiredAt: null },
        orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          processCode: true,
          processName: true,
          status: true,
          inputQty: true,
          goodOutputQty: true,
          timeBasis: true,
          standardMillisecondsPerUnit: true,
          countsForEfficiency: true,
        },
      },
    },
  },
  drawingLibraryItem: {
    select: {
      id: true,
      files: {
        where: { deletedAt: null, isCurrent: true },
        select: { id: true, category: { select: { code: true } } },
      },
      productDataRecords: {
        where: { kind: 'MATERIAL', status: 'PUBLISHED' },
        select: { id: true },
      },
    },
  },
  materialTask: {
    select: { status: true, exceptionType: true },
  },
  productionPlanBatch: {
    select: {
      quantity: true,
      plannedCompletionDate: true,
      planOrder: { select: { customerDueDate: true } },
    },
  },
});

type WorkOrderRecord = Prisma.WorkOrderGetPayload<{ select: typeof workOrderSelect }>;

function reportMode(value: string | null): ReportCenterModeDTO {
  return value === 'mass' ? 'mass' : value === 'sample' ? 'sample' : 'all';
}

function dateInRange(value: Date | null, start: Date, end: Date): boolean {
  return Boolean(value && value >= start && value < end);
}

function workOrderDueAt(order: WorkOrderRecord): Date | null {
  return productionCustomerDate(order);
}

function workOrderQuantity(order: WorkOrderRecord): { planned: number | null; completed: number | null } {
  const planned = parseReportQuantity(order.productionPlanBatch?.quantity)
    ?? parseReportQuantity(order.productionTargetQty);
  const completed = parseReportQuantity(order.completedQty)
    ?? (order.completedAt && planned !== null ? planned : null);
  return { planned, completed };
}

function workOrderReadiness(order: WorkOrderRecord) {
  const steps = order.processRoute?.steps || [];
  const routeReady = steps.length > 0;
  const standardReady = routeReady && steps.every(step => !step.countsForEfficiency
    || (Boolean(step.timeBasis) && Number(step.standardMillisecondsPerUnit || 0) > 0));
  const drawingReady = Boolean(order.drawingLibraryItem?.files.some(file => file.category.code === 'drawing'));
  const materialRulePublished = Boolean(order.drawingLibraryItem?.productDataRecords.length);
  return { routeReady, standardReady, drawingReady, materialRulePublished };
}

function workOrderFocusItem(order: WorkOrderRecord, referenceAt: Date): ReportCenterFocusItemDTO {
  const quantity = workOrderQuantity(order);
  const dueAt = workOrderDueAt(order);
  const steps = order.processRoute?.steps || [];
  const currentIndex = steps.findIndex(step => step.status === 'current');
  const firstPendingIndex = steps.findIndex(step => step.status === 'pending');
  const activeIndex = currentIndex >= 0 ? currentIndex : firstPendingIndex;
  const current = activeIndex >= 0 ? steps[activeIndex] : null;
  const next = activeIndex >= 0
    ? steps.slice(activeIndex + 1).find(step => step.status === 'pending') || null
    : null;
  const readiness = workOrderReadiness(order);
  const missingData = [
    !readiness.routeReady ? '未建立工艺路线' : '',
    readiness.routeReady && !readiness.standardReady ? '标准工时未补齐' : '',
    !readiness.drawingReady ? '未关联当前图纸' : '',
    !readiness.materialRulePublished ? '辅料规则未发布' : '',
  ].filter(Boolean);
  const completed = Boolean(order.completedAt || order.stage === 'completed' || order.status === 'completed');
  const started = Boolean(order.startedAt || order.progress > 0 || (quantity.completed || 0) > 0 || currentIndex >= 0);
  const state = reportWorkOrderStatus({ completed, started, dueAt, referenceAt });
  const control = serializeProductionControl(order);
  const dueInDays = dueAt ? Math.ceil((dueAt.getTime() - referenceAt.getTime()) / 86_400_000) : null;
  let risk = reportRisk({
    status: state.status,
    dueAt,
    referenceAt,
    missingDataCount: missingData.length,
  });
  if (!completed && order.materialTask?.status === 'exception') {
    risk = { risk: 'high', label: '配料异常' };
  } else if (!completed && order.materialTask?.status === 'pending' && risk.risk === 'low') {
    risk = { risk: 'medium', label: '配料未齐' };
  }
  return {
    entityType: 'workOrder',
    id: order.id,
    code: order.code,
    customerName: order.customerName || '客户未填写',
    productName: order.productName || '产品未填写',
    specification: order.specification || '规格未填写',
    plannedQty: quantity.planned,
    completedQty: quantity.completed,
    unitLabel: '套',
    progressBasisPoints: quantity.planned && quantity.completed !== null
      ? reportBasisPoints(quantity.completed, quantity.planned)
      : null,
    status: control.pausedAt && !completed ? 'paused' : state.status,
    statusLabel: control.pausedAt && !completed ? '已暂停' : state.label,
    currentProcess: current?.processName || null,
    nextProcess: next?.processName || null,
    owner: order.productionOwner || null,
    dueAt: dueAt?.toISOString() || null,
    dueSoon: state.status !== 'completed' && state.status !== 'overdue'
      && dueInDays !== null && dueInDays >= 0 && dueInDays <= 2,
    startedAt: order.startedAt?.toISOString() || null,
    completedAt: order.completedAt?.toISOString() || null,
    risk: risk.risk,
    riskLabel: [risk.label, control.pause?.reason ? `暂停：${control.pause.reason}` : '', control.note?.text || ''].filter(Boolean).join(' · '),
    missingData,
  };
}

function sampleFocusItem(
  task: Awaited<ReturnType<typeof loadSampleTasks>>[number],
  referenceAt: Date,
): ReportCenterFocusItemDTO {
  const pendingReviewCount = task.activeSubmissionId ? 1 : 0;
  const reviewedCount = task.submissions.filter(submission => ['CONFIRMED', 'REJECTED'].includes(submission.status)).length;
  const submittedCount = pendingReviewCount + reviewedCount;
  const state = reportSampleStatus({ status: task.status, dueAt: task.dueDate, referenceAt, pendingReviewCount });
  const dueInDays = task.dueDate
    ? Math.ceil((task.dueDate.getTime() - referenceAt.getTime()) / 86_400_000)
    : null;
  const risk = reportRisk({
    status: state.status,
    dueAt: task.dueDate,
    referenceAt,
    missingDataCount: 0,
    pendingReviewCount,
  });
  return {
    entityType: 'sampleTask',
    id: task.id,
    code: task.code,
    customerName: task.customerNameSnapshot,
    productName: task.productNameSnapshot || '样品产品',
    specification: task.specificationSnapshot,
    plannedQty: task.sampleQuantity,
    completedQty: task.status === 'COMPLETED' ? task.sampleQuantity : null,
    unitLabel: '件',
    progressBasisPoints: task.status === 'COMPLETED'
      ? 10_000
      : submittedCount > 0
        ? reportBasisPoints(reviewedCount, submittedCount)
        : null,
    status: state.status,
    statusLabel: state.label,
    currentProcess: task.status === 'COMPLETED' ? '完成归档' : pendingReviewCount > 0 ? '整包审核' : '数据采集',
    nextProcess: pendingReviewCount > 0 ? '发布产品资料' : null,
    owner: task.assignees.map(item => item.employee.name).join('、') || null,
    dueAt: task.dueDate?.toISOString() || null,
    dueSoon: state.status !== 'completed' && state.status !== 'overdue'
      && dueInDays !== null && dueInDays >= 0 && dueInDays <= 2,
    startedAt: task.createdAt.toISOString(),
    completedAt: task.completedAt?.toISOString() || null,
    submittedItemCount: submittedCount,
    pendingReviewCount,
    reviewedItemCount: reviewedCount,
    publishedItemCount: task.entries.filter(entry => entry.reviewStatus === 'PUBLISHED').length
      + task.photos.filter(photo => photo.reviewStatus === 'PUBLISHED').length,
    risk: risk.risk,
    riskLabel: risk.label,
    missingData: [],
  };
}

async function loadSampleTasks(where: Prisma.SampleTaskWhereInput) {
  return prisma.sampleTask.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    select: {
      id: true,
      code: true,
      customerNameSnapshot: true,
      productNameSnapshot: true,
      specificationSnapshot: true,
      sampleQuantity: true,
      dueDate: true,
      status: true,
      activeSubmissionId: true,
      createdAt: true,
      completedAt: true,
      assignees: { select: { employee: { select: { name: true } } } },
      entries: {
        where: { deletedAt: null },
        select: { reviewStatus: true, publishedAt: true },
      },
      photos: {
        where: { deletedAt: null },
        select: { reviewStatus: true, publishedAt: true },
      },
      submissions: { select: { status: true } },
    },
  });
}

function riskRank(value: ReportCenterFocusItemDTO): number {
  return value.risk === 'high' ? 0 : value.risk === 'medium' ? 1 : 2;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const { period, date, start, end } = reportRangeQuery(req.nextUrl.searchParams);
    const mode = reportMode(req.nextUrl.searchParams.get('mode'));
    const customer = String(req.nextUrl.searchParams.get('customer') || '').trim().slice(0, 120);
    const now = new Date();
    const referenceAt = now < end ? now : new Date(end.getTime() - 1);
    const customerFilter = customer ? { contains: customer } : undefined;
    const workOrderWhere: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      parentWorkOrderId: null,
      ...(customerFilter ? { customerName: customerFilter } : {}),
      OR: [
        { weekStartDate: { lt: end }, weekEndDate: { gte: start } },
        { plannedAt: { gte: start, lt: end } },
        { completedAt: { gte: start, lt: end } },
        { completedAt: null, planActive: true, plannedAt: { lt: end } },
        { productionPlanBatch: { is: { deletedAt: null, plannedCompletionDate: { gte: start, lt: end } } } },
      ],
    };
    const sampleWhere: Prisma.SampleTaskWhereInput = {
      deletedAt: null,
      ...(customerFilter ? { customerNameSnapshot: customerFilter } : {}),
      OR: [
        { dueDate: { gte: start, lt: end } },
        { createdAt: { gte: start, lt: end } },
        { completedAt: { gte: start, lt: end } },
        { status: { in: ['PLANNED', 'IN_PROGRESS', 'SUBMITTED'] }, dueDate: { lt: end } },
      ],
    };
    const batchWhere: Prisma.ProductionPlanBatchWhereInput = {
      deletedAt: null,
      releaseState: { not: 'cancelled' },
      plannedCompletionDate: { gte: start, lt: end },
      ...(customerFilter ? { planOrder: { customerName: customerFilter } } : {}),
    };
    const completionWhere: Prisma.ProcessCompletionWhereInput = {
      voidedAt: null,
      completedAt: { gte: start, lt: end },
      workOrder: {
        deletedAt: null,
        parentWorkOrderId: null,
        ...(customerFilter ? { customerName: customerFilter } : {}),
      },
    };

    const [workOrders, batches, completions, sampleTasks, workOrderCustomers, sampleCustomers] = await Promise.all([
      mode === 'sample' ? Promise.resolve([] as WorkOrderRecord[]) : prisma.workOrder.findMany({
        where: workOrderWhere,
        orderBy: [{ completedAt: 'asc' }, { plannedAt: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
        take: 1200,
        select: workOrderSelect,
      }),
      mode === 'sample' ? Promise.resolve([]) : prisma.productionPlanBatch.findMany({
        where: batchWhere,
        select: {
          id: true,
          workOrderId: true,
          quantity: true,
          plannedCompletionDate: true,
          planOrder: { select: { customerName: true } },
        },
        take: 2000,
      }),
      mode === 'sample' ? Promise.resolve([]) : prisma.processCompletion.findMany({
        where: completionWhere,
        select: {
          stepId: true,
          completedAt: true,
          goodQty: true,
          defectQty: true,
          step: {
            select: {
              route: {
                select: {
                  steps: {
                    where: { retiredAt: null },
                    select: { id: true, position: true },
                  },
                },
              },
            },
          },
        },
        take: 20_000,
      }),
      mode === 'mass' ? Promise.resolve([]) : loadSampleTasks(sampleWhere),
      prisma.workOrder.findMany({
        where: { deletedAt: null, customerName: { not: null } },
        distinct: ['customerName'],
        orderBy: { customerName: 'asc' },
        take: 300,
        select: { customerName: true },
      }),
      prisma.sampleTask.findMany({
        where: { deletedAt: null },
        distinct: ['customerNameSnapshot'],
        orderBy: { customerNameSnapshot: 'asc' },
        take: 300,
        select: { customerNameSnapshot: true },
      }),
    ]);

    const workOrderItems = workOrders.map(order => workOrderFocusItem(order, referenceAt));
    const sampleItems = sampleTasks.map(task => sampleFocusItem(task, referenceAt));
    const allFocusItems = [...workOrderItems, ...sampleItems].sort((left, right) =>
      riskRank(left) - riskRank(right)
      || String(left.dueAt || '9999').localeCompare(String(right.dueAt || '9999'))
      || left.code.localeCompare(right.code, 'zh-CN'));

    const dayKeys = reportRangeDayKeys(start, end);
    const trendMap = new Map(dayKeys.map(key => [key, { plannedQty: 0, completedQty: 0 }]));
    const batchWorkOrderIds = new Set<string>();
    for (const batch of batches) {
      if (batch.workOrderId) batchWorkOrderIds.add(batch.workOrderId);
      const key = reportDateKey(batch.plannedCompletionDate);
      const day = trendMap.get(key);
      if (day) day.plannedQty += Math.max(0, batch.quantity);
    }
    for (const order of workOrders) {
      if (batchWorkOrderIds.has(order.id)) continue;
      const planned = workOrderQuantity(order).planned || 0;
      if (planned <= 0) continue;
      const key = reportPlanningDateKey({ plannedAt: order.plannedAt, start, end });
      const day = trendMap.get(key);
      if (day) day.plannedQty += planned;
    }
    const finalCompletions = completions.filter(completion => {
      const finalStep = completion.step.route.steps.reduce<{ id: string; position: number } | null>(
        (latest, step) => !latest || step.position > latest.position ? step : latest,
        null,
      );
      return finalStep?.id === completion.stepId;
    });
    for (const completion of finalCompletions) {
      const day = trendMap.get(reportDateKey(completion.completedAt));
      if (day) day.completedQty += Math.max(0, completion.goodQty);
    }
    if (mode === 'sample') {
      for (const day of trendMap.values()) {
        day.plannedQty = 0;
        day.completedQty = 0;
      }
      for (const task of sampleTasks) {
        const plannedDate = task.dueDate || task.createdAt;
        const plannedDay = trendMap.get(reportDateKey(plannedDate));
        if (plannedDay) plannedDay.plannedQty += 1;
        if (task.completedAt) {
          const completedDay = trendMap.get(reportDateKey(task.completedAt));
          if (completedDay) completedDay.completedQty += 1;
        }
      }
    }

    const dailyTrend = dayKeys.map(key => ({
      date: key,
      label: reportDateLabel(key),
      plannedQty: trendMap.get(key)?.plannedQty || 0,
      completedQty: trendMap.get(key)?.completedQty || 0,
    }));
    const readinessRows = workOrders.map(workOrderReadiness);
    const missingRouteOrders = readinessRows.filter(item => !item.routeReady).length;
    const missingStandardOrders = readinessRows.filter(item => item.routeReady && !item.standardReady).length;
    const missingDrawingOrders = readinessRows.filter(item => !item.drawingReady).length;
    const materialRuleUnpublishedOrders = readinessRows.filter(item => !item.materialRulePublished).length;
    const processMap = new Map<string, {
      processCode: string;
      processName: string;
      pendingQty: number;
      workOrderIds: Set<string>;
      overdueWorkOrderIds: Set<string>;
    }>();
    for (const order of workOrders) {
      const focus = workOrderItems.find(item => item.id === order.id);
      for (const step of order.processRoute?.steps || []) {
        if (step.status === 'completed' || step.status === 'skipped') continue;
        const key = step.processCode || step.processName;
        const row = processMap.get(key) || {
          processCode: step.processCode,
          processName: step.processName,
          pendingQty: 0,
          workOrderIds: new Set<string>(),
          overdueWorkOrderIds: new Set<string>(),
        };
        const targetQty = Math.max(step.inputQty, workOrderQuantity(order).planned || 0);
        row.pendingQty += Math.max(0, targetQty - Math.max(0, step.goodOutputQty));
        row.workOrderIds.add(order.id);
        if (focus?.status === 'overdue') row.overdueWorkOrderIds.add(order.id);
        processMap.set(key, row);
      }
    }
    const processBottlenecks = [...processMap.values()]
      .map(item => ({
        processCode: item.processCode,
        processName: item.processName,
        pendingQty: item.pendingQty,
        workOrderCount: item.workOrderIds.size,
        overdueWorkOrderCount: item.overdueWorkOrderIds.size,
      }))
      .sort((left, right) => right.overdueWorkOrderCount - left.overdueWorkOrderCount
        || right.pendingQty - left.pendingQty
        || right.workOrderCount - left.workOrderCount)
      .slice(0, 6);

    const pendingSampleReviewItems = sampleTasks.filter(task => Boolean(task.activeSubmissionId)).length;
    const reviewedSampleItems = sampleTasks.reduce((sum, task) => sum
      + task.submissions.filter(submission => ['CONFIRMED', 'REJECTED'].includes(submission.status)).length, 0);
    const publishedSampleItems = sampleTasks.reduce((sum, task) => sum
      + task.entries.filter(entry => entry.reviewStatus === 'PUBLISHED').length
      + task.photos.filter(photo => photo.reviewStatus === 'PUBLISHED').length, 0);
    const activeSampleTasks = sampleTasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(task.status));
    const completedSampleTasks = sampleTasks.filter(task => task.status === 'COMPLETED');
    const overdueSampleTasks = activeSampleTasks.filter(task => Boolean(task.dueDate && task.dueDate < referenceAt));
    const sampleSummary = {
      taskCount: sampleTasks.length,
      activeCount: activeSampleTasks.length,
      completedCount: completedSampleTasks.length,
      taskAttainmentBasisPoints: reportBasisPoints(completedSampleTasks.length, sampleTasks.length),
      overdueCount: overdueSampleTasks.length,
      pendingReviewCount: pendingSampleReviewItems,
      publishedItemCount: publishedSampleItems,
      reviewedItemCount: reviewedSampleItems,
      reviewBasisPoints: reportBasisPoints(
        reviewedSampleItems,
        reviewedSampleItems + pendingSampleReviewItems,
      ),
    };
    const plannedQty = mode === 'sample'
      ? sampleTasks.length
      : dailyTrend.reduce((sum, day) => sum + day.plannedQty, 0);
    const completedQty = mode === 'sample'
      ? completedSampleTasks.length
      : finalCompletions.reduce((sum, completion) => sum + Math.max(0, completion.goodQty), 0);
    const completedOrders = allFocusItems.filter(item => item.status === 'completed').length;
    const activeOrders = allFocusItems.filter(item => item.status === 'in_progress' || item.status === 'review').length;
    const pendingOrders = allFocusItems.filter(item => item.status === 'pending').length;
    const overdueOrders = allFocusItems.filter(item => item.status === 'overdue' || (item.status === 'paused' && item.dueAt && new Date(item.dueAt) < referenceAt)).length;
    const dueSoonOrders = allFocusItems.filter(item => {
      if (!item.dueAt || item.status === 'completed' || item.status === 'overdue') return false;
      const days = Math.ceil((new Date(item.dueAt).getTime() - referenceAt.getTime()) / 86_400_000);
      return days >= 0 && days <= 2;
    }).length;
    const statusKeys: Array<{ key: ReportCenterFocusStatusDTO; label: string }> = [
      { key: 'completed', label: '已完成' },
      { key: 'in_progress', label: '进行中' },
      { key: 'review', label: '待审核' },
      { key: 'pending', label: '待开始' },
      { key: 'overdue', label: '已逾期' },
      { key: 'paused', label: '已暂停' },
    ];
    const statusDistribution = statusKeys.map(item => {
      const count = allFocusItems.filter(focus => focus.status === item.key).length;
      return {
        ...item,
        count,
        basisPoints: allFocusItems.length ? Math.round((count / allFocusItems.length) * 10_000) : 0,
      };
    });
    const processReportedGoodQty = completions.reduce((sum, completion) => sum + Math.max(0, completion.goodQty), 0);
    const processReportedDefectQty = completions.reduce((sum, completion) => sum + Math.max(0, completion.defectQty), 0);
    const customers = [...new Set([
      ...workOrderCustomers.map(item => item.customerName || '').filter(Boolean),
      ...sampleCustomers.map(item => item.customerNameSnapshot).filter(Boolean),
    ])].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const response: ReportCenterOverviewDTO = {
      period,
      date,
      mode,
      customer,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      generatedAt: new Date().toISOString(),
      customers,
      quantityScope: mode === 'sample'
        ? { label: '样品任务达成率', unitLabel: '项', note: '按样品任务完成归档统计；采集字段均为选填' }
        : { label: '数量达成率', unitLabel: '套', note: '计划优先取已下达批次，历史未完成工单并入周期首日；完成量只统计最终工序良品' },
      summary: {
        plannedQty,
        completedQty,
        completionBasisPoints: reportBasisPoints(completedQty, plannedQty),
        completedOrders,
        activeOrders,
        pendingOrders,
        overdueOrders,
        dueSoonOrders,
        processReportedGoodQty,
        processReportedDefectQty,
        processDefectBasisPoints: reportBasisPoints(
          processReportedDefectQty,
          processReportedGoodQty + processReportedDefectQty,
        ),
        dataCompletenessBasisPoints: mode === 'sample'
          ? sampleSummary.reviewBasisPoints
          : reportCompletenessBasisPoints(readinessRows),
        missingRouteOrders,
        missingStandardOrders,
        missingDrawingOrders,
        materialRuleUnpublishedOrders,
        pendingSampleReviewItems,
      },
      dailyTrend,
      statusDistribution,
      processBottlenecks,
      completeness: [
        { key: 'route', label: '未建立工艺路线', count: missingRouteOrders, note: '无法形成工序进度与最终工序口径', route: '/workspace/product-times' },
        { key: 'standard', label: '标准工时未补齐', count: missingStandardOrders, note: '仅统计需要计效且缺少标准的工单', route: '/workspace/product-times' },
        { key: 'drawing', label: '未关联当前图纸', count: missingDrawingOrders, note: '按图纸资料库当前版本判断', route: '/drawing-library' },
        { key: 'material', label: '未建立辅料规则', count: materialRuleUnpublishedOrders, note: '辅料记录仍为选填，不作为样品缺项', route: '/weekly-plan-center?branch=samples' },
        { key: 'sample_review', label: '样品资料待整包审核', count: pendingSampleReviewItems, note: '按产品提交包计数；空白采集字段不计缺项', route: '/weekly-plan-center?branch=samples' },
      ],
      sample: sampleSummary,
      focusItems: allFocusItems.slice(0, 120),
    };
    const result = NextResponse.json({ ok: true, report: response });
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('report center overview failed', error);
    return NextResponse.json({ ok: false, error: '报表中心总览加载失败' }, { status: 500 });
  }
}
