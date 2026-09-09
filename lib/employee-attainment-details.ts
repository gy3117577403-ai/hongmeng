import type { EmployeeAttainmentRowDTO } from '@/types';
import { chinaDateKey } from '@/lib/china-date';

export type EmployeeAttainmentDetail = {
  id: string;
  source: 'claim' | 'execution';
  date: string;
  workOrderCode: string;
  productName: string | null;
  specification: string | null;
  processCode: string;
  processName: string;
  quantity: number;
  unitLabel: string;
  standardLaborMilliseconds: number;
  recordedLaborMilliseconds: number;
  countsForEfficiency: boolean;
};

export function employeeAttainmentDetails(
  row: Pick<EmployeeAttainmentRowDTO, 'claimDetails' | 'details'>,
): EmployeeAttainmentDetail[] {
  return [
    ...row.claimDetails.map(item => ({
      id: `claim:${item.id}`,
      source: 'claim' as const,
      date: item.workDate,
      workOrderCode: item.workOrderCode,
      productName: item.productName,
      specification: item.specification || null,
      processCode: item.processCode,
      processName: item.processName,
      quantity: item.quantity,
      unitLabel: item.unitLabel,
      standardLaborMilliseconds: item.countsForEfficiency === false ? 0 : item.standardLaborMilliseconds,
      recordedLaborMilliseconds: item.standardLaborMilliseconds,
      countsForEfficiency: item.countsForEfficiency !== false,
    })),
    ...row.details.map(item => ({
      id: `execution:${item.id}`,
      source: 'execution' as const,
      date: chinaDateKey(new Date(item.endedAt)),
      workOrderCode: item.workOrderCode,
      productName: item.productName,
      specification: item.specification || null,
      processCode: item.processCode,
      processName: item.processName,
      quantity: item.goodQty,
      unitLabel: item.unitLabel,
      standardLaborMilliseconds: item.countsForEfficiency === false ? 0 : item.standardLaborMilliseconds,
      recordedLaborMilliseconds: item.standardLaborMilliseconds,
      countsForEfficiency: item.countsForEfficiency !== false,
    })),
  ];
}

export const EMPLOYEE_ATTAINMENT_DETAIL_HEADERS = [
  '日期', '员工编号', '员工姓名', '班组', '产品型号', '产品名称', '工序编号', '工序名称',
  '工单编号', '记录来源', '数量', '单位', '可计入完成工时（小时）', '记录工时（小时）', '工序计入规则',
];

export function employeeAttainmentDetailExportRows(rows: readonly EmployeeAttainmentRowDTO[]) {
  return rows.flatMap(row => employeeAttainmentDetails(row).map(item => [
    item.date, row.employee.employeeNo, row.employee.name, row.employee.team || '',
    item.specification || '型号未维护', item.productName || '', item.processCode, item.processName,
    item.workOrderCode, item.source === 'claim' ? '个人工时入账' : '直接报工',
    item.quantity, item.unitLabel, item.standardLaborMilliseconds / 3_600_000,
    item.recordedLaborMilliseconds / 3_600_000, item.countsForEfficiency ? '计入完成工时' : '仅记录，不计达成',
  ]));
}
