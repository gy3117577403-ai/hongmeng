import type { Prisma } from '@prisma/client';
import { assertQualityResponsibility, ProcessQualityError, type ProcessQualityReport } from './process-quality-report';

/** Names are snapshotted from employee records, never accepted from the browser. */
export async function resolveQualityResponsibility(tx: Prisma.TransactionClient, report: ProcessQualityReport, defectQty: number) {
  assertQualityResponsibility(report, defectQty);
  const ids = report.responsibility.allocations.map(row => row.employeeId);
  const employees = await tx.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, name: true, employeeNo: true } });
  if (employees.length !== ids.length) throw new ProcessQualityError('所选责任人已停用或不存在，请重新选择');
  return {
    status: report.responsibility.status,
    allocations: report.responsibility.allocations.map(row => {
      const employee = employees.find(item => item.id === row.employeeId)!;
      return { ...row, name: employee.name, employeeNo: employee.employeeNo };
    }),
  };
}
