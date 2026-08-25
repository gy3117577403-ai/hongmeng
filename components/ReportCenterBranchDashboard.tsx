'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FileWarning,
  Gauge,
  Layers3,
  ListFilter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { populateBusinessReportWorkbook, type BusinessExcelKpi, type BusinessExcelValue } from '@/lib/business-excel';
import {
  REPORT_DOMAINS,
  hasFullReportAccess,
  reportBranch,
  reportDomain,
  reportRoute,
  type ReportBranchDefinition,
  type ReportBranchKey,
  type ReportDomainKey,
} from '@/lib/report-center-navigation';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeReportDTO,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
  ProcessLaborPoolDTO,
  ReportCenterFocusItemDTO,
  ReportCenterModeDTO,
  ReportCenterOverviewDTO,
  ReportCenterPeriodDTO,
  ReportCompletedBatchesDTO,
  ReportOperationsDTO,
  ReportOperationsEmployeeRowDTO,
  ReportOperationsLaborRowDTO,
} from '@/types';

type ApiResponse<T> = { ok: boolean; report?: T; error?: string };
type LaborResponse = { ok: boolean; pools?: ProcessLaborPoolDTO[]; error?: string };
type MetricTone = 'orange' | 'green' | 'blue' | 'red' | 'purple';

type MetricDefinition = {
  label: string;
  value: string;
  unit?: string;
  description: string;
  tone: MetricTone;
  stats: Array<{ label: string; value: string; note: string }>;
};

const OVERVIEW_BRANCHES = new Set<ReportBranchKey>([
  'quantity-attainment', 'order-status', 'production-trend', 'process-bottlenecks',
  'delivery-risk', 'due-soon', 'delivery-orders', 'completeness', 'missing-route', 'missing-standard',
  'missing-drawing', 'missing-material', 'sample-tasks', 'sample-attainment', 'pending-review', 'published-materials', 'review-attainment',
]);
const COMPLETED_BATCH_BRANCHES = new Set<ReportBranchKey>(['completed-orders']);
const OPERATIONS_BRANCHES = new Set<ReportBranchKey>([
  'weekly-plan-attainment', 'attendance-attainment', 'team-hours', 'employee-matrix',
]);
const EMPLOYEE_BRANCHES = new Set<ReportBranchKey>(['employee-attainment', 'unmatched-labor']);
const QUALITY_BRANCHES = new Set<ReportBranchKey>(['affected-labor', 'cause-distribution', 'open-events', 'event-ledger']);
const SEARCHABLE_BRANCHES = new Set<ReportBranchKey>([
  'completed-orders', 'order-status', 'delivery-risk', 'due-soon', 'delivery-orders',
  'employee-attainment', 'employee-matrix', 'unmatched-labor', 'open-events', 'event-ledger',
  'missing-route', 'missing-standard', 'missing-drawing', 'missing-material',
  'sample-tasks', 'sample-attainment', 'pending-review', 'published-materials',
]);
const TEAM_FILTER_BRANCHES = new Set<ReportBranchKey>(['team-hours', 'employee-matrix']);

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function numberText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

function percentText(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value / 100).toFixed(1)}%`;
}

function compactHours(milliseconds: number | null | undefined): string {
  const hours = Math.max(0, milliseconds || 0) / 3_600_000;
  return `${hours >= 100 ? Math.round(hours) : Number(hours.toFixed(1))}h`;
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function dateTimeText(value: string | null | undefined): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-');
}

function employeeExclusionText(value: EmployeeAttainmentRowDTO['days'][number]['exclusionReason']): string {
  if (value === 'leave') return '请假，不计达成';
  if (value === 'rest') return '休息，不计达成';
  if (value === 'absent') return '缺勤，无生产基数';
  if (value === 'missing_attendance') return '考勤草稿或缺失';
  if (value === 'zero_attendance') return '确认出勤为 0，待核对';
  if (value === 'excluded_stream') return '非量产统计口径';
  return '计入目标达成';
}

function rangeText(report: { rangeStart: string; rangeEnd: string } | null): string {
  if (!report) return '正在读取统计范围';
  const end = new Date(new Date(report.rangeEnd).getTime() - 1);
  return `${dateOnly(report.rangeStart)} 至 ${dateOnly(end.toISOString())}`;
}

async function downloadWorkbook(input: {
  name: string;
  title: string;
  subtitle: string;
  period: string;
  scope: string;
  generatedAt: string;
  method: string;
  kpis: BusinessExcelKpi[];
  rows: BusinessExcelValue[][];
}): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const [headers = [], ...body] = input.rows;
  populateBusinessReportWorkbook(workbook, {
    title: input.title,
    subtitle: input.subtitle,
    sheetName: input.title,
    period: input.period,
    scope: input.scope,
    generatedAt: input.generatedAt,
    method: input.method,
    headers: headers.map(value => String(value ?? '')),
    rows: body,
    kpis: input.kpis,
  });
  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  const url = URL.createObjectURL(new Blob([bytes as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = input.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeHref(item: ReportCenterFocusItemDTO): string {
  return item.entityType === 'workOrder'
    ? `/production?workOrderId=${encodeURIComponent(item.id)}`
    : '/weekly-plan-center?branch=samples';
}

function branchUsesSingleDate(branch: ReportBranchKey): boolean {
  return branch === 'labor-ledger';
}

function branchMethod(branch: ReportBranchKey): string {
  if (branch === 'completed-orders') {
    return '到期批次按计划完成日期入池；完成时点取最终工序累计非作废良品首次达到批次数量的时间，数量按批次封顶。';
  }
  if (['quantity-attainment', 'production-trend', 'weekly-plan-attainment'].includes(branch)) {
    return '成品数量只统计最终工序良品；中间工序数量仅用于瓶颈和质量分析。';
  }
  if (['attendance-attainment', 'team-hours', 'employee-attainment', 'employee-matrix', 'unmatched-labor'].includes(branch)) {
    return '净应出勤=排班+已确认实际加班-确认请假；实际出勤已含加班。草稿、缺失、未入职、整日请假和休息不进入员工目标达成基数。';
  }
  if (QUALITY_BRANCHES.has(branch)) {
    return '异常影响人时按事件分配人员汇总，品质确认与闭环状态分别统计。';
  }
  if (branch === 'completeness' || branch.startsWith('missing-')) {
    return '资料完整率核查工艺路线、标准工时、当前图纸与已发布辅料规则。';
  }
  if (['sample-tasks', 'sample-attainment', 'pending-review', 'published-materials', 'review-attainment'].includes(branch)) {
    return branch === 'sample-attainment'
      ? '样品达成按独立任务完成数 / 周期样品任务数计算，不计入量产员工标准工时效率。'
      : '样品采集数据只有经过分项审核并发布后，才计入正式产品资料。';
  }
  return '当前页面只呈现这一指标及其直接明细，避免跨主题数据混在同一屏。';
}

function branchIcon(domain: ReportDomainKey): ReactNode {
  if (domain === 'production') return <BarChart3 />;
  if (domain === 'delivery') return <CalendarRange />;
  if (domain === 'people') return <UsersRound />;
  if (domain === 'quality') return <AlertTriangle />;
  if (domain === 'governance') return <Database />;
  return <ClipboardCheck />;
}

function focusSearchText(item: ReportCenterFocusItemDTO): string {
  return `${item.code} ${item.customerName} ${item.productName} ${item.specification} ${item.owner || ''} ${item.currentProcess || ''} ${item.nextProcess || ''} ${item.missingData.join(' ')}`.toLocaleLowerCase('zh-CN');
}

function focusItemsForBranch(items: ReportCenterFocusItemDTO[], branch: ReportBranchKey): ReportCenterFocusItemDTO[] {
  const workOrders = items.filter(item => item.entityType === 'workOrder');
  const samples = items.filter(item => item.entityType === 'sampleTask');
  if (branch === 'completed-orders') return workOrders.filter(item => item.status === 'completed');
  if (branch === 'delivery-risk') return workOrders.filter(item => item.status === 'overdue');
  if (branch === 'due-soon') return workOrders.filter(item => item.dueSoon);
  if (branch === 'delivery-orders' || branch === 'order-status') return workOrders;
  if (branch === 'missing-route') return workOrders.filter(item => item.missingData.includes('未建立工艺路线'));
  if (branch === 'missing-standard') return workOrders.filter(item => item.missingData.includes('标准工时未补齐'));
  if (branch === 'missing-drawing') return workOrders.filter(item => item.missingData.includes('未关联当前图纸'));
  if (branch === 'missing-material') return workOrders.filter(item => item.missingData.includes('辅料规则未发布'));
  if (branch === 'sample-tasks' || branch === 'sample-attainment') return samples;
  if (branch === 'pending-review') return samples.filter(item => (item.pendingReviewCount || 0) > 0 || item.status === 'review');
  if (branch === 'published-materials') return samples.filter(item => (item.publishedItemCount || 0) > 0);
  return workOrders;
}

function claimRows(pools: ProcessLaborPoolDTO[]) {
  return pools.flatMap(pool => pool.claims.map(claim => ({ pool, claim })));
}

function metricForBranch(
  branch: ReportBranchKey,
  overview: ReportCenterOverviewDTO | null,
  completedBatches: ReportCompletedBatchesDTO | null,
  operations: ReportOperationsDTO | null,
  employees: EmployeeAttainmentReportDTO | null,
  abnormal: AbnormalTimeReportDTO | null,
  pools: ProcessLaborPoolDTO[],
  branchItems: ReportCenterFocusItemDTO[],
): MetricDefinition {
  const summary = overview?.summary;
  const batchSummary = completedBatches?.summary;
  const operationsSummary = operations?.summary;
  const employeeSummary = employees?.summary;
  const abnormalSummary = abnormal?.summary;
  const claims = claimRows(pools);
  const totalPending = (overview?.processBottlenecks || []).reduce((total, row) => total + row.pendingQty, 0);
  const common: Record<ReportBranchKey, MetricDefinition> = {
    'quantity-attainment': { label: '数量达成率', value: percentText(summary?.completionBasisPoints), description: '最终工序良品 / 计划数量', tone: 'orange', stats: [
      { label: '计划数量', value: numberText(summary?.plannedQty), note: overview?.quantityScope.unitLabel || '套' },
      { label: '最终良品', value: numberText(summary?.completedQty), note: '已封顶' },
      { label: '数量缺口', value: numberText(Math.max(0, (summary?.plannedQty || 0) - (summary?.completedQty || 0))), note: '待完成' },
    ] },
    'completed-orders': { label: '按期批次达成率', value: percentText(batchSummary?.onTimeAttainmentBasisPoints), description: '按期完成批次 / 所选周期到期批次', tone: 'green', stats: [
      { label: '到期批次', value: numberText(batchSummary?.dueBatches), note: '批' },
      { label: '完成批次', value: numberText(batchSummary?.completedBatches), note: percentText(batchSummary?.batchCompletionBasisPoints) },
      { label: '数量达成', value: percentText(batchSummary?.quantityAttainmentBasisPoints), note: `${numberText(batchSummary?.completedQuantity)} / ${numberText(batchSummary?.plannedQuantity)}` },
    ] },
    'order-status': { label: '工单总量', value: numberText((overview?.statusDistribution || []).reduce((t, row) => t + row.count, 0)), unit: '单', description: '当前筛选下的工单状态结构', tone: 'blue', stats: [
      { label: '完成', value: numberText(summary?.completedOrders), note: '单' },
      { label: '进行中', value: numberText(summary?.activeOrders), note: '单' },
      { label: '逾期', value: numberText(summary?.overdueOrders), note: '单' },
    ] },
    'production-trend': { label: '周期良品', value: numberText(summary?.completedQty), unit: overview?.quantityScope.unitLabel || '套', description: '逐日对比计划数量与最终良品', tone: 'blue', stats: [
      { label: '计划', value: numberText(summary?.plannedQty), note: '套' },
      { label: '达成率', value: percentText(summary?.completionBasisPoints), note: '最终工序口径' },
      { label: '统计天数', value: numberText(overview?.dailyTrend.length), note: '天' },
    ] },
    'weekly-plan-attainment': { label: '周计划达成率', value: percentText(operationsSummary?.batchCompletionBasisPoints), description: '已完成批次 / 已开始周计划批次', tone: 'orange', stats: [
      { label: '纳入计划批次', value: numberText(operationsSummary?.plannedBatches), note: `未来周 ${numberText(operationsSummary?.futureBatches)} 批` },
      { label: '完成批次', value: numberText(operationsSummary?.completedBatches), note: '批' },
      { label: '计划数量达成', value: percentText(operationsSummary?.quantityCompletionBasisPoints), note: `${numberText(operationsSummary?.completedQuantity)} / ${numberText(operationsSummary?.plannedQuantity)}` },
    ] },
    'process-bottlenecks': { label: '工序待处理量', value: numberText(totalPending), unit: '件', description: '瓶颈工序口径，不计入成品总量', tone: 'red', stats: [
      { label: '涉及工序', value: numberText(overview?.processBottlenecks.length), note: '道' },
      { label: '涉及工单', value: numberText((overview?.processBottlenecks || []).reduce((t, row) => t + row.workOrderCount, 0)), note: '单次' },
      { label: '逾期影响', value: numberText((overview?.processBottlenecks || []).reduce((t, row) => t + row.overdueWorkOrderCount, 0)), note: '单次' },
    ] },
    'delivery-risk': { label: '逾期工单', value: numberText(summary?.overdueOrders), unit: '单', description: '超过交期且尚未完成', tone: 'red', stats: [
      { label: '高风险', value: numberText(branchItems.filter(item => item.risk === 'high').length), note: '单' },
      { label: '进行中', value: numberText(branchItems.filter(item => item.status === 'in_progress').length), note: '单' },
      { label: '待开始', value: numberText(branchItems.filter(item => item.status === 'pending').length), note: '单' },
    ] },
    'due-soon': { label: '未来两天到期', value: numberText(summary?.dueSoonOrders), unit: '单', description: '需要提前处理的交付任务', tone: 'orange', stats: [
      { label: '已安排', value: numberText(branchItems.filter(item => item.owner).length), note: '单' },
      { label: '待安排', value: numberText(branchItems.filter(item => !item.owner).length), note: '单' },
      { label: '资料缺口', value: numberText(branchItems.filter(item => item.missingData.length > 0).length), note: '单' },
    ] },
    'delivery-orders': { label: '交付工单', value: numberText(branchItems.length), unit: '单', description: '按交期、状态与责任人查看', tone: 'blue', stats: [
      { label: '逾期', value: numberText(branchItems.filter(item => item.status === 'overdue').length), note: '单' },
      { label: '进行中', value: numberText(branchItems.filter(item => item.status === 'in_progress').length), note: '单' },
      { label: '完成', value: numberText(branchItems.filter(item => item.status === 'completed').length), note: '单' },
    ] },
    'attendance-attainment': { label: '全厂出勤得分', value: percentText(operationsSummary?.attendanceBasisPoints), description: '实际出勤 / 净应出勤，得分最高 100%', tone: 'blue', stats: [
      { label: '净应出勤', value: compactHours(operationsSummary?.netExpectedMilliseconds), note: '排班+实际加班-请假' },
      { label: '实际出勤', value: compactHours(operationsSummary?.attendanceMilliseconds), note: `超额 ${compactHours(operationsSummary?.extraAttendanceMilliseconds)}` },
      { label: '加班工时', value: compactHours(operationsSummary?.actualOvertimeMilliseconds), note: `请假扣减 ${compactHours(operationsSummary?.leaveDeductionMilliseconds)}` },
    ] },
    'team-hours': { label: '班组数量', value: numberText(operationsSummary?.teamCount), unit: '组', description: '按班组核对出勤与标准产出', tone: 'green', stats: [
      { label: '生产员工', value: numberText(operationsSummary?.employeeCount), note: '人' },
      { label: '标准产出', value: compactHours(operationsSummary?.standardLaborMilliseconds), note: '工时' },
      { label: '车间工时利用率', value: percentText(operationsSummary?.utilizationBasisPoints), note: '利用率' },
    ] },
    'employee-attainment': { label: '员工工时利用率', value: percentText(employeeSummary?.coverageBasisPoints), description: '生产实耗与免责异常覆盖的实际出勤占比', tone: 'blue', stats: [
      { label: '生产员工', value: numberText(employeeSummary?.employeeCount), note: '人' },
      { label: '目标达成率', value: percentText(employeeSummary?.attainmentBasisPoints), note: '加权汇总' },
      { label: '标准工时效率', value: percentText(employeeSummary?.processEfficiencyBasisPoints), note: '标准 / 实耗' },
    ] },
    'employee-matrix': { label: '矩阵员工', value: numberText(operations?.employeeMatrix.length), unit: '人', description: '员工 × 日期交叉达成状态', tone: 'purple', stats: [
      { label: '月均达成', value: percentText(operationsSummary?.attainmentBasisPoints), note: '车间' },
      { label: '确认考勤', value: numberText(operationsSummary?.confirmedAttendanceRecords), note: '条' },
      { label: '待匹配工时', value: compactHours(operationsSummary?.unmatchedStandardLaborMilliseconds), note: '工时' },
    ] },
    'labor-ledger': { label: '自动记工记录', value: numberText(claims.length), unit: '笔', description: '报工与员工标准工时映射', tone: 'green', stats: [
      { label: '工时池', value: numberText(pools.length), note: '个' },
      { label: '已认领数量', value: numberText(pools.reduce((t, pool) => t + pool.claimedQty, 0)), note: '件' },
      { label: '标准工时', value: compactHours(claims.reduce((t, row) => t + row.claim.standardLaborMilliseconds, 0)), note: '工时' },
    ] },
    'unmatched-labor': { label: '待匹配标准工时', value: compactHours(employeeSummary?.unmatchedStandardLaborMilliseconds), description: '有报工但缺少正式考勤匹配', tone: 'red', stats: [
      { label: '涉及员工', value: numberText((employees?.rows || []).filter(row => row.unmatchedStandardLaborMilliseconds > 0).length), note: '人' },
      { label: '缺考勤人日', value: numberText(employeeSummary?.attendanceMissingDays), note: '人日' },
      { label: '覆盖率', value: percentText(employeeSummary?.coverageBasisPoints), note: '记工覆盖' },
    ] },
    'affected-labor': { label: '异常影响人时', value: compactHours(abnormalSummary?.affectedPersonMilliseconds), description: '异常时长 × 受影响人员', tone: 'red', stats: [
      { label: '事件时长', value: compactHours(abnormalSummary?.incidentMilliseconds), note: '小时' },
      { label: '确认免责', value: compactHours(abnormalSummary?.confirmedExemptPersonMilliseconds), note: '人时' },
      { label: '异常事件', value: numberText(abnormalSummary?.eventCount), note: '条' },
    ] },
    'cause-distribution': { label: '异常类别', value: numberText(abnormal?.categories.length), unit: '类', description: '按原因拆解事件数和影响人时', tone: 'orange', stats: [
      { label: '事件总数', value: numberText(abnormalSummary?.eventCount), note: '条' },
      { label: '影响人时', value: compactHours(abnormalSummary?.affectedPersonMilliseconds), note: '小时' },
      { label: '已确认', value: numberText(abnormalSummary?.confirmedCount), note: '条' },
    ] },
    'open-events': { label: '未关闭异常', value: numberText(abnormalSummary?.openCount), unit: '条', description: '仍在处理中的质量异常事件', tone: 'red', stats: [
      { label: '待品质确认', value: numberText(abnormalSummary?.pendingCount), note: '条' },
      { label: '已确认', value: numberText(abnormalSummary?.confirmedCount), note: '条' },
      { label: '已驳回', value: numberText(abnormalSummary?.rejectedCount), note: '条' },
    ] },
    'event-ledger': { label: '异常事件', value: numberText(abnormalSummary?.eventCount), unit: '条', description: '品质确认与处理状态完整台账', tone: 'purple', stats: [
      { label: '未关闭', value: numberText(abnormalSummary?.openCount), note: '条' },
      { label: '影响人时', value: compactHours(abnormalSummary?.affectedPersonMilliseconds), note: '小时' },
      { label: '免责人时', value: compactHours(abnormalSummary?.confirmedExemptPersonMilliseconds), note: '小时' },
    ] },
    'completeness': { label: '资料完整率', value: percentText(summary?.dataCompletenessBasisPoints), description: '正式生产资料核心项完整程度', tone: 'purple', stats: [
      { label: '缺工艺路线', value: numberText(summary?.missingRouteOrders), note: '单' },
      { label: '缺标准工时', value: numberText(summary?.missingStandardOrders), note: '单' },
      { label: '缺当前图纸', value: numberText(summary?.missingDrawingOrders), note: '单' },
    ] },
    'missing-route': { label: '缺工艺路线', value: numberText(summary?.missingRouteOrders), unit: '单', description: '无法形成工序进度和最终工序口径', tone: 'red', stats: [
      { label: '高风险', value: numberText(branchItems.filter(item => item.risk === 'high').length), note: '单' },
      { label: '进行中', value: numberText(branchItems.filter(item => item.status === 'in_progress').length), note: '单' },
      { label: '待开始', value: numberText(branchItems.filter(item => item.status === 'pending').length), note: '单' },
    ] },
    'missing-standard': { label: '缺标准工时', value: numberText(summary?.missingStandardOrders), unit: '单', description: '无法纳入正式效率口径', tone: 'orange', stats: [
      { label: '资料完整率', value: percentText(summary?.dataCompletenessBasisPoints), note: '总览' },
      { label: '涉及进行中', value: numberText(branchItems.filter(item => item.status === 'in_progress').length), note: '单' },
      { label: '涉及逾期', value: numberText(branchItems.filter(item => item.status === 'overdue').length), note: '单' },
    ] },
    'missing-drawing': { label: '缺当前图纸', value: numberText(summary?.missingDrawingOrders), unit: '单', description: '产品未关联当前有效图纸', tone: 'orange', stats: [
      { label: '高风险', value: numberText(branchItems.filter(item => item.risk === 'high').length), note: '单' },
      { label: '已开工', value: numberText(branchItems.filter(item => item.startedAt).length), note: '单' },
      { label: '逾期', value: numberText(branchItems.filter(item => item.status === 'overdue').length), note: '单' },
    ] },
    'missing-material': { label: '缺辅料规则', value: numberText(summary?.materialRuleUnpublishedOrders), unit: '单', description: '产品尚未发布正式辅料规则', tone: 'orange', stats: [
      { label: '高风险', value: numberText(branchItems.filter(item => item.risk === 'high').length), note: '单' },
      { label: '进行中', value: numberText(branchItems.filter(item => item.status === 'in_progress').length), note: '单' },
      { label: '逾期', value: numberText(branchItems.filter(item => item.status === 'overdue').length), note: '单' },
    ] },
    'sample-tasks': { label: '样品任务', value: numberText(overview?.sample.taskCount), unit: '项', description: '采集数据、过程照片与任务进度', tone: 'blue', stats: [
      { label: '进行中', value: numberText(overview?.sample.activeCount), note: '项' },
      { label: '已完成', value: numberText(overview?.sample.completedCount), note: '项' },
      { label: '已逾期', value: numberText(overview?.sample.overdueCount), note: '项' },
    ] },
    'sample-attainment': { label: '样品任务达成率', value: percentText(overview?.sample.taskAttainmentBasisPoints), description: '完成样品任务 / 周期样品任务', tone: 'green', stats: [
      { label: '样品任务', value: numberText(overview?.sample.taskCount), note: '项' },
      { label: '已完成', value: numberText(overview?.sample.completedCount), note: '项' },
      { label: '已逾期', value: numberText(overview?.sample.overdueCount), note: '项' },
    ] },
    'pending-review': { label: '待分项审核', value: numberText(overview?.sample.pendingReviewCount), unit: '项', description: '提交后尚未成为正式产品资料', tone: 'red', stats: [
      { label: '涉及任务', value: numberText(branchItems.length), note: '个' },
      { label: '已审核', value: numberText(overview?.sample.reviewedItemCount), note: '项' },
      { label: '审核完成率', value: percentText(overview?.sample.reviewBasisPoints), note: '已审 / 已提交' },
    ] },
    'published-materials': { label: '已发布资料', value: numberText(overview?.sample.publishedItemCount), unit: '项', description: '已进入正式产品资料库', tone: 'green', stats: [
      { label: '涉及任务', value: numberText(branchItems.length), note: '个' },
      { label: '已审核', value: numberText(overview?.sample.reviewedItemCount), note: '项' },
      { label: '待审核', value: numberText(overview?.sample.pendingReviewCount), note: '项' },
    ] },
    'review-attainment': { label: '审核完成率', value: percentText(overview?.sample.reviewBasisPoints), description: '已审核项目 / 已提交项目', tone: 'purple', stats: [
      { label: '已审核', value: numberText(overview?.sample.reviewedItemCount), note: '项' },
      { label: '待审核', value: numberText(overview?.sample.pendingReviewCount), note: '项' },
      { label: '已发布', value: numberText(overview?.sample.publishedItemCount), note: '项' },
    ] },
  };
  return common[branch];
}

export default function ReportCenterBranchDashboard({
  user,
  initialDomain,
  initialBranch,
}: {
  user: CurrentUserDTO;
  initialDomain: ReportDomainKey;
  initialBranch: ReportBranchKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fullAccess = hasFullReportAccess(user.access.modules);
  const domain = reportDomain(initialDomain)!;
  const branch = reportBranch(initialDomain, initialBranch)!;
  const allowedDomains = fullAccess ? REPORT_DOMAINS : REPORT_DOMAINS.filter(item => item.key === 'people');
  const allowedBranches = fullAccess
    ? domain.branches
    : domain.branches.filter(item => item.key === 'unmatched-labor');

  const [period, setPeriod] = useState<ReportCenterPeriodDTO>(() => {
    const value = searchParams.get('period');
    if (initialDomain === 'production') {
      return value === 'week' || value === 'month' || value === 'custom' ? value : 'month';
    }
    return value === 'today' || value === 'month' || value === 'custom' ? value : searchParams.get('month') ? 'month' : 'week';
  });
  const [date, setDate] = useState(() => searchParams.get('date') || (searchParams.get('month') ? `${searchParams.get('month')}-15` : todayKey()));
  const [startDate, setStartDate] = useState(() => searchParams.get('startDate') || todayKey());
  const [endDate, setEndDate] = useState(() => searchParams.get('endDate') || todayKey());
  const [customer, setCustomer] = useState(() => searchParams.get('customer') || '');
  const [team, setTeam] = useState(() => searchParams.get('team') || '');
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword.trim());
  const [batchPage, setBatchPage] = useState(1);
  const [overview, setOverview] = useState<ReportCenterOverviewDTO | null>(null);
  const [completedBatches, setCompletedBatches] = useState<ReportCompletedBatchesDTO | null>(null);
  const [operations, setOperations] = useState<ReportOperationsDTO | null>(null);
  const [employees, setEmployees] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormal, setAbnormal] = useState<AbnormalTimeReportDTO | null>(null);
  const [laborPools, setLaborPools] = useState<ProcessLaborPoolDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedFocus, setSelectedFocus] = useState<ReportCenterFocusItemDTO | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAttainmentRowDTO | null>(null);
  const [toast, setToast] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  function replaceQuery(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      const rangeParams = new URLSearchParams({ period, date });
      if (period === 'custom') {
        rangeParams.set('startDate', startDate);
        rangeParams.set('endDate', endDate);
      }
      if (COMPLETED_BATCH_BRANCHES.has(initialBranch)) {
        const params = new URLSearchParams(rangeParams);
        params.set('page', String(batchPage));
        params.set('pageSize', '25');
        if (customer) params.set('customer', customer);
        if (deferredKeyword) params.set('keyword', deferredKeyword);
        const response = await fetch(`/api/reports/completed-batches?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<ReportCompletedBatchesDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '批次达成报表加载失败');
        setCompletedBatches(body.report);
      } else if (OVERVIEW_BRANCHES.has(initialBranch)) {
        const mode: ReportCenterModeDTO = initialDomain === 'sample' ? 'sample' : 'mass';
        const params = new URLSearchParams(rangeParams);
        params.set('mode', mode);
        if (customer) params.set('customer', customer);
        const response = await fetch(`/api/reports/overview?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<ReportCenterOverviewDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '业务报表加载失败');
        setOverview(body.report);
      } else if (OPERATIONS_BRANCHES.has(initialBranch)) {
        const response = await fetch(`/api/reports/operations?${rangeParams}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<ReportOperationsDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '月度生产报表加载失败');
        setOperations(body.report);
      } else if (EMPLOYEE_BRANCHES.has(initialBranch)) {
        const params = new URLSearchParams(rangeParams);
        const response = await fetch(`/api/reports/employee-attainment?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<EmployeeAttainmentReportDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '员工工时报表加载失败');
        setEmployees(body.report);
      } else if (QUALITY_BRANCHES.has(initialBranch)) {
        const params = new URLSearchParams(rangeParams);
        const response = await fetch(`/api/reports/abnormal-time?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<AbnormalTimeReportDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '质量异常报表加载失败');
        setAbnormal(body.report);
      } else if (initialBranch === 'labor-ledger') {
        const params = new URLSearchParams({ workDate: date, includeExhausted: 'true' });
        const response = await fetch(`/api/process-labor-pools?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as LaborResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || '自动记工台账加载失败');
        setLaborPools(body.pools || []);
      }
      setLoadedAt(new Date().toISOString());
    }
    load().catch(reason => {
      if ((reason as { name?: string }).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '报表加载失败');
      }
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [batchPage, customer, date, deferredKeyword, endDate, initialBranch, initialDomain, period, refreshToken, startDate]);

  useEffect(() => {
    setBatchPage(1);
  }, [customer, date, deferredKeyword, endDate, initialBranch, period, startDate]);

  useEffect(() => {
    if (!selectedFocus && !selectedEmployee) return undefined;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedFocus(null);
      setSelectedEmployee(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedEmployee, selectedFocus]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  const rawBranchItems = useMemo(() => focusItemsForBranch(overview?.focusItems || [], initialBranch), [initialBranch, overview?.focusItems]);
  const branchItems = useMemo(() => normalizedKeyword
    ? rawBranchItems.filter(item => focusSearchText(item).includes(normalizedKeyword))
    : rawBranchItems, [normalizedKeyword, rawBranchItems]);
  const employeeRows = useMemo(() => {
    const rows = employees?.rows || [];
    return rows.filter(row => (!normalizedKeyword || `${row.employee.employeeNo} ${row.employee.name} ${row.employee.department || ''} ${row.employee.team || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))
      && (initialBranch !== 'unmatched-labor' || row.unmatchedStandardLaborMilliseconds > 0));
  }, [employees?.rows, initialBranch, normalizedKeyword]);
  const operationRows = useMemo(() => (operations?.employeeMatrix || []).filter(row => (
    initialBranch !== 'employee-matrix'
      || (row.attainmentEligible && row.attainmentStream === 'batch' && row.attainmentFactorBasisPoints > 0)
  ) && (!team || row.team === team)
    && (!normalizedKeyword || `${row.employee.employeeNo} ${row.employee.name} ${row.team} ${row.position}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))), [initialBranch, normalizedKeyword, operations?.employeeMatrix, team]);
  const teamRows = useMemo(() => (operations?.teamMonthly || []).filter(row => !team || row.team === team), [operations?.teamMonthly, team]);
  const qualityEvents = useMemo(() => (abnormal?.events || []).filter(event => (!normalizedKeyword || `${event.sequence} ${event.categoryLabel} ${event.title} ${event.reason || ''} ${event.responsibilityDepartment || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))
    && (initialBranch !== 'open-events' || event.resolutionStatus === 'open')), [abnormal?.events, initialBranch, normalizedKeyword]);
  const teams = operations?.teamMonthly.map(item => item.team) || [];
  const baseMetric = metricForBranch(initialBranch, overview, completedBatches, operations, employees, abnormal, laborPools, rawBranchItems);
  const metric = initialBranch === 'employee-matrix'
    ? { ...baseMetric, value: numberText(operationRows.length) }
    : baseMetric;
  const activeRange = completedBatches || overview || operations || employees || abnormal;

  function branchHref(targetDomain: ReportDomainKey, target: ReportBranchDefinition): string {
    const query = new URLSearchParams(searchParams.toString());
    query.delete('customer');
    query.delete('team');
    const suffix = query.toString();
    return `${reportRoute(targetDomain, target.key)}${suffix ? `?${suffix}` : ''}`;
  }

  async function exportBranch(): Promise<void> {
    const stamp = period === 'custom' ? `${startDate}_${endDate}` : `${date}-${period}`;
    let rows: unknown[][] = [];
    if (initialBranch === 'quantity-attainment' || initialBranch === 'production-trend') {
      rows = [
        ['日期', '计划数量', '最终工序良品', '数量缺口', '数量达成率'],
        ...(overview?.dailyTrend || []).map(row => [row.date, row.plannedQty, row.completedQty, Math.max(0, row.plannedQty - row.completedQty), percentText(row.plannedQty > 0 ? Math.round(row.completedQty / row.plannedQty * 10_000) : null)]),
      ];
    } else if (initialBranch === 'order-status') {
      rows = [
        ['状态', '工单数量', '占比'],
        ...(overview?.statusDistribution || []).map(row => [row.label, row.count, percentText(row.basisPoints)]),
      ];
    } else if (initialBranch === 'process-bottlenecks') {
      rows = [
        ['工序编码', '工序名称', '待处理数量', '涉及工单', '逾期影响工单'],
        ...(overview?.processBottlenecks || []).map(row => [row.processCode, row.processName, row.pendingQty, row.workOrderCount, row.overdueWorkOrderCount]),
      ];
    } else if (initialBranch === 'completeness') {
      rows = [
        ['资料项', '缺口数量', '检查说明', '处理入口'],
        ...(overview?.completeness || []).map(row => [row.label, row.count, row.note, row.route]),
      ];
    } else if (initialBranch === 'sample-attainment') {
      rows = [
        ['统计口径', '样品任务', '已完成', '进行中', '已逾期', '任务达成率'],
        ['独立样品任务', overview?.sample.taskCount || 0, overview?.sample.completedCount || 0, overview?.sample.activeCount || 0, overview?.sample.overdueCount || 0, percentText(overview?.sample.taskAttainmentBasisPoints)],
      ];
    } else if (initialBranch === 'review-attainment') {
      rows = [
        ['样品任务', '进行中', '已完成', '已逾期', '待分项审核', '已审核', '已发布', '审核完成率'],
        [overview?.sample.taskCount || 0, overview?.sample.activeCount || 0, overview?.sample.completedCount || 0, overview?.sample.overdueCount || 0, overview?.sample.pendingReviewCount || 0, overview?.sample.reviewedItemCount || 0, overview?.sample.publishedItemCount || 0, percentText(overview?.sample.reviewBasisPoints)],
      ];
    } else if (initialBranch === 'completed-orders') {
      const params = new URLSearchParams({ period, date, all: 'true' });
      if (period === 'custom') {
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      }
      if (customer) params.set('customer', customer);
      if (deferredKeyword) params.set('keyword', deferredKeyword);
      const response = await fetch(`/api/reports/completed-batches?${params}`, { cache: 'no-store' });
      const body = await response.json() as ApiResponse<ReportCompletedBatchesDTO>;
      if (!response.ok || !body.report) {
        setToast(body.error || '批次达成明细导出失败');
        return;
      }
      rows = [
        ['订单行/批次', '工单', '客户', '产品', '规格', '计划数量', '最终良品', '数量达成', '计划完成日', '实际达成时间', '状态', '是否逾期', '当前工序', '责任人', '下发状态'],
        ...body.report.rows.map(row => [row.batchLabel, row.workOrderCode || '', row.customerName, row.productName, row.specification, row.quantity, row.completedQuantity, percentText(row.quantityBasisPoints), dateOnly(row.plannedCompletionDate), dateTimeText(row.actualCompletionAt), row.statusLabel, row.overdue ? '是' : '否', row.currentProcess || '', row.owner || '', row.releaseState]),
      ];
    } else if (OVERVIEW_BRANCHES.has(initialBranch)) {
      rows = [
        ['任务/工单', '客户', '产品', '规格', '计划数量', '完成数量', '状态', '当前环节', '责任人', '交期', '风险', '资料缺口'],
        ...branchItems.map(item => [item.code, item.customerName, item.productName, item.specification, item.plannedQty ?? '', item.completedQty ?? '', item.statusLabel, item.currentProcess || '', item.owner || '', dateOnly(item.dueAt), item.riskLabel, item.missingData.join('；')]),
      ];
    } else if (initialBranch === 'weekly-plan-attainment') {
      rows = [
        ['周次', '日期范围', '排定批次', '计划批次', '未来周批次', '完成批次', '周计划达成率', '计划数量', '完成数量', '数量达成率'],
        ...(operations?.weeklyPlan || []).map(row => [row.label, `${row.startDate} 至 ${row.endDate}`, row.scheduledBatches, row.plannedBatches, row.futureBatches, row.completedBatches, percentText(row.batchCompletionBasisPoints), row.plannedQuantity, row.completedQuantity, percentText(row.quantityCompletionBasisPoints)]),
      ];
    } else if (initialBranch === 'attendance-attainment') {
      rows = [
        ['日期', '排班人数', '计入基数人数', '实到人数', '整日请假', '部分/整日请假', '缺勤', '休息', '正式记录', '排班工时', '实际加班', '请假扣减', '净应出勤', '实际出勤', '超额出勤', '原始工时率', '出勤得分', '人数出勤率'],
        ...(operations?.dailyAttendance || []).map(row => [row.date, row.scheduledPeople, row.plannedPeople, row.attendancePeople, row.fullLeavePeople, row.leavePeople, row.absentPeople, row.restPeople, row.confirmedRecords, compactHours(row.scheduledMilliseconds), compactHours(row.actualOvertimeMilliseconds), compactHours(row.leaveDeductionMilliseconds), compactHours(row.netExpectedMilliseconds), compactHours(row.attendanceMilliseconds), compactHours(row.extraAttendanceMilliseconds), percentText(row.attendanceRawBasisPoints), percentText(row.hoursBasisPoints), percentText(row.attendanceBasisPoints)]),
      ];
    } else if (initialBranch === 'team-hours') {
      rows = [
        ['班组', '员工数', '出勤人数', '正式考勤', '净应出勤', '实际出勤', '认可加班', '请假扣减', '生产实耗', '标准工时', '免责异常', '未解释工时', '出勤得分', '工时利用率', '标准工时效率', '目标达成率'],
        ...teamRows.map(row => [row.team, row.employeeCount, row.attendancePeople, row.confirmedRecords, compactHours(row.netExpectedMilliseconds), compactHours(row.attendanceMilliseconds), compactHours(row.recognizedOvertimeMilliseconds), compactHours(row.leaveDeductionMilliseconds), compactHours(row.actualLaborMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.exemptAbnormalMilliseconds), compactHours(row.unexplainedMilliseconds), percentText(row.attendanceBasisPoints), percentText(row.utilizationBasisPoints), percentText(row.efficiencyBasisPoints), percentText(row.attainmentBasisPoints)]),
      ];
    } else if (initialBranch === 'employee-matrix') {
      rows = [
        ['班组', '员工编号', '员工', '统计资格', '净应出勤', '实际出勤', '生产实耗', '标准工时', '待匹配工时', '工时利用率', '标准效率', '目标达成率'],
        ...operationRows.map(row => [row.team, row.employee.employeeNo, row.employee.name, row.attainmentEligible ? '计入达成率' : '仅考勤，不计达成率', compactHours(row.netExpectedMilliseconds), compactHours(row.attendanceMilliseconds), compactHours(row.actualLaborMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.unmatchedStandardLaborMilliseconds), percentText(row.utilizationBasisPoints), percentText(row.efficiencyBasisPoints), percentText(row.attainmentBasisPoints)]),
      ];
    } else if (initialBranch === 'employee-attainment') {
      rows = [
        ['日期', '员工编号', '姓名', '班组', '考勤状态', '排班工时', '认可加班', '请假扣减', '净应出勤', '实际出勤', '超额出勤', '生产实耗', '标准工时', '免责异常', '工时利用率', '标准工时效率', '目标达成率', '是否计入', '剔除原因'],
        ...employeeRows.flatMap(row => row.days.map(day => [day.date, row.employee.employeeNo, row.employee.name, row.employee.team || '', day.attendanceStatus, compactHours(day.scheduledMilliseconds), compactHours(day.recognizedOvertimeMilliseconds), compactHours(day.leaveDeductionMilliseconds), compactHours(day.netExpectedMilliseconds), compactHours(day.attendanceMilliseconds), compactHours(day.extraAttendanceMilliseconds), compactHours(day.actualLaborMilliseconds), compactHours(day.standardLaborMilliseconds), compactHours(day.exemptAbnormalMilliseconds), percentText(day.utilizationBasisPoints), percentText(day.efficiencyBasisPoints), percentText(day.targetAttainmentBasisPoints), day.includedInAttainment ? '是' : '否', employeeExclusionText(day.exclusionReason)])),
      ];
    } else if (initialBranch === 'unmatched-labor') {
      rows = [
        ['员工编号', '姓名', '班组', '确认出勤', '标准工时', '待匹配工时', '缺失人日', '报工记录'],
        ...employeeRows.map(row => [row.employee.employeeNo, row.employee.name, row.employee.team || '', compactHours(row.attendanceMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.unmatchedStandardLaborMilliseconds), row.attendanceMissingDays, row.claimCount + row.executionCount]),
      ];
    } else if (initialBranch === 'affected-labor' || initialBranch === 'cause-distribution') {
      rows = [
        ['异常类别', '事件数量', '事件时长', '影响人时', '已审批人时'],
        ...(abnormal?.categories || []).map(row => [row.categoryLabel, row.eventCount, compactHours(row.incidentMilliseconds), compactHours(row.affectedPersonMilliseconds), compactHours(row.approvedPersonMilliseconds)]),
      ];
    } else if (QUALITY_BRANCHES.has(initialBranch)) {
      rows = [
        ['序号', '类别', '标题', '事件时长', '影响人时', '品质状态', '处理状态', '责任部门'],
        ...qualityEvents.map(event => [event.sequence, event.categoryLabel, event.title, compactHours(event.durationMilliseconds), compactHours(event.affectedPersonMilliseconds), event.qualityStatus, event.resolutionStatus, event.responsibilityDepartment || '']),
      ];
    } else if (initialBranch === 'labor-ledger') {
      rows = [
        ['工单', '工序', '员工', '数量', '单位', '标准工时', '记工时间'],
        ...claimRows(laborPools).map(({ pool, claim }) => [pool.workOrder.code, pool.step.processName, claim.employee.name, claim.quantity, pool.unitLabel, compactHours(claim.standardLaborMilliseconds), dateTimeText(claim.claimedAt)]),
      ];
    }
    const scopeText = [customer ? `客户=${customer}` : '', team ? `班组=${team}` : '', keyword ? `搜索=${keyword}` : ''].filter(Boolean).join('；') || '当前权限范围';
    await downloadWorkbook({
      name: `${branch.label}-${stamp}.xlsx`,
      title: `${branch.label}业务报表`,
      subtitle: `${domain.label} / ${branch.label} · 一个指标一个分支`,
      period: branchUsesSingleDate(initialBranch) ? date : rangeText(activeRange),
      scope: scopeText,
      generatedAt: dateTimeText(new Date().toISOString()),
      method: branchMethod(initialBranch),
      kpis: [
        { icon: '核', label: metric.label, value: metric.value, unit: metric.unit, note: metric.description, tone: metric.tone },
        ...metric.stats.slice(0, 3).map((item, index) => ({
          icon: ['量', '进', '险'][index],
          label: item.label,
          value: item.value,
          note: item.note,
          tone: (index === 0 ? 'green' : index === 1 ? 'blue' : 'red') as 'green' | 'blue' | 'red',
        })),
      ],
      rows: rows as BusinessExcelValue[][],
    });
    setToast('已导出单页业务报表：核心指标、当前分支明细和统计说明在同一工作表');
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return <main className="report-center-branch-workbench hm-workbench-root hm-cockpit-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/reports"
      subtitle="独立指标分支与业务明细"
      hideHeader
      sidebarTriggerTargetId="report-branch-navigation-trigger"
      menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => void logout() }]}
    />
    <div className="report-branch-frame">
      <section className="report-domain-bar" aria-label="报表业务域">
        <span id="report-branch-navigation-trigger" className="report-branch-nav-trigger" />
        <div className="report-domain-brand"><BarChart3 /><span><small>数据决策</small><strong>报表中心</strong></span></div>
        <nav>{allowedDomains.map(item => <Link className={item.key === initialDomain ? 'active' : ''} href={branchHref(item.key, item.branches[0])} key={item.key}><strong>{item.label}</strong><small>{item.caption}</small></Link>)}</nav>
        <div className="report-domain-source"><Database /><span><strong>真实业务数据</strong><small>一个指标一个分支</small></span></div>
      </section>

      <section className="report-branch-header">
        <div className={`report-branch-heading tone-${metric.tone}`}><span>{branchIcon(initialDomain)}</span><div><small>{domain.label} / {domain.caption}</small><h1>{branch.label}</h1><p>{branch.description}</p></div></div>
        <div className="report-branch-controls">
          {branchUsesSingleDate(initialBranch) ? <label><CalendarDays /><input type="date" value={date} onChange={event => { setDate(event.target.value); replaceQuery({ date: event.target.value }); }} aria-label="记工日期" /></label>
            : <div className="report-period-switch" role="group" aria-label="统计周期">{((initialDomain === 'production' ? [['week', '本周'], ['month', '本月'], ['custom', '自定义']] : [['today', '今日'], ['week', '本周'], ['month', '本月'], ['custom', '自定义']]) as Array<[ReportCenterPeriodDTO, string]>).map(([key, label]) => <button className={period === key ? 'active' : ''} type="button" key={key} onClick={() => { setPeriod(key); replaceQuery({ period: key }); }}>{label}</button>)}{period === 'custom' ? <span className="report-custom-range"><label><CalendarDays /><input type="date" value={startDate} max={endDate} onChange={event => { setStartDate(event.target.value); replaceQuery({ startDate: event.target.value }); }} aria-label="开始日期" /></label><i>至</i><label><CalendarRange /><input type="date" value={endDate} min={startDate} onChange={event => { setEndDate(event.target.value); replaceQuery({ endDate: event.target.value }); }} aria-label="结束日期" /></label></span> : <label><CalendarDays /><input type="date" value={date} onChange={event => { setDate(event.target.value); replaceQuery({ date: event.target.value }); }} aria-label="基准日期" /></label>}</div>}
          {(OVERVIEW_BRANCHES.has(initialBranch) || COMPLETED_BATCH_BRANCHES.has(initialBranch)) && <label><Layers3 /><select value={customer} onChange={event => { setCustomer(event.target.value); replaceQuery({ customer: event.target.value || null }); }} aria-label="客户筛选"><option value="">全部客户</option>{(completedBatches?.customers || overview?.customers || []).map(item => <option value={item} key={item}>{item}</option>)}</select></label>}
          {TEAM_FILTER_BRANCHES.has(initialBranch) && <label><UsersRound /><select value={team} onChange={event => { setTeam(event.target.value); replaceQuery({ team: event.target.value || null }); }} aria-label="班组筛选"><option value="">全部班组</option>{teams.map(item => <option value={item} key={item}>{item}</option>)}</select></label>}
          <button className="icon" type="button" title="刷新数据" aria-label="刷新数据" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} /></button>
          <button type="button" onClick={() => void exportBranch()}><Download />导出 Excel</button>
        </div>
        <nav className="report-branch-tabs" aria-label={`${domain.label}分支`}>{allowedBranches.map(item => <Link className={item.key === initialBranch ? 'active' : ''} href={branchHref(initialDomain, item)} key={item.key}>{item.shortLabel}</Link>)}</nav>
        <div className="report-branch-context"><span><CalendarRange />{branchUsesSingleDate(initialBranch) ? `${date} 单日口径` : rangeText(activeRange)}</span><span><ShieldCheck />{branchMethod(initialBranch)}</span></div>
      </section>

      {initialBranch !== 'attendance-attainment' && <section className="report-topic-toolbar">
        {SEARCHABLE_BRANCHES.has(initialBranch)
          ? <label><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={initialDomain === 'people' ? '搜索员工、工号、班组或岗位' : initialDomain === 'quality' ? '搜索异常标题、原因或责任部门' : '搜索工单、客户、产品、工序或资料缺口'} aria-label="搜索当前分支" /></label>
          : <p className="report-topic-insight"><Activity /><span><small>当前分析</small><strong>{branch.description}</strong></span></p>}
        <div><ListFilter /><span>{domain.label}</span><ChevronRight /><strong>{branch.label}</strong></div>
        <em>{loading ? '正在刷新' : `更新于 ${dateTimeText(completedBatches?.generatedAt || overview?.generatedAt || operations?.generatedAt || loadedAt || null)}`}</em>
      </section>}

      <MetricHero metric={metric} />

      <section className="report-branch-body" aria-busy={loading}>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={() => setRefreshToken(value => value + 1)} />}
        {!loading && !error && <BranchContent
          branch={initialBranch}
          overview={overview}
          completedBatches={completedBatches}
          operations={operations}
          employees={employees}
          abnormal={abnormal}
          laborPools={laborPools}
          focusItems={branchItems}
          employeeRows={employeeRows}
          operationRows={operationRows}
          teamRows={teamRows}
          qualityEvents={qualityEvents}
          onFocus={setSelectedFocus}
          onEmployee={setSelectedEmployee}
          onBatchPage={setBatchPage}
        />}
      </section>
      {toast && <div className="report-branch-toast" role="status"><CheckCircle2 />{toast}</div>}
    </div>
    {selectedFocus && <FocusDrawer item={selectedFocus} onClose={() => setSelectedFocus(null)} />}
    {selectedEmployee && <EmployeeDrawer row={selectedEmployee} onClose={() => setSelectedEmployee(null)} />}
  </main>;
}

function MetricHero({ metric }: { metric: MetricDefinition }) {
  return <section className={`report-metric-hero tone-${metric.tone}`}>
    <div className="report-metric-primary"><span><Gauge /></span><div><small>{metric.label}</small><strong>{metric.value}<em>{metric.unit}</em></strong><p>{metric.description}</p></div></div>
    <div className="report-metric-stats">{metric.stats.map(stat => <article key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong><span>{stat.note}</span></article>)}</div>
  </section>;
}

function BranchContent(props: {
  branch: ReportBranchKey;
  overview: ReportCenterOverviewDTO | null;
  completedBatches: ReportCompletedBatchesDTO | null;
  operations: ReportOperationsDTO | null;
  employees: EmployeeAttainmentReportDTO | null;
  abnormal: AbnormalTimeReportDTO | null;
  laborPools: ProcessLaborPoolDTO[];
  focusItems: ReportCenterFocusItemDTO[];
  employeeRows: EmployeeAttainmentRowDTO[];
  operationRows: ReportOperationsEmployeeRowDTO[];
  teamRows: ReportOperationsLaborRowDTO[];
  qualityEvents: AbnormalTimeReportDTO['events'];
  onFocus: (item: ReportCenterFocusItemDTO) => void;
  onEmployee: (item: EmployeeAttainmentRowDTO) => void;
  onBatchPage: (page: number) => void;
}) {
  const { branch, overview, completedBatches, operations, abnormal, laborPools, focusItems, employeeRows, operationRows, teamRows, qualityEvents, onFocus, onEmployee, onBatchPage } = props;
  if (branch === 'quantity-attainment' || branch === 'production-trend') return <TrendPanel report={overview} />;
  if (branch === 'completed-orders') return <CompletedBatchTable report={completedBatches} onPage={onBatchPage} />;
  if (branch === 'order-status') return <><StatusDistribution report={overview} /><FocusTable title="状态对应工单" items={focusItems} onSelect={onFocus} /></>;
  if (branch === 'weekly-plan-attainment') return <WeeklyPlan report={operations} />;
  if (branch === 'process-bottlenecks') return <BottleneckTable report={overview} />;
  if (branch === 'delivery-risk' || branch === 'due-soon' || branch === 'delivery-orders') return <FocusTable title={branch === 'delivery-risk' ? '逾期交付工单' : branch === 'due-soon' ? '即将到期工单' : '交付工单明细'} items={focusItems} onSelect={onFocus} />;
  if (branch === 'attendance-attainment') return <AttendancePanel report={operations} />;
  if (branch === 'team-hours') return <TeamHoursTable rows={teamRows} />;
  if (branch === 'employee-attainment' || branch === 'unmatched-labor') return <EmployeeTable rows={employeeRows} unmatchedOnly={branch === 'unmatched-labor'} onSelect={onEmployee} />;
  if (branch === 'employee-matrix') return <EmployeeMatrix report={operations} rows={operationRows} />;
  if (branch === 'labor-ledger') return <LaborLedger pools={laborPools} />;
  if (branch === 'affected-labor') return <AffectedLabor report={abnormal} />;
  if (branch === 'cause-distribution') return <CauseDistribution report={abnormal} />;
  if (branch === 'open-events' || branch === 'event-ledger') return <AbnormalLedger events={qualityEvents} />;
  if (branch === 'completeness') return <GovernanceOverview report={overview} />;
  if (branch.startsWith('missing-')) return <FocusTable title="资料缺口工单" items={focusItems} onSelect={onFocus} />;
  if (branch === 'sample-attainment') return <><SampleTaskAttainment report={overview} /><FocusTable title="样品任务达成明细" items={focusItems} onSelect={onFocus} /></>;
  if (branch === 'review-attainment') return <SampleReview report={overview} />;
  return <FocusTable title={branch === 'pending-review' ? '待分项审核任务' : branch === 'published-materials' ? '已发布资料任务' : '样品任务明细'} items={focusItems} onSelect={onFocus} />;
}

function Panel({ kicker, title, action, children }: { kicker: string; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="report-data-panel"><header><div><small>{kicker}</small><h2>{title}</h2></div>{action && <aside>{action}</aside>}</header>{children}</section>;
}

function TrendPanel({ report }: { report: ReportCenterOverviewDTO | null }) {
  const rows = report?.dailyTrend || [];
  const max = Math.max(1, ...rows.flatMap(row => [row.plannedQty, row.completedQty]));
  return <Panel kicker="逐日趋势" title="计划数量与最终工序良品" action={<span className="report-legend"><i className="planned" />计划<i className="completed" />最终良品</span>}>
    <div className={`report-trend-chart ${rows.length > 14 ? 'long-range' : ''}`}>{rows.map(row => <article key={row.date} title={`${row.date}：计划 ${numberText(row.plannedQty)}，完成 ${numberText(row.completedQty)}`}><div><i className="planned" style={{ height: `${Math.max(2, row.plannedQty / max * 100)}%` }} /><i className="completed" style={{ height: `${Math.max(2, row.completedQty / max * 100)}%` }} /></div><strong>{row.label}</strong><span>{percentText(row.plannedQty > 0 ? Math.round(row.completedQty / row.plannedQty * 10_000) : null)}</span></article>)}</div>
    <div className="report-trend-ledger"><div><span>日期</span><span>计划数量</span><span>最终良品</span><span>数量缺口</span><span>达成率</span></div>{rows.map(row => <article key={row.date}><span><strong>{row.date}</strong></span><span>{numberText(row.plannedQty)}</span><span>{numberText(row.completedQty)}</span><span>{numberText(Math.max(0, row.plannedQty - row.completedQty))}</span><span><b>{percentText(row.plannedQty > 0 ? Math.round(row.completedQty / row.plannedQty * 10_000) : null)}</b></span></article>)}</div>
    {!rows.length && <EmptyState icon={<BarChart3 />} title="当前周期没有生产数量记录" />}
  </Panel>;
}

function StatusDistribution({ report }: { report: ReportCenterOverviewDTO | null }) {
  const rows = report?.statusDistribution || [];
  return <Panel kicker="状态结构" title="工单状态分布"><div className="report-status-distribution">{rows.map(row => <article key={row.key}><span className={`status-${row.key}`}><i /></span><div><small>{row.label}</small><strong>{numberText(row.count)}<em>单</em></strong><p>{percentText(row.basisPoints)}</p></div><i><b style={{ width: `${Math.min(100, row.basisPoints / 100)}%` }} /></i></article>)}</div></Panel>;
}

function BottleneckTable({ report }: { report: ReportCenterOverviewDTO | null }) {
  const rows = report?.processBottlenecks || [];
  const max = Math.max(1, ...rows.map(row => row.pendingQty));
  return <Panel kicker="工序负荷" title="待处理量最高工序" action={<span>按待处理数量降序</span>}><div className="report-bottleneck-table"><div><span>工序</span><span>待处理量</span><span>涉及工单</span><span>逾期影响</span><span>相对负荷</span></div>{rows.map((row, index) => <article key={row.processCode}><span><em>{index + 1}</em><strong>{row.processName}</strong><small>{row.processCode}</small></span><span><b>{numberText(row.pendingQty)}</b></span><span>{numberText(row.workOrderCount)} 单</span><span className={row.overdueWorkOrderCount ? 'danger' : ''}>{numberText(row.overdueWorkOrderCount)} 单</span><span><i><b style={{ width: `${row.pendingQty / max * 100}%` }} /></i></span></article>)}</div>{!rows.length && <EmptyState icon={<Workflow />} title="当前周期没有待处理工序" />}</Panel>;
}

function WeeklyPlan({ report }: { report: ReportOperationsDTO | null }) {
  const rows = report?.weeklyPlan || [];
  return <Panel kicker="周次拆解" title={`${rangeText(report)} 周计划达成率`} action={<span>生产周口径 · 当前周提前完成立即计入</span>}><div className="report-week-grid">{rows.map(row => <article key={row.key}><header><div><small>{row.startDate.slice(5)}—{row.endDate.slice(5)}</small><h3>{row.label}</h3></div><strong>{percentText(row.batchCompletionBasisPoints)}</strong></header><dl><div><dt>计划批次</dt><dd>{row.completedBatches}<em> / {row.plannedBatches}</em></dd><i><b style={{ width: `${Math.min(100, (row.batchCompletionBasisPoints || 0) / 100)}%` }} /></i></div><div><dt>计划数量</dt><dd>{numberText(row.completedQuantity)}<em> / {numberText(row.plannedQuantity)}</em></dd><i><b style={{ width: `${Math.min(100, (row.quantityCompletionBasisPoints || 0) / 100)}%` }} /></i></div></dl>{row.isFutureWeek && row.futureBatches > 0 && <p>未来周：{row.futureBatches} 批 · {numberText(row.futureQuantity)}</p>}</article>)}</div>{!rows.length && <EmptyState icon={<CalendarRange />} title="当前周期没有周计划数据" />}</Panel>;
}

function CompletedBatchTable({ report, onPage }: { report: ReportCompletedBatchesDTO | null; onPage: (page: number) => void }) {
  const rows = report?.rows || [];
  const pageCount = Math.max(1, Math.ceil((report?.total || 0) / Math.max(1, report?.pageSize || 25)));
  return <Panel kicker="批次维度" title={`${rangeText(report)} 计划到期批次达成明细`} action={<span>{numberText(report?.total)} 批 · 逾期 {numberText(report?.summary.overdueBatches)}</span>}>
    <div className="report-batch-table">
      <div><span>订单行 / 批次</span><span>计划与良品</span><span>计划完成日</span><span>实际达成</span><span>状态</span><span>当前工序 / 责任人</span><span /></div>
      {rows.map(row => <article key={row.id}>
        <span><strong>{row.batchLabel}</strong><small>{row.workOrderCode || '尚未生成工单'} · {row.customerName}</small><em>{row.specification || row.productName}</em></span>
        <span className="progress"><b>{row.completedQuantity} / {row.quantity}</b><i><em style={{ width: `${Math.min(100, (row.quantityBasisPoints || 0) / 100)}%` }} /></i><small>{percentText(row.quantityBasisPoints)} 最终良品</small></span>
        <span><strong>{dateOnly(row.plannedCompletionDate)}</strong><small>计划到期</small></span>
        <span><strong>{row.actualCompletionAt ? dateTimeText(row.actualCompletionAt) : '尚未达成'}</strong><small>{row.actualCompletionAt ? '首次达到批次数量' : `截止 ${dateTimeText(report?.cutoffAt)}`}</small></span>
        <span><em className={`batch-${row.status}`}>{row.statusLabel}</em><small className={row.overdue ? 'danger' : ''}>{row.overdue ? '已超过计划完成日' : '未逾期'}</small></span>
        <span><strong>{row.currentProcess || '工序待补充'}</strong><small>{row.owner || '责任人待安排'}</small></span>
        {row.workOrderId ? <Link href={`/production?workOrderId=${encodeURIComponent(row.workOrderId)}`} aria-label={`打开工单 ${row.workOrderCode || row.batchLabel}`}><ChevronRight /></Link> : <span />}
      </article>)}
    </div>
    {!rows.length && <EmptyState icon={<ClipboardCheck />} title="当前筛选没有计划到期批次" />}
    {Boolean(report?.total) && <div className="report-pagination"><span>第 {report?.page || 1} / {pageCount} 页，共 {numberText(report?.total)} 批</span><div><button type="button" disabled={(report?.page || 1) <= 1} onClick={() => onPage(Math.max(1, (report?.page || 1) - 1))}><ChevronLeft />上一页</button><button type="button" disabled={(report?.page || 1) >= pageCount} onClick={() => onPage(Math.min(pageCount, (report?.page || 1) + 1))}>下一页<ChevronRight /></button></div></div>}
  </Panel>;
}

function AttendancePanel({ report }: { report: ReportOperationsDTO | null }) {
  const rows = report?.dailyAttendance || [];
  return <Panel kicker="每日出勤" title={`${rangeText(report)} 生产车间出勤得分`} action={<span>实际出勤 ÷（排班 + 实际加班 - 请假），最高 100%</span>}><div className="report-attendance-bars">{rows.map(row => <article key={row.date}><header><strong>{row.date.slice(5)}</strong><span>{percentText(row.hoursBasisPoints)}</span></header><div><i style={{ width: `${Math.min(100, (row.hoursBasisPoints || 0) / 100)}%` }} /></div><dl><span>净应 {compactHours(row.netExpectedMilliseconds)}</span><span>实到 {compactHours(row.attendanceMilliseconds)}</span><span>加班 {compactHours(row.actualOvertimeMilliseconds)}</span><span>请假扣减 {compactHours(row.leaveDeductionMilliseconds)}</span><span>人数 {row.attendancePeople}/{row.plannedPeople}</span><span className={row.extraAttendanceMilliseconds ? 'accent' : ''}>超额 {compactHours(row.extraAttendanceMilliseconds)}</span></dl></article>)}</div>{!rows.length && <EmptyState icon={<CalendarDays />} title="当前周期没有正式考勤记录" />}</Panel>;
}

function TeamHoursTable({ rows }: { rows: ReportOperationsLaborRowDTO[] }) {
  return <Panel kicker="班组维度" title="净应出勤、生产实耗、利用率与目标达成"><div className="report-team-table"><div><span>班组</span><span>员工</span><span>净应出勤</span><span>实际出勤</span><span>生产实耗</span><span>标准工时</span><span>工时利用率</span><span>标准效率</span><span>目标达成率</span></div>{rows.map(row => <article key={row.team}><span><strong>{row.team}</strong><small>{row.confirmedRecords} 条正式考勤 · 加班 {compactHours(row.recognizedOvertimeMilliseconds)}</small></span><span>{row.attendancePeople} / {row.employeeCount} 人</span><span>{compactHours(row.netExpectedMilliseconds)}<small>请假扣减 {compactHours(row.leaveDeductionMilliseconds)}</small></span><span>{compactHours(row.attendanceMilliseconds)}<small>超额 {compactHours(row.extraAttendanceMilliseconds)}</small></span><span>{compactHours(row.actualLaborMilliseconds)}<small>未解释 {compactHours(row.unexplainedMilliseconds)}</small></span><span>{compactHours(row.standardLaborMilliseconds)}<small>待匹配 {compactHours(row.unmatchedStandardLaborMilliseconds)}</small></span><span><b>{percentText(row.utilizationBasisPoints)}</b></span><span><b>{percentText(row.efficiencyBasisPoints)}</b></span><span><b>{percentText(row.attainmentBasisPoints)}</b></span></article>)}</div>{!rows.length && <EmptyState icon={<UsersRound />} title="当前周期没有班组工时数据" />}</Panel>;
}

function EmployeeTable({ rows, unmatchedOnly, onSelect }: { rows: EmployeeAttainmentRowDTO[]; unmatchedOnly: boolean; onSelect: (row: EmployeeAttainmentRowDTO) => void }) {
  return <Panel kicker="人员维度" title={unmatchedOnly ? '待匹配标准工时员工' : '员工每日达成与工时利用'} action={<span>{rows.length} 人 · 点击查看每日明细</span>}><div className="report-employee-table"><div><span>员工</span><span>确认出勤</span><span>生产实耗</span><span>标准工时</span><span>待匹配</span><span>工时利用率</span><span>标准效率</span><span>目标达成率</span></div>{rows.map(row => { const policy = row.attainmentStream === 'sample' ? '样品独立统计' : row.attainmentStream === 'excluded' ? '不计入月均' : `批量口径 ${(row.attainmentFactorBasisPoints / 100).toFixed(row.attainmentFactorBasisPoints % 100 ? 2 : 0)}%`; return <button type="button" key={row.employee.id} onClick={() => onSelect(row)}><span><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.team || row.employee.department || '未分组'} · {policy}</small></span><span><b>{compactHours(row.attendanceMilliseconds)}</b><small>{row.attendanceConfirmedDays} 人日</small></span><span><b>{compactHours(row.actualLaborMilliseconds)}</b><small>报工实耗</small></span><span><b>{compactHours(row.standardLaborMilliseconds)}</b><small>正式匹配</small></span><span className={row.unmatchedStandardLaborMilliseconds ? 'danger' : ''}><b>{compactHours(row.unmatchedStandardLaborMilliseconds)}</b><small>{row.attendanceMissingDays} 人日待核对</small></span><span><b>{percentText(row.coverageBasisPoints)}</b><small>出勤覆盖</small></span><span><b>{percentText(row.processEfficiencyBasisPoints)}</b><small>标准 / 实耗</small></span><span className="attainment"><strong>{row.attainmentStream === 'batch' ? percentText(row.attainmentBasisPoints) : '—'}</strong><i><b style={{ width: `${row.attainmentStream === 'batch' ? Math.min(100, (row.attainmentBasisPoints || 0) / 100) : 0}%` }} /></i></span></button>; })}</div>{!rows.length && <EmptyState icon={<UsersRound />} title={unmatchedOnly ? '当前周期没有待匹配工时' : '当前周期没有员工正式数据'} />}</Panel>;
}

function EmployeeMatrix({ report, rows }: { report: ReportOperationsDTO | null; rows: ReportOperationsEmployeeRowDTO[] }) {
  const dates = report?.dates || [];
  return <Panel kicker="员工 × 日期" title={`${rangeText(report)} 个人目标达成矩阵`} action={<span>未入职、请假、休息、草稿与缺失不按 0 计算</span>}><div className="report-matrix-scroll"><table><thead><tr><th>班组</th><th>岗位</th><th>员工</th>{dates.map(day => <th key={day.date} className={day.isWeekend ? 'weekend' : ''}><strong>{day.day}号</strong><small>{day.weekday}</small></th>)}<th>周期加权值</th></tr></thead><tbody>{rows.map(row => <tr key={row.employee.id}><td>{row.team}</td><td>{row.position}</td><td><strong>{row.employee.name}</strong><small>{row.employee.employeeNo}</small></td>{dates.map(day => { const cell = row.days.find(item => item.date === day.date); const value = cell?.attainmentBasisPoints; const text = cell?.status === 'not_employed' ? '未入职' : cell?.status === 'draft' ? '草稿' : cell?.status === 'rest' ? '休' : cell?.attendanceType === 'leave' ? '请假' : cell?.attendanceType === 'absent' ? '缺勤' : cell?.status === 'missing' ? '待登记' : value === null || value === undefined ? '—' : percentText(value); return <td key={day.date} className={`status-${cell?.status || 'missing'} ${value !== null && value !== undefined && value < 8500 ? 'risk' : ''}`} title={`${row.employee.name} ${day.date}：${text}；净应 ${compactHours(cell?.netExpectedMilliseconds)}，实际 ${compactHours(cell?.attendanceMilliseconds)}`}><strong>{text}</strong></td>; })}<td className="average"><strong>{percentText(row.attainmentBasisPoints)}</strong></td></tr>)}</tbody></table></div>{!rows.length && <EmptyState icon={<Table2 />} title="没有符合筛选条件的员工矩阵" />}</Panel>;
}

function LaborLedger({ pools }: { pools: ProcessLaborPoolDTO[] }) {
  const rows = claimRows(pools);
  return <Panel kicker="标准工时自动入账" title="报工与员工工时映射" action={<span>{rows.length} 笔</span>}><div className="report-labor-ledger"><div><span>工单 / 产品</span><span>工序</span><span>作业员工</span><span>报工数量</span><span>标准工时</span><span>入账时间</span></div>{rows.map(({ pool, claim }) => <article key={claim.id}><span><strong>{pool.workOrder.code}</strong><small>{pool.workOrder.customerName || '客户未填写'} · {pool.workOrder.specification || pool.workOrder.productName}</small></span><span><b>{pool.step.processName}</b><small>{pool.step.processCode}</small></span><span><b>{claim.employee.name}</b><small>{claim.employee.employeeNo}</small></span><span><b>{claim.quantity} {pool.unitLabel}</b></span><span><b>{compactHours(claim.standardLaborMilliseconds)}</b></span><span><b>{dateTimeText(claim.claimedAt)}</b></span></article>)}</div>{!rows.length && <EmptyState icon={<Clock3 />} title="所选日期没有自动记工记录" />}</Panel>;
}

function AffectedLabor({ report }: { report: AbnormalTimeReportDTO | null }) {
  const rows = report?.categories || [];
  const max = Math.max(1, ...rows.map(row => row.affectedPersonMilliseconds));
  return <Panel kicker="异常工时" title="类别影响人时与已审批人时"><div className="report-affected-grid">{rows.map(row => <article key={row.category}><header><strong>{row.categoryLabel}</strong><span>{row.eventCount} 条</span></header><div><i style={{ width: `${row.affectedPersonMilliseconds / max * 100}%` }} /></div><dl><span><small>影响人时</small><b>{compactHours(row.affectedPersonMilliseconds)}</b></span><span><small>审批人时</small><b>{compactHours(row.approvedPersonMilliseconds)}</b></span><span><small>事件时长</small><b>{compactHours(row.incidentMilliseconds)}</b></span></dl></article>)}</div>{!rows.length && <EmptyState icon={<ShieldCheck />} title="当前周期没有异常影响工时" />}</Panel>;
}

function CauseDistribution({ report }: { report: AbnormalTimeReportDTO | null }) {
  const rows = report?.categories || [];
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.eventCount, 0));
  return <Panel kicker="原因结构" title="异常类别分布"><div className="report-cause-list">{rows.map((row, index) => <article key={row.category}><span>{String(index + 1).padStart(2, '0')}</span><div><header><strong>{row.categoryLabel}</strong><em>{row.eventCount} 条 · {Math.round(row.eventCount / total * 100)}%</em></header><i><b style={{ width: `${row.eventCount / total * 100}%` }} /></i><p>影响 {compactHours(row.affectedPersonMilliseconds)} · 已审批 {compactHours(row.approvedPersonMilliseconds)}</p></div></article>)}</div>{!rows.length && <EmptyState icon={<Activity />} title="当前周期没有异常原因数据" />}</Panel>;
}

function AbnormalLedger({ events }: { events: AbnormalTimeReportDTO['events'] }) {
  return <Panel kicker="事件台账" title="品质确认与闭环状态" action={<span>{events.length} 条</span>}><div className="report-abnormal-ledger"><div><span>事件</span><span>异常类别</span><span>时间与影响</span><span>品质确认</span><span>责任与闭环</span></div>{events.map(event => <article key={event.id}><span><strong>#{event.sequence} {event.title}</strong><small>{event.workOrder?.code || '未关联工单'} · {event.processStep?.processName || '未关联工序'}</small></span><span><b>{event.categoryLabel}</b><small>{event.subcategory || event.reason || '未补充分项'}</small></span><span><b>{compactHours(event.affectedPersonMilliseconds)}</b><small>{dateOnly(event.workDate)} · 事件 {compactHours(event.durationMilliseconds)}</small></span><span><em className={`quality-${event.qualityStatus}`}>{event.qualityStatus === 'confirmed' ? '已确认' : event.qualityStatus === 'rejected' ? '已驳回' : '待确认'}</em><small>{event.qualityConfirmedBy?.displayName || '品质未签名'}</small></span><span><b>{event.responsibilityDepartment || '责任待定'}</b><small className={event.resolutionStatus === 'open' ? 'danger' : ''}>{event.resolutionStatus === 'open' ? '处理中' : '已关闭'}</small></span></article>)}</div>{!events.length && <EmptyState icon={<CheckCircle2 />} title="当前筛选没有质量异常事件" />}</Panel>;
}

function GovernanceOverview({ report }: { report: ReportCenterOverviewDTO | null }) {
  const total = Math.max(1, (report?.focusItems || []).filter(item => item.entityType === 'workOrder').length);
  return <Panel kicker="核心资料检查" title="正式生产资料完整性"><div className="report-governance-grid">{(report?.completeness || []).filter(row => row.key !== 'sample_review').map(row => <Link href={row.route} key={row.key}><span><FileWarning /></span><div><small>{row.note}</small><strong>{row.label}</strong><p>{numberText(row.count)} 单存在缺口</p><i><b style={{ width: `${Math.min(100, row.count / total * 100)}%` }} /></i></div><ChevronRight /></Link>)}</div></Panel>;
}

function SampleTaskAttainment({ report }: { report: ReportCenterOverviewDTO | null }) {
  const rows = report?.dailyTrend || [];
  const max = Math.max(1, ...rows.flatMap(row => [row.plannedQty, row.completedQty]));
  return <Panel kicker="样品独立口径" title={`${rangeText(report)} 样品任务计划与完成`} action={<span>不计入量产员工效率</span>}>
    <div className={`report-trend-chart ${rows.length > 14 ? 'long-range' : ''}`}>{rows.map(row => <article key={row.date} title={`${row.date}：任务 ${numberText(row.plannedQty)}，完成 ${numberText(row.completedQty)}`}><div><i className="planned" style={{ height: `${Math.max(2, row.plannedQty / max * 100)}%` }} /><i className="completed" style={{ height: `${Math.max(2, row.completedQty / max * 100)}%` }} /></div><strong>{row.label}</strong><span>{row.completedQty} / {row.plannedQty}</span></article>)}</div>
    <div className="report-trend-ledger"><div><span>日期</span><span>样品任务</span><span>已完成</span><span>未完成</span><span>任务达成率</span></div>{rows.map(row => <article key={row.date}><span><strong>{row.date}</strong></span><span>{numberText(row.plannedQty)}</span><span>{numberText(row.completedQty)}</span><span>{numberText(Math.max(0, row.plannedQty - row.completedQty))}</span><span><b>{percentText(row.plannedQty > 0 ? Math.round(row.completedQty / row.plannedQty * 10_000) : null)}</b></span></article>)}</div>
    {!rows.length && <EmptyState icon={<ClipboardCheck />} title="当前周期没有样品任务" />}
  </Panel>;
}

function SampleReview({ report }: { report: ReportCenterOverviewDTO | null }) {
  const sample = report?.sample;
  return <Panel kicker="审核链路" title="提交、分项审核与正式发布"><div className="report-review-flow"><article><span>01</span><div><small>样品采集</small><strong>{numberText(sample?.taskCount)} 个任务</strong><p>扫码填写数据并拍摄过程、成品照片</p></div></article><ChevronRight /><article><span>02</span><div><small>分项审核</small><strong>{numberText(sample?.reviewedItemCount)} 项已审核</strong><p>{numberText(sample?.pendingReviewCount)} 项仍待审核，未审核不进入正式资料</p></div></article><ChevronRight /><article><span>03</span><div><small>正式发布</small><strong>{numberText(sample?.publishedItemCount)} 项资料</strong><p>发布后同步到产品数据、图纸注意事项与辅料规则</p></div></article></div><div className="report-review-progress"><div><span>当前审核完成率</span><strong>{percentText(sample?.reviewBasisPoints)}</strong></div><i><b style={{ width: `${Math.min(100, (sample?.reviewBasisPoints || 0) / 100)}%` }} /></i></div></Panel>;
}

function FocusTable({ title, items, onSelect }: { title: string; items: ReportCenterFocusItemDTO[]; onSelect: (item: ReportCenterFocusItemDTO) => void }) {
  return <Panel kicker="业务明细" title={title} action={<span>{items.length} 项</span>}><div className="report-focus-table"><div><span>任务 / 工单</span><span>完成进度</span><span>当前环节</span><span>责任人</span><span>交期</span><span>风险 / 资料</span><span /></div>{items.map(item => <button type="button" key={`${item.entityType}-${item.id}`} onClick={() => onSelect(item)}><span><em>{item.entityType === 'workOrder' ? '量产' : '样品'}</em><strong>{item.code}</strong><small>{item.customerName} · {item.specification}</small></span><span className="progress"><b>{percentText(item.progressBasisPoints)}</b><i><em style={{ width: `${Math.min(100, (item.progressBasisPoints || 0) / 100)}%` }} /></i><small>{item.completedQty ?? '—'} / {item.plannedQty ?? '—'} {item.unitLabel}</small></span><span><strong>{item.currentProcess || item.statusLabel}</strong><small>{item.nextProcess ? `下一步：${item.nextProcess}` : item.productName}</small></span><span><strong>{item.owner || '待安排'}</strong><small>{item.startedAt ? `开工 ${dateOnly(item.startedAt)}` : '尚未开工'}</small></span><span><strong>{dateOnly(item.dueAt)}</strong><small>{item.statusLabel}</small></span><span><em className={`risk-${item.risk}`}>{item.riskLabel}</em><small>{item.missingData[0] || '资料已核对'}</small></span><ChevronRight /></button>)}</div>{!items.length && <EmptyState icon={<ClipboardCheck />} title="当前分支和筛选没有匹配数据" />}</Panel>;
}

function LoadingState() {
  return <div className="report-branch-loading"><Loader2 className="spin" /><strong>正在加载当前指标</strong><span>只查询本分支需要的正式业务数据</span></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="report-branch-error"><AlertTriangle /><strong>当前指标加载失败</strong><span>{message}</span><button type="button" onClick={onRetry}>重新加载</button></div>;
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="report-branch-empty">{icon}<strong>{title}</strong><span>可调整日期、客户、班组或搜索条件后重试。</span></div>;
}

function EmployeeDrawer({ row, onClose }: { row: EmployeeAttainmentRowDTO; onClose: () => void }) {
  return <div className="report-focus-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="report-focus-drawer report-employee-drawer" role="dialog" aria-modal="true" aria-label={`${row.employee.name}每日达成详情`}><header><div><small>员工每日达成</small><h2>{row.employee.name}</h2><p>{row.employee.employeeNo} · {row.employee.team || row.employee.department || '未分组'} · {row.employee.position || '岗位未设置'}</p></div><button type="button" aria-label="关闭员工详情" onClick={onClose}><X /></button></header>
    <div className="report-employee-drawer-summary"><article><small>目标达成率</small><strong>{row.attainmentStream === 'batch' ? percentText(row.attainmentBasisPoints) : '不计入'}</strong><span>标准工时 / 合格人日目标产能</span></article><article><small>工时利用率</small><strong>{percentText(row.coverageBasisPoints)}</strong><span>实耗 + 免责异常 / 实际出勤</span></article><article><small>标准工时效率</small><strong>{percentText(row.processEfficiencyBasisPoints)}</strong><span>标准工时 / 生产实耗</span></article><article><small>待匹配标准工时</small><strong>{compactHours(row.unmatchedStandardLaborMilliseconds)}</strong><span>{row.attendanceMissingDays} 人日待核对</span></article></div>
    <section className="report-employee-day-section"><header><div><small>逐日证据</small><h3>考勤、加班、请假与报工明细</h3></div><span>{row.days.length} 天</span></header><div className="report-employee-day-list">{row.days.map(day => {
      const future = day.date > todayKey();
      const claims = row.claimDetails.filter(item => item.workDate === day.date);
      const executions = row.details.filter(item => dateOnly(item.endedAt) === day.date);
      const statusText = future ? '日期未到' : day.includedInAttainment ? '计入目标达成' : employeeExclusionText(day.exclusionReason);
      return <details key={day.date} className={day.includedInAttainment ? 'included' : 'excluded'}><summary><span><strong>{day.date}</strong><small>{statusText}</small></span><span><b>{day.includedInAttainment ? percentText(day.targetAttainmentBasisPoints) : '—'}</b><small>目标达成</small></span><ChevronRight /></summary><div className="report-employee-day-metrics"><dl><div><dt>排班</dt><dd>{compactHours(day.scheduledMilliseconds)}</dd></div><div><dt>认可加班</dt><dd>{compactHours(day.recognizedOvertimeMilliseconds)}</dd></div><div><dt>请假扣减</dt><dd>{compactHours(day.leaveDeductionMilliseconds)}</dd></div><div><dt>净应出勤</dt><dd>{compactHours(day.netExpectedMilliseconds)}</dd></div><div><dt>实际出勤</dt><dd>{compactHours(day.attendanceMilliseconds)}</dd></div><div><dt>超额出勤</dt><dd>{compactHours(day.extraAttendanceMilliseconds)}</dd></div><div><dt>生产实耗</dt><dd>{compactHours(day.actualLaborMilliseconds)}</dd></div><div><dt>标准工时</dt><dd>{compactHours(day.standardLaborMilliseconds)}</dd></div><div><dt>工时利用率</dt><dd>{percentText(day.utilizationBasisPoints)}</dd></div><div><dt>标准效率</dt><dd>{percentText(day.efficiencyBasisPoints)}</dd></div></dl><p>加班来源：{day.overtimeSource === 'confirmed_plan' ? '已确认日计划' : day.overtimeSource === 'attendance_fallback' ? '已确认考勤回退' : '无认可加班'}；考勤状态：{day.attendanceStatus === 'confirmed' ? '已确认' : day.attendanceStatus === 'draft' ? '草稿' : '未登记'}。{day.overlapMilliseconds > 0 ? ` 实耗与免责异常重叠 ${compactHours(day.overlapMilliseconds)}，需核对。` : ''}</p>{Boolean(claims.length || executions.length) && <ul>{claims.slice(0, 6).map(item => <li key={item.id}><span>{item.workOrderCode} · {item.processName}</span><b>{item.quantity} {item.unitLabel} / {compactHours(item.standardLaborMilliseconds)}</b></li>)}{executions.slice(0, 6).map(item => <li key={item.id}><span>{item.workOrderCode} · {item.processName}</span><b>良品 {item.goodQty} / {compactHours(item.standardLaborMilliseconds)}</b></li>)}</ul>}</div></details>;
    })}</div></section>
  </aside></div>;
}

function FocusDrawer({ item, onClose }: { item: ReportCenterFocusItemDTO; onClose: () => void }) {
  return <div className="report-focus-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="report-focus-drawer" role="dialog" aria-modal="true" aria-label={`${item.code}详情`}><header><div><small>{item.entityType === 'workOrder' ? '量产工单' : '样品任务'}</small><h2>{item.code}</h2><p>{item.customerName} · {item.productName}</p></div><button type="button" aria-label="关闭详情" onClick={onClose}><X /></button></header><div className="report-focus-drawer-status"><span className={`risk-${item.risk}`}><AlertTriangle />{item.riskLabel}</span><strong>{item.statusLabel}</strong></div><dl><div><dt>规格</dt><dd>{item.specification}</dd></div><div><dt>完成进度</dt><dd>{percentText(item.progressBasisPoints)} · {item.completedQty ?? '—'} / {item.plannedQty ?? '—'} {item.unitLabel}</dd></div><div><dt>当前环节</dt><dd>{item.currentProcess || '未进入流程'}</dd></div><div><dt>下一环节</dt><dd>{item.nextProcess || '无后续环节'}</dd></div><div><dt>责任人</dt><dd>{item.owner || '待安排'}</dd></div><div><dt>计划交期</dt><dd>{dateOnly(item.dueAt)}</dd></div></dl><section><h3>资料与风险</h3>{item.missingData.length ? item.missingData.map(text => <p key={text}><FileWarning />{text}</p>) : <p className="ready"><FileCheck2 />核心资料检查已通过</p>}</section><footer><Link href={safeHref(item)} prefetch={false}>打开业务详情<ChevronRight /></Link></footer></aside></div>;
}
