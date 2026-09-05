import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { QualityDataError, qualityText, beijingInput, type QualityActor } from './quality-data';
import { positivePage } from './quality-data-service';
import { referenceInput, resetStaleReferenceVerification, type QualityReference, type ReferenceInput } from './quality-reference';

export const referenceInclude = { attachments: { orderBy: { createdAt: 'asc' as const } } };
type Source = Prisma.QualityReferenceGetPayload<{ include: typeof referenceInclude }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function serializeReference(record: Source): QualityReference {
  const { searchText: _search, requestHash: _hash, idempotencyKey: _key, updatedById: _updated, ...rest } = record;
  return json({ ...rest, attachments: record.attachments.map(({ objectKey: _object, createdById: _actor, referenceId: _id, ...file }) => file) }) as unknown as QualityReference;
}
export async function referenceSnapshot(tx: Prisma.TransactionClient, id: string, actor: QualityActor, action: string, reason: string) {
  const record = await tx.qualityReference.findUniqueOrThrow({ where: { id }, include: referenceInclude });
  const snapshot = serializeReference(record);
  await tx.qualityReferenceRevision.create({ data: { referenceId: id, version: record.version, actorId: actor.id, actorName: actor.name, action, reason, snapshot: json(snapshot) } });
  return snapshot;
}
export async function lockReference(tx: Prisma.TransactionClient, id: string, version: unknown) {
  if (!Number.isInteger(version) || Number(version) < 1) throw new QualityDataError('缺少方案版本，请刷新后重试', 409);
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'quality-reference:' + id);
  const record = await tx.qualityReference.findUnique({ where: { id }, include: referenceInclude });
  if (!record) throw new QualityDataError('参考方案不存在', 404);
  if (record.version !== version) throw new QualityDataError('方案已被更新，请刷新后重新操作', 409, 'QUALITY_REFERENCE_VERSION_CONFLICT');
  return record;
}
export function assertReferenceEdit(actor: QualityActor, record: { deletedAt: unknown; createdById: string }) {
  if (record.deletedAt) throw new QualityDataError('方案在回收站中，请先恢复', 409);
  if (!actor.canManage && actor.id !== record.createdById) throw new QualityDataError('只能修改本人创建的参考方案', 403);
}
async function bindTerminal(tx: Prisma.TransactionClient, input: ReferenceInput, previous?: Source) {
  if (!input.terminalId) return;
  if (previous?.terminalId === input.terminalId) {
    input.terminalName = previous.terminalName; input.manufacturer = previous.manufacturer; return;
  }
  const terminal = await tx.terminalToolingTerminal.findFirst({ where: { id: input.terminalId, isActive: true } });
  if (!terminal) throw new QualityDataError('所选端子不存在或已停用');
  input.terminalName = terminal.specification; input.manufacturer = terminal.manufacturer || '';
}
const searchText = (input: ReferenceInput, files: string[] = []) => JSON.stringify(input) + ' ' + files.join(' ');
export async function createReference(actor: QualityActor, body: Record<string, unknown>) {
  const input = referenceInput(body), key = qualityText(body.idempotencyKey, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new QualityDataError('提交标识无效，请重新打开表单');
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'quality-reference-create:' + actor.id + ':' + key);
    const prior = await tx.qualityReference.findUnique({ where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey: key } }, include: referenceInclude });
    if (prior) {
      if (prior.requestHash !== hash) throw new QualityDataError('同一提交标识内容已变化，请打开已保存方案后编辑', 409);
      return serializeReference(prior);
    }
    await bindTerminal(tx, input);
    const id = randomUUID();
    await tx.qualityReference.create({ data: { ...input, data: json(input.data), id, code: 'QR-' + beijingInput().slice(0,10).replaceAll('-','') + '-' + id.slice(0,8).toUpperCase(),
      createdById: actor.id, createdByName: actor.name, updatedById: actor.id, idempotencyKey: key, requestHash: hash, searchText: searchText(input) } });
    return referenceSnapshot(tx, id, actor, 'CREATE', '新建端子参考方案');
  });
}
export async function mutateReference(id: string, actor: QualityActor, body: Record<string, unknown>) {
  return prisma.$transaction(async tx => {
    const current = await lockReference(tx, id, body.version);
    const reason = qualityText(body.reason, 1000), action = String(body.action || 'SAVE');
    let update: Prisma.QualityReferenceUpdateInput = { version: { increment: 1 }, updatedById: actor.id };
    if (action === 'RESTORE') {
      if (!actor.canManage) throw new QualityDataError('只有质量人员和管理员可以恢复方案', 403);
      if (!current.deletedAt) throw new QualityDataError('方案不在回收站', 409);
      if (!reason) throw new QualityDataError('请填写恢复原因');
      update.deletedAt = null; update.deleteReason = null;
    } else {
      assertReferenceEdit(actor, current);
      if (action === 'DELETE') {
        if (!reason) throw new QualityDataError('请填写删除原因');
        update.deletedAt = new Date(); update.deleteReason = reason;
      } else if (action === 'SAVE') {
        let input = referenceInput(body);
        await bindTerminal(tx, input, current);
        input = resetStaleReferenceVerification(input, serializeReference(current));
        if (current.status !== 'DRAFT' && !reason) throw new QualityDataError('修改在用或停用方案，请填写变更说明');
        const { terminalId, data, ...values } = input;
        update = { ...update, ...values, terminal: terminalId ? { connect: { id: terminalId } } : { disconnect: true }, data: json(data), searchText: searchText(input, current.attachments.filter(f => !f.deletedAt).map(f => f.originalName)) };
      } else throw new QualityDataError('操作类型无效');
    }
    await tx.qualityReference.update({ where: { id }, data: update });
    return referenceSnapshot(tx, id, actor, action, reason || '保存参数方案');
  });
}
export async function loadReference(id: string, userId: string) {
  const record = await prisma.qualityReference.findUnique({ where: { id }, include: referenceInclude });
  if (!record) throw new QualityDataError('参考方案不存在', 404);
  const favorite = await prisma.qualityReferenceFavorite.findUnique({ where: { referenceId_userId: { referenceId: id, userId } } });
  return { ...serializeReference(record), favorite: Boolean(favorite) };
}
export function referenceWhere(params: URLSearchParams, userId: string): Prisma.QualityReferenceWhereInput {
  const q = qualityText(params.get('q'),160), terminalName = qualityText(params.get('terminalName'),160), manufacturer = qualityText(params.get('manufacturer'),160);
  const where: Prisma.QualityReferenceWhereInput = { deletedAt: params.get('deleted') === '1' ? { not: null } : null };
  if (q) where.searchText = { contains: q, mode: 'insensitive' };
  if (terminalName) { where.terminalName = terminalName; where.manufacturer = manufacturer; }
  if (params.get('status')) {
    const status = params.get('status')!;
    if (!['ACTIVE','DRAFT','INACTIVE'].includes(status)) throw new QualityDataError('方案状态无效');
    where.status = status;
  }
  if (params.get('favorite') === '1') where.favorites = { some: { userId } };
  return where;
}
export async function listReferences(params: URLSearchParams, userId: string) {
  const where = referenceWhere(params, userId), page = positivePage(params.get('page'));
  const [total, records, terminals] = await prisma.$transaction([
    prisma.qualityReference.count({ where }),
    prisma.qualityReference.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page-1)*20, take: 20, include: { ...referenceInclude, favorites: { where: { userId }, select: { userId: true } } } }),
    prisma.qualityReference.groupBy({ by: ['terminalName','manufacturer'], where: { ...where, terminalName: undefined, manufacturer: undefined }, _count: true, orderBy: { terminalName: 'asc' }, take: 501 }),
  ]);
  return { total, page, items: records.map(({ favorites, ...record }) => ({ ...serializeReference(record), favorite: Boolean(favorites.length) })), terminals: terminals.slice(0,500), terminalsTruncated: terminals.length > 500 };
}
export async function favoriteReference(id: string, userId: string, value: unknown) {
  if (typeof value !== 'boolean') throw new QualityDataError('收藏状态无效');
  const record = await prisma.qualityReference.findFirst({ where: { id, deletedAt: null } });
  if (!record) throw new QualityDataError('方案不存在或已删除', 404);
  if (value) await prisma.qualityReferenceFavorite.upsert({ where: { referenceId_userId: { referenceId: id, userId } }, create: { referenceId: id, userId }, update: {} });
  else await prisma.qualityReferenceFavorite.deleteMany({ where: { referenceId: id, userId } });
  return loadReference(id, userId);
}
export async function referenceHistory(id: string, page: number) {
  const [total, items] = await prisma.$transaction([
    prisma.qualityReferenceRevision.count({ where: { referenceId: id } }),
    prisma.qualityReferenceRevision.findMany({ where: { referenceId: id }, orderBy: { version: 'desc' }, skip: (page-1)*20, take: 20, select: { version: true, action: true, reason: true, actorName: true, createdAt: true } }),
  ]);
  return { total, items, page };
}
export async function referenceVersion(id: string, version: number) {
  const revision = await prisma.qualityReferenceRevision.findUnique({ where: { referenceId_version: { referenceId: id, version } } });
  if (!revision) throw new QualityDataError('历史版本不存在', 404);
  return revision.snapshot as unknown as QualityReference;
}
export async function exportReferences(params: URLSearchParams, userId: string) {
  const records = await prisma.qualityReference.findMany({ where: referenceWhere(params,userId), take: 5001, include: referenceInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
  if (records.length > 5000) throw new QualityDataError('超过 5000 套方案，请缩小筛选范围', 413);
  return records.map(serializeReference);
}
