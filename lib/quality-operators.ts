import { Prisma } from '@prisma/client';
import { InternalQualityRiskError } from './internal-quality-risks';
import { qualityOperators, type QualityOperator, type QualityOperatorAssignments } from './quality-direct-shared';
export async function resolveQualityOperators(tx: Prisma.TransactionClient, value: unknown, previous: unknown = []): Promise<QualityOperator[]> {
  if (!Array.isArray(value) || value.length > 100) throw new InternalQualityRiskError('作业人员最多选择 100 人');
  const ids = [...new Set(value.map(item => typeof item === 'string' ? item : item?.id))];
  if (ids.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new InternalQualityRiskError('作业人员数据无效');
  const employees = await tx.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, employeeNo: true, name: true, department: true, team: true } });
  const old = qualityOperators(previous);
  return ids.map(id => {
    const person = employees.find(item => item.id === id);
    if (person) return { ...person, department: person.department || '', team: person.team || '' };
    const retained = old.find(item => item.id === id);
    if (retained) return retained;
    throw new InternalQualityRiskError('所选作业人员不存在或已停用，请重新选择');
  });
}
export async function resolveQualityOperatorAssignments(tx: Prisma.TransactionClient, value: unknown, userIds: string[], previous: unknown = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InternalQualityRiskError('作业人员分组无效');
  const result: QualityOperatorAssignments = {};
  for (const [userId, operators] of Object.entries(value)) {
    if (!userIds.includes(userId)) throw new InternalQualityRiskError('作业人员必须关联到已选择的主要责任人');
    result[userId] = await resolveQualityOperators(tx, operators, (previous as QualityOperatorAssignments)?.[userId]);
  }
  return result;
}
