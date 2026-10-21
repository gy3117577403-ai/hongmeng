import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { knowledgeArticleInclude, parseKnowledgeArticleInput } from '@/lib/knowledge';
import { queueKnowledgePreviews } from '@/lib/knowledge-preview';

export class KnowledgeWriteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Tx = Prisma.TransactionClient;

export async function lockKnowledgeArticle(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM knowledge_articles WHERE id = ${id} FOR UPDATE`;
  const article = await tx.knowledgeArticle.findFirst({ where: { id, deletedAt: null }, include: knowledgeArticleInclude });
  if (!article) throw new KnowledgeWriteError('知识文章不存在或已删除', 404);
  return article;
}

function attachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(value).size !== value.length)
    throw new KnowledgeWriteError('附件选择无效，每次最多保存 30 个附件');
  return value;
}

export async function saveKnowledgeArticle(body: Record<string, unknown>, userId: string, id?: string) {
  const ids = attachmentIds(body.attachmentIds);
  return prisma.$transaction(async tx => {
    const before = id ? await lockKnowledgeArticle(tx, id) : null;
    if (before && body.version !== undefined && Number(body.version) !== before.version)
      throw new KnowledgeWriteError('该知识已被其他人更新，请刷新后重试；输入内容已保留', 409);
    const staged = await tx.knowledgeAttachment.findMany({ where: { id: { in: ids }, articleId: null, deletedAt: null, uploadedById: userId } });
    if (staged.length !== ids.length) throw new KnowledgeWriteError('附件不存在、已被关联或不属于本次上传，请重新选择', 409);
    const merged = before ? { ...body, content: body.content === undefined ? before.content : body.content } : { category: 'general', status: 'published', ...body };
    const parsed = parseKnowledgeArticleInput(merged, !!before, (before?.attachments.length || 0) + staged.length);
    if (parsed.errors.length) throw new KnowledgeWriteError(parsed.errors[0]);
    const { relations, ...values } = parsed.data;
    const article = before
      ? await tx.knowledgeArticle.update({ where: { id: before.id }, data: { ...values, updatedById: userId, version: { increment: 1 } } })
      : await tx.knowledgeArticle.create({ data: { ...values, title: values.title!, content: values.content!, createdById: userId, updatedById: userId } });
    if (ids.length) {
      const bound = await tx.knowledgeAttachment.updateMany({ where: { id: { in: ids }, articleId: null, uploadedById: userId, deletedAt: null }, data: { articleId: article.id } });
      if (bound.count !== ids.length) throw new KnowledgeWriteError('附件已被其他操作使用，请核对后重试', 409);
      await queueKnowledgePreviews(tx, staged);
    }
    if (relations !== undefined) {
      await tx.knowledgeRelation.deleteMany({ where: { articleId: article.id } });
      if (relations.length) await tx.knowledgeRelation.createMany({ data: relations.map(relation => ({ articleId: article.id, ...relation })) });
    }
    return { before, article: await tx.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id }, include: knowledgeArticleInclude }) };
  });
}

export async function removeKnowledgeAttachment(id: string, userId: string) {
  return prisma.$transaction(async tx => {
    const attachment = await tx.knowledgeAttachment.findFirst({ where: { id, deletedAt: null } });
    if (!attachment) throw new KnowledgeWriteError('附件不存在或已删除', 404);
    if (!attachment.articleId) {
      const removed = await tx.knowledgeAttachment.updateMany({ where: { id, articleId: null, uploadedById: userId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (removed.count !== 1) throw new KnowledgeWriteError('附件已被关联或不属于本次上传', 409);
      return null;
    }
    const current = await lockKnowledgeArticle(tx, attachment.articleId);
    if (!current.content.trim() && current.attachments.filter(file => file.id !== id).length === 0)
      throw new KnowledgeWriteError('请先补充知识正文或上传替代文件，不能移除最后一个附件');
    await tx.knowledgeAttachment.update({ where: { id }, data: { deletedAt: new Date() } });
    return tx.knowledgeArticle.update({ where: { id: current.id }, data: { updatedById: userId, version: { increment: 1 } }, include: knowledgeArticleInclude });
  });
}
