import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ProcessCompletion } from '@prisma/client';
import { emptyQualityForm, type QualityActor } from './quality-data';
import { readQualityOrder, snapshotQuality } from './quality-data-service';
import { emptyProcessQualityReport, processQualityType, PROCESS_QUALITY_LABELS, ProcessQualityError, type ProcessQualityReport } from './process-quality-report';
import { resolveQualityResponsibility } from './process-quality-personnel';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Called in the completion transaction. Coverage/labor matching never creates a second inspection. */
export async function recordProcessQuality(tx: Prisma.TransactionClient, completion: ProcessCompletion,
  step: { processName: string; position: number }, request: ProcessQualityReport | null, actorName: string) {
  const type = processQualityType(step.processName);
  if (!type) {
    if (request) throw new ProcessQualityError('当前工序无需填写检验质量信息');
    return null;
  }
  const report = request || emptyProcessQualityReport();
  if (!completion.createdById) throw new ProcessQualityError('报工缺少登录身份');
  const total = completion.reportedUnitQty, bad = completion.reportedDefectUnitQty;
  const responsibility = await resolveQualityResponsibility(tx, report, bad);
  const evidence = await tx.processQualityEvidence.findMany({ where: {
    id: { in: report.evidenceIds }, routeId: completion.routeId, stepId: completion.stepId,
    createdById: completion.createdById, deletedAt: null, recordId: null,
  } });
  if (evidence.length !== report.evidenceIds.length) throw new ProcessQualityError('质量照片已被使用、移除或不属于当前报工，请重新选择', 409);
  const participants = await tx.processCompletionParticipant.findMany({ where: { completionId: completion.id }, include: { employee: { select: { name: true } } }, orderBy: { position: 'asc' } });
  const inspector = participants.map(person => person.employee.name).join('、') || actorName;
  const data = emptyQualityForm(type, inspector);
  data.context = { ...data.context, processName: step.processName, team: completion.team || '', workstation: completion.workstation || '',
    method: '工序报工', inspectionQty: String(total), sampleQty: '', defectQty: String(bad) };
  data.rows = []; // Quantity reporting does not fabricate appearance, dimension or electrical measurements.
  data.summary = [report.issue, report.note].filter(Boolean).join('；');
  const orderSnapshot = await readQualityOrder(tx, completion.workOrderId);
  const reportSnapshot = { completionId: completion.id, routeId: completion.routeId, stepId: completion.stepId,
    position: step.position, processName: step.processName, quantity: total, defectQty: bad, goodQty: total - bad,
    unit: completion.reportUnitLabel || '件', quantityBasis: completion.reportQuantityBasis,
    productQuantity: completion.processedQty, productDefectQty: completion.defectQty,
    workDate: completion.workDate.toISOString().slice(0, 10), reportedAt: completion.completedAt.toISOString(),
    inspectedBy: inspector, source: completion.reportSource, issue: report.issue, note: report.note };
  const id = randomUUID(), title = `${String(step.position).padStart(2, '0')} · ${step.processName}`;
  const actor: QualityActor = { id: completion.createdById, name: actorName, canManage: false, canReview: false };
  const record = await tx.qualityDataRecord.create({ data: {
    id, code: `QD-${reportSnapshot.workDate.replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`,
    workOrderId: completion.workOrderId, sourceCompletionId: completion.id, type, title,
    // Beijing working day, not the later submission/matching date.
    inspectedAt: new Date(reportSnapshot.workDate + 'T00:00:00+08:00'), submittedAt: completion.completedAt,
    status: 'SUBMITTED', result: bad > 0 ? 'FAIL' : 'PASS', templateVersion: 2,
    data: json(data), orderSnapshot: json(orderSnapshot), reportSnapshot: json(reportSnapshot),
    responsibilityStatus: bad > 0 ? responsibility.status : 'NONE', responsibility: json(responsibility),
    searchText: [title, PROCESS_QUALITY_LABELS[type], inspector, JSON.stringify(orderSnapshot), JSON.stringify(data), JSON.stringify(responsibility)].join(' '),
    createdById: actor.id, createdByName: actor.name, updatedById: actor.id,
    idempotencyKey: 'completion_' + completion.id, requestHash: createHash('sha256').update(JSON.stringify(reportSnapshot)).digest('hex'),
  } });
  for (const file of evidence) {
    const claimed = await tx.processQualityEvidence.updateMany({ where: { id: file.id, recordId: null, deletedAt: null }, data: { recordId: record.id } });
    if (claimed.count !== 1) throw new ProcessQualityError('质量照片刚被其他申报使用，请重新选择', 409);
    await tx.qualityDataAttachment.create({ data: { recordId: record.id, originalName: file.originalName, mimeType: file.mimeType,
      size: file.size, sha256: file.sha256, objectKey: file.objectKey, createdById: actor.id } });
  }
  return snapshotQuality(tx, record.id, actor, 'REPORT_SUBMIT', '随工序报工自动记录');
}

export async function voidProcessQuality(tx: Prisma.TransactionClient, completionId: string, actor: QualityActor, reason: string) {
  const record = await tx.qualityDataRecord.findUnique({ where: { sourceCompletionId: completionId } });
  if (!record || record.deletedAt) return;
  // Optimistic update also protects a concurrent responsibility/review change under serializable isolation.
  await tx.qualityDataRecord.update({ where: { id: record.id }, data: {
    version: { increment: 1 }, deletedAt: new Date(), deletedById: actor.id, deleteReason: '原报工撤回：' + reason, updatedById: actor.id,
  } });
  await snapshotQuality(tx, record.id, actor, 'REPORT_WITHDRAW', reason);
}
