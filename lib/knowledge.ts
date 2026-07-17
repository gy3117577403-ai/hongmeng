import type { Prisma } from '@prisma/client';
import type {
  KnowledgeArticleCategory,
  KnowledgeArticleDTO,
  KnowledgeArticleStatus,
  KnowledgeRelationDTO,
  KnowledgeSourceType,
} from '@/types';

export const KNOWLEDGE_CATEGORIES: KnowledgeArticleCategory[] = ['problem', 'process', 'inspection', 'equipment', 'packaging', 'general'];
export const KNOWLEDGE_STATUSES: KnowledgeArticleStatus[] = ['draft', 'published', 'archived'];
export const KNOWLEDGE_SOURCE_TYPES: KnowledgeSourceType[] = ['article', 'drawing', 'manual', 'parameter', 'process', 'issue', 'change'];

export const knowledgeArticleInclude = {
  createdBy: { select: { id: true, username: true, displayName: true } },
  updatedBy: { select: { id: true, username: true, displayName: true } },
  attachments: {
    where: { deletedAt: null },
    include: { uploadedBy: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
  },
  relations: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.KnowledgeArticleInclude;

export type KnowledgeArticleRecord = Prisma.KnowledgeArticleGetPayload<{ include: typeof knowledgeArticleInclude }>;

export type KnowledgeRelationInput = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceLabel?: string | null;
  sourceHref?: string | null;
};

export type KnowledgeArticleInput = {
  title?: string;
  category?: KnowledgeArticleCategory;
  status?: KnowledgeArticleStatus;
  summary?: string | null;
  content?: string;
  tags?: string[];
  customerName?: string | null;
  specification?: string | null;
  productModel?: string | null;
  relations?: KnowledgeRelationInput[];
};

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function nullableText(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function internalHref(value: unknown): string | null {
  const href = nullableText(value, 500);
  return href && href.startsWith('/') && !href.startsWith('//') ? href : null;
}

function uniqueTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLength);
    const key = text.toLocaleLowerCase('zh-CN');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function parseRelations(value: unknown): KnowledgeRelationInput[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const relations: KnowledgeRelationInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourceType = cleanText(record.sourceType, 32) as KnowledgeSourceType;
    const sourceId = cleanText(record.sourceId, 180);
    if (!KNOWLEDGE_SOURCE_TYPES.includes(sourceType) || sourceType === 'article' || !sourceId) continue;
    const key = `${sourceType}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({
      sourceType,
      sourceId,
      sourceLabel: nullableText(record.sourceLabel, 240),
      sourceHref: internalHref(record.sourceHref),
    });
    if (relations.length >= 24) break;
  }
  return relations;
}

export function parseKnowledgeArticleInput(body: Record<string, unknown>, partial = false): { data: KnowledgeArticleInput; errors: string[] } {
  const data: KnowledgeArticleInput = {};
  const errors: string[] = [];

  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 160);
    if (!title) errors.push('请输入知识标题');
    else data.title = title;
  }
  if (!partial || body.content !== undefined) {
    const content = cleanText(body.content, 30000);
    if (!content) errors.push('请输入知识内容');
    else data.content = content;
  }
  if (!partial || body.category !== undefined) {
    const category = cleanText(body.category, 32) as KnowledgeArticleCategory;
    if (!KNOWLEDGE_CATEGORIES.includes(category)) errors.push('知识分类不正确');
    else data.category = category;
  }
  if (!partial || body.status !== undefined) {
    const status = cleanText(body.status, 32) as KnowledgeArticleStatus;
    if (!KNOWLEDGE_STATUSES.includes(status)) errors.push('知识状态不正确');
    else data.status = status;
  }
  if (!partial || body.summary !== undefined) data.summary = nullableText(body.summary, 500);
  if (!partial || body.tags !== undefined) data.tags = uniqueTextList(body.tags, 16, 40);
  if (!partial || body.customerName !== undefined) data.customerName = nullableText(body.customerName, 160);
  if (!partial || body.specification !== undefined) data.specification = nullableText(body.specification, 180);
  if (!partial || body.productModel !== undefined) data.productModel = nullableText(body.productModel, 180);
  if (!partial || body.relations !== undefined) data.relations = parseRelations(body.relations);
  return { data, errors };
}

function user(value: KnowledgeArticleRecord['createdBy']) {
  return value ? { id: value.id, username: value.username, displayName: value.displayName } : null;
}

export function serializeKnowledgeArticle(article: KnowledgeArticleRecord): KnowledgeArticleDTO {
  return {
    id: article.id,
    sequence: article.sequence,
    code: `KB-${String(article.sequence).padStart(6, '0')}`,
    title: article.title,
    category: article.category as KnowledgeArticleCategory,
    status: article.status as KnowledgeArticleStatus,
    summary: article.summary,
    content: article.content,
    tags: article.tags,
    customerName: article.customerName,
    specification: article.specification,
    productModel: article.productModel,
    version: article.version,
    createdBy: user(article.createdBy),
    updatedBy: user(article.updatedBy),
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    attachmentCount: article.attachments.length,
    relationCount: article.relations.length,
    attachments: article.attachments.map(attachment => ({
      id: attachment.id,
      articleId: attachment.articleId,
      originalName: attachment.originalName,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      fileType: attachment.fileType,
      size: Number(attachment.size),
      uploadedBy: user(attachment.uploadedBy),
      createdAt: attachment.createdAt.toISOString(),
      contentUrl: `/api/knowledge/attachments/${attachment.id}/content`,
      downloadUrl: `/api/knowledge/attachments/${attachment.id}/download`,
    })),
    relations: article.relations.map((relation): KnowledgeRelationDTO => ({
      id: relation.id,
      articleId: relation.articleId,
      sourceType: relation.sourceType as KnowledgeSourceType,
      sourceId: relation.sourceId,
      sourceLabel: relation.sourceLabel,
      sourceHref: relation.sourceHref,
      createdAt: relation.createdAt.toISOString(),
    })),
  };
}

export function knowledgeArticleSnapshot(article: {
  id: string;
  title: string;
  category: string;
  status: string;
  summary?: string | null;
  content: string;
  tags: string[];
  customerName?: string | null;
  specification?: string | null;
  productModel?: string | null;
  version: number;
  deletedAt?: Date | string | null;
}) {
  return {
    id: article.id,
    title: article.title,
    category: article.category,
    status: article.status,
    summary: article.summary ?? null,
    content: article.content,
    tags: article.tags,
    customerName: article.customerName ?? null,
    specification: article.specification ?? null,
    productModel: article.productModel ?? null,
    version: article.version,
    deletedAt: article.deletedAt ?? null,
  };
}
