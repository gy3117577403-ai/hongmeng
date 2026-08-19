'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
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
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
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
  'quantity-attainment', 'completed-orders', 'order-status', 'production-trend', 'process-bottlenecks',
  'delivery-risk', 'due-soon', 'delivery-orders', 'completeness', 'missing-route', 'missing-standard',
  'missing-drawing', 'missing-material', 'sample-tasks', 'pending-review', 'published-materials', 'review-attainment',
]);
const OPERATIONS_BRANCHES = new Set<ReportBranchKey>([
  'weekly-plan-attainment', 'attendance-attainment', 'team-hours', 'employee-matrix',
]);
const EMPLOYEE_BRANCHES = new Set<ReportBranchKey>(['employee-attainment', 'unmatched-labor']);
const QUALITY_BRANCHES = new Set<ReportBranchKey>(['affected-labor', 'cause-distribution', 'open-events', 'event-ledger']);
const SEARCHABLE_BRANCHES = new Set<ReportBranchKey>([
  'completed-orders', 'order-status', 'delivery-risk', 'due-soon', 'delivery-orders',
  'employee-attainment', 'employee-matrix', 'unmatched-labor', 'open-events', 'event-ledger',
  'missing-route', 'missing-standard', 'missing-drawing', 'missing-material',
  'sample-tasks', 'pending-review', 'published-materials',
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

function rangeText(report: { rangeStart: string; rangeEnd: string } | null): string {
  if (!report) return '正在读取统计范围';
  const end = new Date(new Date(report.rangeEnd).getTime() - 1);
  return `${dateOnly(report.rangeStart)} 至 ${dateOnly(end.toISOString())}`;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCsv(name: string, rows: unknown[][]): void {
  const content = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeHref(item: ReportCenterFocusItemDTO): string {
  return item.entityType === 'workOrder'
    ? `/production?workOrderId=${encodeURIComponent(item.id)}`
    : '/weekly-plan-center?branch=samples';
}

function branchUsesMonth(branch: ReportBranchKey): boolean {
  return OPERATIONS_BRANCHES.has(branch);
}

function branchUsesSingleDate(branch: ReportBranchKey): boolean {
  return branch === 'labor-ledger';
}

function branchMethod(branch: ReportBranchKey): string {
  if (['quantity-attainment', 'production-trend', 'weekly-plan-attainment'].includes(branch)) {
    return '成品数量只统计最终工序良品；中间工序数量仅用于瓶颈和质量分析。';
  }
  if (['attendance-attainment', 'team-hours', 'employee-attainment', 'employee-matrix', 'unmatched-labor'].includes(branch)) {
    return '效率只使用已确认考勤，并按标准工时与异常免责口径计算；草稿和缺失记录单独标识。';
  }
  if (QUALITY_BRANCHES.has(branch)) {
    return '异常影响人时按事件分配人员汇总，品质确认与闭环状态分别统计。';
  }
  if (branch === 'completeness' || branch.startsWith('missing-')) {
    return '资料完整率核查工艺路线、标准工时、当前图纸与已发布辅料规则。';
  }
  if (['sample-tasks', 'pending-review', 'published-materials', 'review-attainment'].includes(branch)) {
    return '样品采集数据只有经过分项审核并发布后，才计入正式产品资料。';
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
  if (branch === 'sample-tasks') return samples;
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
  operations: ReportOperationsDTO | null,
  employees: EmployeeAttainmentReportDTO | null,
  abnormal: AbnormalTimeReportDTO | null,
  pools: ProcessLaborPoolDTO[],
  branchItems: ReportCenterFocusItemDTO[],
): MetricDefinition {
  const summary = overview?.summary;
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
    'completed-orders': { label: '完成工单', value: numberText(summary?.completedOrders), unit: '单', description: '所选周期内已经完成归档', tone: 'green', stats: [
      { label: '最终良品', value: numberText(summary?.completedQty), note: '套' },
      { label: '进行中', value: numberText(summary?.activeOrders), note: '单' },
      { label: '待开始', value: numberText(summary?.pendingOrders), note: '单' },
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
    'weekly-plan-attainment': { label: '周计划数量达成', value: percentText(operationsSummary?.quantityCompletionBasisPoints), description: '本月周计划完成数量 / 计划数量', tone: 'orange', stats: [
      { label: '计划批次', value: numberText(operationsSummary?.plannedBatches), note: '批' },
      { label: '完成批次', value: numberText(operationsSummary?.completedBatches), note: '批' },
      { label: '批次达成', value: percentText(operationsSummary?.batchCompletionBasisPoints), note: '按批次' },
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
    'attendance-attainment': { label: '全厂出勤达成率', value: percentText(operationsSummary?.attendanceBasisPoints), description: '有效出勤工时 / 应出勤工时', tone: 'blue', stats: [
      { label: '应出勤', value: compactHours(operationsSummary?.plannedMilliseconds), note: '工时' },
      { label: '有效出勤', value: compactHours(operationsSummary?.attendanceMilliseconds), note: '工时' },
      { label: '草稿考勤', value: numberText(operationsSummary?.draftAttendanceRecords), note: '条' },
    ] },
    'team-hours': { label: '班组数量', value: numberText(operationsSummary?.teamCount), unit: '组', description: '按班组核对出勤与标准产出', tone: 'green', stats: [
      { label: '生产员工', value: numberText(operationsSummary?.employeeCount), note: '人' },
      { label: '标准产出', value: compactHours(operationsSummary?.standardLaborMilliseconds), note: '工时' },
      { label: '车间达成', value: percentText(operationsSummary?.attainmentBasisPoints), note: '效率' },
    ] },
    'employee-attainment': { label: '员工出勤达成率', value: percentText(employeeSummary?.attainmentBasisPoints), description: '标准工时 / 有效出勤产能', tone: 'blue', stats: [
      { label: '生产员工', value: numberText(employeeSummary?.employeeCount), note: '人' },
      { label: '标准工时', value: compactHours(employeeSummary?.standardLaborMilliseconds), note: '工时' },
      { label: '正式考勤', value: numberText(employeeSummary?.attendanceConfirmedDays), note: '人日' },
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
    : domain.branches.filter(item => item.key === 'employee-attainment' || item.key === 'unmatched-labor');

  const [period, setPeriod] = useState<ReportCenterPeriodDTO>(() => {
    const value = searchParams.get('period');
    return value === 'today' || value === 'month' ? value : 'week';
  });
  const [date, setDate] = useState(() => searchParams.get('date') || todayKey());
  const [month, setMonth] = useState(() => searchParams.get('month') || todayKey().slice(0, 7));
  const [customer, setCustomer] = useState(() => searchParams.get('customer') || '');
  const [team, setTeam] = useState(() => searchParams.get('team') || '');
  const [keyword, setKeyword] = useState('');
  const [overview, setOverview] = useState<ReportCenterOverviewDTO | null>(null);
  const [operations, setOperations] = useState<ReportOperationsDTO | null>(null);
  const [employees, setEmployees] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormal, setAbnormal] = useState<AbnormalTimeReportDTO | null>(null);
  const [laborPools, setLaborPools] = useState<ProcessLaborPoolDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedFocus, setSelectedFocus] = useState<ReportCenterFocusItemDTO | null>(null);
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
      if (OVERVIEW_BRANCHES.has(initialBranch)) {
        const mode: ReportCenterModeDTO = initialDomain === 'sample' ? 'sample' : 'mass';
        const params = new URLSearchParams({ period, date, mode });
        if (customer) params.set('customer', customer);
        const response = await fetch(`/api/reports/overview?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<ReportCenterOverviewDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '业务报表加载失败');
        setOverview(body.report);
      } else if (OPERATIONS_BRANCHES.has(initialBranch)) {
        const response = await fetch(`/api/reports/operations?month=${encodeURIComponent(month)}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<ReportOperationsDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '月度生产报表加载失败');
        setOperations(body.report);
      } else if (EMPLOYEE_BRANCHES.has(initialBranch)) {
        const params = new URLSearchParams({ period, date });
        const response = await fetch(`/api/reports/employee-attainment?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse<EmployeeAttainmentReportDTO>;
        if (!response.ok || !body.report) throw new Error(body.error || '员工工时报表加载失败');
        setEmployees(body.report);
      } else if (QUALITY_BRANCHES.has(initialBranch)) {
        const params = new URLSearchParams({ period, date });
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
  }, [customer, date, initialBranch, initialDomain, month, period, refreshToken]);

  useEffect(() => {
    if (!selectedFocus) return undefined;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setSelectedFocus(null);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedFocus]);

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
  const operationRows = useMemo(() => (operations?.employeeMatrix || []).filter(row => (!team || row.team === team)
    && (!normalizedKeyword || `${row.employee.employeeNo} ${row.employee.name} ${row.team} ${row.position}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))), [normalizedKeyword, operations?.employeeMatrix, team]);
  const teamRows = useMemo(() => (operations?.teamMonthly || []).filter(row => !team || row.team === team), [operations?.teamMonthly, team]);
  const qualityEvents = useMemo(() => (abnormal?.events || []).filter(event => (!normalizedKeyword || `${event.sequence} ${event.categoryLabel} ${event.title} ${event.reason || ''} ${event.responsibilityDepartment || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))
    && (initialBranch !== 'open-events' || event.resolutionStatus === 'open')), [abnormal?.events, initialBranch, normalizedKeyword]);
  const teams = operations?.teamMonthly.map(item => item.team) || [];
  const metric = metricForBranch(initialBranch, overview, operations, employees, abnormal, laborPools, rawBranchItems);
  const activeRange = overview || employees || abnormal;

  function branchHref(targetDomain: ReportDomainKey, target: ReportBranchDefinition): string {
    const query = new URLSearchParams(searchParams.toString());
    query.delete('customer');
    query.delete('team');
    const suffix = query.toString();
    return `${reportRoute(targetDomain, target.key)}${suffix ? `?${suffix}` : ''}`;
  }

  function exportBranch(): void {
    const stamp = branchUsesMonth(initialBranch) ? month : `${date}-${period}`;
    if (OVERVIEW_BRANCHES.has(initialBranch)) {
      downloadCsv(`${branch.label}-${stamp}.csv`, [
        ['任务/工单', '客户', '产品', '规格', '计划数量', '完成数量', '状态', '当前环节', '责任人', '交期', '风险', '资料缺口'],
        ...branchItems.map(item => [item.code, item.customerName, item.productName, item.specification, item.plannedQty ?? '', item.completedQty ?? '', item.statusLabel, item.currentProcess || '', item.owner || '', dateOnly(item.dueAt), item.riskLabel, item.missingData.join('；')]),
      ]);
    } else if (initialBranch === 'weekly-plan-attainment') {
      downloadCsv(`${branch.label}-${month}.csv`, [
        ['周次', '日期范围', '计划批次', '完成批次', '批次达成率', '计划数量', '完成数量', '数量达成率'],
        ...(operations?.weeklyPlan || []).map(row => [row.label, `${row.startDate} 至 ${row.endDate}`, row.plannedBatches, row.completedBatches, percentText(row.batchCompletionBasisPoints), row.plannedQuantity, row.completedQuantity, percentText(row.quantityCompletionBasisPoints)]),
      ]);
    } else if (initialBranch === 'team-hours' || initialBranch === 'attendance-attainment' || initialBranch === 'employee-matrix') {
      downloadCsv(`${branch.label}-${month}.csv`, [
        ['班组', '员工编号', '员工', '应出勤工时', '有效出勤工时', '标准工时', '待匹配工时', '达成率'],
        ...operationRows.map(row => [row.team, row.employee.employeeNo, row.employee.name, compactHours(row.plannedMilliseconds), compactHours(row.attendanceMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.unmatchedStandardLaborMilliseconds), percentText(row.attainmentBasisPoints)]),
      ]);
    } else if (EMPLOYEE_BRANCHES.has(initialBranch)) {
      downloadCsv(`${branch.label}-${stamp}.csv`, [
        ['员工编号', '姓名', '班组', '确认出勤', '标准工时', '待匹配工时', '免责异常', '达成率'],
        ...employeeRows.map(row => [row.employee.employeeNo, row.employee.name, row.employee.team || '', compactHours(row.attendanceMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.unmatchedStandardLaborMilliseconds), compactHours(row.exemptAbnormalMilliseconds), percentText(row.attainmentBasisPoints)]),
      ]);
    } else if (QUALITY_BRANCHES.has(initialBranch)) {
      downloadCsv(`${branch.label}-${stamp}.csv`, [
        ['序号', '类别', '标题', '事件时长', '影响人时', '品质状态', '处理状态', '责任部门'],
        ...qualityEvents.map(event => [event.sequence, event.categoryLabel, event.title, compactHours(event.durationMilliseconds), compactHours(event.affectedPersonMilliseconds), event.qualityStatus, event.resolutionStatus, event.responsibilityDepartment || '']),
      ]);
    } else if (initialBranch === 'labor-ledger') {
      downloadCsv(`${branch.label}-${date}.csv`, [
        ['工单', '工序', '员工', '数量', '单位', '标准工时', '记工时间'],
        ...claimRows(laborPools).map(({ pool, claim }) => [pool.workOrder.code, pool.step.processName, claim.employee.name, claim.quantity, pool.unitLabel, compactHours(claim.standardLaborMilliseconds), dateTimeText(claim.claimedAt)]),
      ]);
    }
    setToast('已导出当前分支和筛选结果');
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
          {branchUsesMonth(initialBranch) ? <label><CalendarRange /><input type="month" value={month} onChange={event => { setMonth(event.target.value); replaceQuery({ month: event.target.value }); }} aria-label="统计月份" /></label>
            : branchUsesSingleDate(initialBranch) ? <label><CalendarDays /><input type="date" value={date} onChange={event => { setDate(event.target.value); replaceQuery({ date: event.target.value }); }} aria-label="记工日期" /></label>
              : <div className="report-period-switch" role="group" aria-label="统计周期">{([['today', '今日'], ['week', '本周'], ['month', '本月']] as Array<[ReportCenterPeriodDTO, string]>).map(([key, label]) => <button className={period === key ? 'active' : ''} type="button" key={key} onClick={() => { setPeriod(key); replaceQuery({ period: key }); }}>{label}</button>)}<label><CalendarDays /><input type="date" value={date} onChange={event => { setDate(event.target.value); replaceQuery({ date: event.target.value }); }} aria-label="基准日期" /></label></div>}
          {OVERVIEW_BRANCHES.has(initialBranch) && <label><Layers3 /><select value={customer} onChange={event => { setCustomer(event.target.value); replaceQuery({ customer: event.target.value || null }); }} aria-label="客户筛选"><option value="">全部客户</option>{(overview?.customers || []).map(item => <option value={item} key={item}>{item}</option>)}</select></label>}
          {TEAM_FILTER_BRANCHES.has(initialBranch) && <label><UsersRound /><select value={team} onChange={event => { setTeam(event.target.value); replaceQuery({ team: event.target.value || null }); }} aria-label="班组筛选"><option value="">全部班组</option>{teams.map(item => <option value={item} key={item}>{item}</option>)}</select></label>}
          <button className="icon" type="button" title="刷新数据" aria-label="刷新数据" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} /></button>
          <button type="button" onClick={exportBranch}><Download />导出本页</button>
        </div>
        <nav className="report-branch-tabs" aria-label={`${domain.label}分支`}>{allowedBranches.map(item => <Link className={item.key === initialBranch ? 'active' : ''} href={branchHref(initialDomain, item)} key={item.key}>{item.shortLabel}</Link>)}</nav>
        <div className="report-branch-context"><span><CalendarRange />{branchUsesMonth(initialBranch) ? `${month} 月度口径` : branchUsesSingleDate(initialBranch) ? `${date} 单日口径` : rangeText(activeRange)}</span><span><ShieldCheck />{branchMethod(initialBranch)}</span></div>
      </section>

      <section className="report-topic-toolbar">
        {SEARCHABLE_BRANCHES.has(initialBranch)
          ? <label><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={initialDomain === 'people' ? '搜索员工、工号、班组或岗位' : initialDomain === 'quality' ? '搜索异常标题、原因或责任部门' : '搜索工单、客户、产品、工序或资料缺口'} aria-label="搜索当前分支" /></label>
          : <p className="report-topic-insight"><Activity /><span><small>当前分析</small><strong>{branch.description}</strong></span></p>}
        <div><ListFilter /><span>{domain.label}</span><ChevronRight /><strong>{branch.label}</strong></div>
        <em>{loading ? '正在刷新' : `更新于 ${dateTimeText(overview?.generatedAt || operations?.generatedAt || loadedAt || null)}`}</em>
      </section>

      <MetricHero metric={metric} />

      <section className="report-branch-body" aria-busy={loading}>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={() => setRefreshToken(value => value + 1)} />}
        {!loading && !error && <BranchContent
          branch={initialBranch}
          overview={overview}
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
        />}
      </section>
      {toast && <div className="report-branch-toast" role="status"><CheckCircle2 />{toast}</div>}
    </div>
    {selectedFocus && <FocusDrawer item={selectedFocus} onClose={() => setSelectedFocus(null)} />}
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
}) {
  const { branch, overview, operations, abnormal, laborPools, focusItems, employeeRows, operationRows, teamRows, qualityEvents, onFocus } = props;
  if (branch === 'quantity-attainment' || branch === 'production-trend') return <TrendPanel report={overview} />;
  if (branch === 'completed-orders') return <FocusTable title="完成工单明细" items={focusItems} onSelect={onFocus} />;
  if (branch === 'order-status') return <><StatusDistribution report={overview} /><FocusTable title="状态对应工单" items={focusItems} onSelect={onFocus} /></>;
  if (branch === 'weekly-plan-attainment') return <WeeklyPlan report={operations} />;
  if (branch === 'process-bottlenecks') return <BottleneckTable report={overview} />;
  if (branch === 'delivery-risk' || branch === 'due-soon' || branch === 'delivery-orders') return <FocusTable title={branch === 'delivery-risk' ? '逾期交付工单' : branch === 'due-soon' ? '即将到期工单' : '交付工单明细'} items={focusItems} onSelect={onFocus} />;
  if (branch === 'attendance-attainment') return <AttendancePanel report={operations} />;
  if (branch === 'team-hours') return <TeamHoursTable rows={teamRows} />;
  if (branch === 'employee-attainment' || branch === 'unmatched-labor') return <EmployeeTable rows={employeeRows} unmatchedOnly={branch === 'unmatched-labor'} />;
  if (branch === 'employee-matrix') return <EmployeeMatrix report={operations} rows={operationRows} />;
  if (branch === 'labor-ledger') return <LaborLedger pools={laborPools} />;
  if (branch === 'affected-labor') return <AffectedLabor report={abnormal} />;
  if (branch === 'cause-distribution') return <CauseDistribution report={abnormal} />;
  if (branch === 'open-events' || branch === 'event-ledger') return <AbnormalLedger events={qualityEvents} />;
  if (branch === 'completeness') return <GovernanceOverview report={overview} />;
  if (branch.startsWith('missing-')) return <FocusTable title="资料缺口工单" items={focusItems} onSelect={onFocus} />;
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
  return <Panel kicker="周次拆解" title={`${report?.month || ''} 周计划批次与数量达成`} action={<span>最终工序良品口径</span>}><div className="report-week-grid">{rows.map(row => <article key={row.key}><header><div><small>{row.startDate.slice(5)}—{row.endDate.slice(5)}</small><h3>{row.label}</h3></div><strong>{percentText(row.quantityCompletionBasisPoints)}</strong></header><dl><div><dt>批次</dt><dd>{row.completedBatches}<em> / {row.plannedBatches}</em></dd><i><b style={{ width: `${Math.min(100, (row.batchCompletionBasisPoints || 0) / 100)}%` }} /></i></div><div><dt>数量</dt><dd>{numberText(row.completedQuantity)}<em> / {numberText(row.plannedQuantity)}</em></dd><i><b style={{ width: `${Math.min(100, (row.quantityCompletionBasisPoints || 0) / 100)}%` }} /></i></div></dl></article>)}</div>{!rows.length && <EmptyState icon={<CalendarRange />} title="本月没有周计划数据" />}</Panel>;
}

function AttendancePanel({ report }: { report: ReportOperationsDTO | null }) {
  const rows = report?.dailyAttendance || [];
  return <Panel kicker="每日出勤" title={`${report?.month || ''} 生产车间出勤达成`} action={<span>人数与工时双口径</span>}><div className="report-attendance-bars">{rows.map(row => <article key={row.date}><header><strong>{row.date.slice(5)}</strong><span>{percentText(row.attendanceBasisPoints)}</span></header><div><i style={{ width: `${Math.min(100, (row.attendanceBasisPoints || 0) / 100)}%` }} /></div><dl><span>应到 {row.plannedPeople}</span><span>实到 {row.attendancePeople}</span><span>请假 {row.leavePeople}</span><span className={row.draftRecords ? 'danger' : ''}>草稿 {row.draftRecords}</span></dl></article>)}</div>{!rows.length && <EmptyState icon={<CalendarDays />} title="本月没有正式考勤记录" />}</Panel>;
}

function TeamHoursTable({ rows }: { rows: ReportOperationsLaborRowDTO[] }) {
  return <Panel kicker="班组维度" title="应出勤、有效出勤与标准产出"><div className="report-team-table"><div><span>班组</span><span>员工</span><span>应出勤</span><span>有效出勤</span><span>标准产出</span><span>免责异常</span><span>出勤率</span><span>工时达成率</span></div>{rows.map(row => <article key={row.team}><span><strong>{row.team}</strong><small>{row.confirmedRecords} 条正式考勤</small></span><span>{row.attendancePeople} / {row.employeeCount} 人</span><span>{compactHours(row.plannedMilliseconds)}</span><span>{compactHours(row.attendanceMilliseconds)}</span><span>{compactHours(row.standardLaborMilliseconds)}</span><span>{compactHours(row.exemptAbnormalMilliseconds)}</span><span><b>{percentText(row.attendanceBasisPoints)}</b></span><span><b>{percentText(row.attainmentBasisPoints)}</b></span></article>)}</div>{!rows.length && <EmptyState icon={<UsersRound />} title="当前月份没有班组工时数据" />}</Panel>;
}

function EmployeeTable({ rows, unmatchedOnly }: { rows: EmployeeAttainmentRowDTO[]; unmatchedOnly: boolean }) {
  return <Panel kicker="人员维度" title={unmatchedOnly ? '待匹配标准工时员工' : '员工出勤达成率与标准工时'} action={<span>{rows.length} 人</span>}><div className="report-employee-table"><div><span>员工</span><span>确认出勤</span><span>标准工时</span><span>待匹配</span><span>免责异常</span><span>报工记录</span><span>达成率</span></div>{rows.map(row => <article key={row.employee.id}><span><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.team || row.employee.department || '未分组'}</small></span><span><b>{compactHours(row.attendanceMilliseconds)}</b><small>{row.attendanceConfirmedDays} 人日</small></span><span><b>{compactHours(row.standardLaborMilliseconds)}</b><small>正式口径</small></span><span className={row.unmatchedStandardLaborMilliseconds ? 'danger' : ''}><b>{compactHours(row.unmatchedStandardLaborMilliseconds)}</b><small>{row.attendanceMissingDays} 人日缺失</small></span><span><b>{compactHours(row.exemptAbnormalMilliseconds)}</b><small>品质确认</small></span><span><b>{row.claimCount + row.executionCount} 笔</b><small>良品 {numberText(row.goodQty)}</small></span><span className="attainment"><strong>{percentText(row.attainmentBasisPoints)}</strong><i><b style={{ width: `${Math.min(100, (row.attainmentBasisPoints || 0) / 100)}%` }} /></i></span></article>)}</div>{!rows.length && <EmptyState icon={<UsersRound />} title={unmatchedOnly ? '当前周期没有待匹配工时' : '当前周期没有员工正式数据'} />}</Panel>;
}

function EmployeeMatrix({ report, rows }: { report: ReportOperationsDTO | null; rows: ReportOperationsEmployeeRowDTO[] }) {
  const dates = report?.dates || [];
  return <Panel kicker="员工 × 日期" title={`${report?.month || ''} 个人达成率矩阵`} action={<span>横向滚动查看完整月份</span>}><div className="report-matrix-scroll"><table><thead><tr><th>班组</th><th>岗位</th><th>员工</th>{dates.map(day => <th key={day.date} className={day.isWeekend ? 'weekend' : ''}><strong>{day.day}号</strong><small>{day.weekday}</small></th>)}<th>月均</th></tr></thead><tbody>{rows.map(row => <tr key={row.employee.id}><td>{row.team}</td><td>{row.position}</td><td><strong>{row.employee.name}</strong><small>{row.employee.employeeNo}</small></td>{dates.map(day => { const cell = row.days.find(item => item.date === day.date); const value = cell?.attainmentBasisPoints; const text = cell?.status === 'draft' ? '草稿' : cell?.status === 'rest' ? '休' : value === null || value === undefined ? '—' : percentText(value); return <td key={day.date} className={`status-${cell?.status || 'missing'} ${value !== null && value !== undefined && value < 8500 ? 'risk' : ''}`} title={`${row.employee.name} ${day.date}：${text}`}><strong>{text}</strong></td>; })}<td className="average"><strong>{percentText(row.attainmentBasisPoints)}</strong></td></tr>)}</tbody></table></div>{!rows.length && <EmptyState icon={<Table2 />} title="没有符合筛选条件的员工矩阵" />}</Panel>;
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

function FocusDrawer({ item, onClose }: { item: ReportCenterFocusItemDTO; onClose: () => void }) {
  return <div className="report-focus-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="report-focus-drawer" role="dialog" aria-modal="true" aria-label={`${item.code}详情`}><header><div><small>{item.entityType === 'workOrder' ? '量产工单' : '样品任务'}</small><h2>{item.code}</h2><p>{item.customerName} · {item.productName}</p></div><button type="button" aria-label="关闭详情" onClick={onClose}><X /></button></header><div className="report-focus-drawer-status"><span className={`risk-${item.risk}`}><AlertTriangle />{item.riskLabel}</span><strong>{item.statusLabel}</strong></div><dl><div><dt>规格</dt><dd>{item.specification}</dd></div><div><dt>完成进度</dt><dd>{percentText(item.progressBasisPoints)} · {item.completedQty ?? '—'} / {item.plannedQty ?? '—'} {item.unitLabel}</dd></div><div><dt>当前环节</dt><dd>{item.currentProcess || '未进入流程'}</dd></div><div><dt>下一环节</dt><dd>{item.nextProcess || '无后续环节'}</dd></div><div><dt>责任人</dt><dd>{item.owner || '待安排'}</dd></div><div><dt>计划交期</dt><dd>{dateOnly(item.dueAt)}</dd></div></dl><section><h3>资料与风险</h3>{item.missingData.length ? item.missingData.map(text => <p key={text}><FileWarning />{text}</p>) : <p className="ready"><FileCheck2 />核心资料检查已通过</p>}</section><footer><Link href={safeHref(item)} prefetch={false}>打开业务详情<ChevronRight /></Link></footer></aside></div>;
}
