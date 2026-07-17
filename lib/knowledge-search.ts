import type { Prisma } from '@prisma/client';
import { serializeConnectorParameter } from '@/lib/connector-parameters';
import { serializeManual } from '@/lib/connector-assembly-manuals';
import { isVisibleDrawingLibraryItem, serializeDrawingLibraryItem } from '@/lib/drawing-library';
import { knowledgeArticleInclude, serializeKnowledgeArticle } from '@/lib/knowledge';
import { prisma } from '@/lib/prisma';
import type {
  ConnectorAssemblyManualDTO,
  ConnectorParameterDTO,
  DrawingLibraryItemDTO,
  KnowledgeArticleCategory,
  KnowledgeArticleDTO,
  KnowledgePreviewDTO,
  KnowledgeSearchItemDTO,
  KnowledgeSourceType,
} from '@/types';

type SearchOptions = {
  keyword: string;
  source: 'all' | KnowledgeSourceType;
  category: 'all' | KnowledgeArticleCategory;
  limit: number;
};

function excerpt(...values: Array<string | null | undefined>): string | null {
  const value = values.map(item => item?.trim()).find(Boolean) || '';
  if (!value) return null;
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

function matches(source: SearchOptions['source'], expected: KnowledgeSourceType): boolean {
  return source === 'all' || source === expected;
}

function articlePreview(article: KnowledgeArticleDTO): KnowledgePreviewDTO | null {
  const attachment = article.attachments.find(item => item.fileType === 'pdf' || ['jpg', 'png', 'webp'].includes(item.fileType));
  if (!attachment) return null;
  return {
    fileId: attachment.id,
    title: attachment.displayName || attachment.originalName,
    fileType: attachment.fileType === 'pdf' ? 'pdf' : 'image',
    contentUrl: attachment.contentUrl,
    downloadUrl: attachment.downloadUrl,
  };
}

function drawingPreview(drawing: DrawingLibraryItemDTO): KnowledgePreviewDTO | null {
  const file = drawing.files.find(item => item.fileType === 'pdf' || item.fileType === 'image');
  if (!file) return null;
  return {
    fileId: file.id,
    title: file.displayName || file.originalName,
    fileType: file.fileType === 'pdf' ? 'pdf' : 'image',
    contentUrl: file.contentUrl,
    downloadUrl: file.downloadUrl,
  };
}

function manualPreview(manual: ConnectorAssemblyManualDTO): KnowledgePreviewDTO | null {
  const asset = manual.latestVersion?.assets.find(item => item.assetType === 'PDF' || item.assetType === 'IMAGE');
  if (!asset) return null;
  return {
    fileId: asset.id,
    title: asset.displayName || asset.originalName,
    fileType: asset.assetType === 'PDF' ? 'pdf' : 'image',
    contentUrl: asset.contentUrl,
    downloadUrl: asset.downloadUrl,
  };
}

async function searchArticles(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'article')) return [];
  const where: Prisma.KnowledgeArticleWhereInput = { deletedAt: null };
  if (options.category !== 'all') where.category = options.category;
  if (options.keyword) {
    where.OR = [
      { title: { contains: options.keyword, mode: 'insensitive' } },
      { summary: { contains: options.keyword, mode: 'insensitive' } },
      { content: { contains: options.keyword, mode: 'insensitive' } },
      { customerName: { contains: options.keyword, mode: 'insensitive' } },
      { specification: { contains: options.keyword, mode: 'insensitive' } },
      { productModel: { contains: options.keyword, mode: 'insensitive' } },
      { tags: { has: options.keyword } },
    ];
  }
  const records = await prisma.knowledgeArticle.findMany({ where, include: knowledgeArticleInclude, orderBy: { updatedAt: 'desc' }, take });
  return records.map(record => {
    const article = serializeKnowledgeArticle(record);
    return {
      key: `article:${article.id}`,
      sourceType: 'article',
      sourceId: article.id,
      title: article.title,
      subtitle: `${article.code} · V${article.version}`,
      summary: excerpt(article.summary, article.content),
      sourceHref: `/workspace/knowledge?source=article&q=${encodeURIComponent(article.title)}&articleId=${encodeURIComponent(article.id)}`,
      updatedAt: article.updatedAt,
      badges: [article.status, ...article.tags.slice(0, 2)],
      customerName: article.customerName,
      specification: article.specification,
      productModel: article.productModel,
      category: article.category,
      preview: articlePreview(article),
      article,
    };
  });
}

async function searchDrawings(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'drawing')) return [];
  const where: Prisma.DrawingLibraryItemWhereInput = { deletedAt: null };
  if (options.keyword) {
    where.OR = [
      { customerName: { contains: options.keyword, mode: 'insensitive' } },
      { customerCode: { contains: options.keyword, mode: 'insensitive' } },
      { specification: { contains: options.keyword, mode: 'insensitive' } },
      { productName: { contains: options.keyword, mode: 'insensitive' } },
      { remark: { contains: options.keyword, mode: 'insensitive' } },
      { files: { some: { deletedAt: null, OR: [{ originalName: { contains: options.keyword, mode: 'insensitive' } }, { displayName: { contains: options.keyword, mode: 'insensitive' } }] } } },
    ];
  }
  const [categories, records] = await Promise.all([
    prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.drawingLibraryItem.findMany({
      where,
      include: { files: { where: { deletedAt: null }, include: { category: true, uploadedBy: { select: { displayName: true, username: true } } }, orderBy: [{ updatedAt: 'desc' }] } },
      orderBy: { updatedAt: 'desc' },
      take,
    }),
  ]);
  return records.filter(isVisibleDrawingLibraryItem).map(record => {
    const drawing = serializeDrawingLibraryItem(record, categories) as DrawingLibraryItemDTO;
    return {
      key: `drawing:${drawing.id}`,
      sourceType: 'drawing',
      sourceId: drawing.id,
      title: drawing.specification,
      subtitle: drawing.customerName,
      summary: excerpt(drawing.productName, drawing.remark),
      sourceHref: `/drawing-library?itemId=${encodeURIComponent(drawing.id)}`,
      updatedAt: drawing.updatedAt,
      badges: [`${drawing.fileCount} 个文件`, drawing.isComplete ? '资料完整' : '资料待补'],
      customerName: drawing.customerName,
      specification: drawing.specification,
      preview: drawingPreview(drawing),
      drawing,
    };
  });
}

async function searchManuals(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'manual')) return [];
  const where: Prisma.ConnectorAssemblyManualWhereInput = { deletedAt: null };
  if (options.keyword) {
    where.OR = [
      { title: { contains: options.keyword, mode: 'insensitive' } },
      { manufacturer: { contains: options.keyword, mode: 'insensitive' } },
      { family: { contains: options.keyword, mode: 'insensitive' } },
      { documentNo: { contains: options.keyword, mode: 'insensitive' } },
      { summary: { contains: options.keyword, mode: 'insensitive' } },
      { keywords: { contains: options.keyword, mode: 'insensitive' } },
      { versions: { some: { deletedAt: null, searchText: { contains: options.keyword, mode: 'insensitive' } } } },
      { bindings: { some: { connectorParameter: { deletedAt: null, model: { contains: options.keyword, mode: 'insensitive' } } } } },
    ];
  }
  const records = await prisma.connectorAssemblyManual.findMany({
    where,
    include: {
      versions: { where: { deletedAt: null }, include: { assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }, orderBy: [{ isLatest: 'desc' }, { issuedAt: 'desc' }, { createdAt: 'desc' }] },
      bindings: { where: { connectorParameter: { deletedAt: null } }, include: { connectorParameter: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return records.map(record => {
    const manual = serializeManual(record) as ConnectorAssemblyManualDTO;
    return {
      key: `manual:${manual.id}`,
      sourceType: 'manual',
      sourceId: manual.id,
      title: manual.title,
      subtitle: [manual.manufacturer, manual.documentNo].filter(Boolean).join(' · ') || null,
      summary: excerpt(manual.summary, manual.keywords),
      sourceHref: `/connector-assembly-manuals?manualId=${encodeURIComponent(manual.id)}`,
      updatedAt: manual.updatedAt,
      badges: [`${manual.versionCount} 个版本`, `${manual.bindingCount} 个型号`],
      productModel: manual.models[0] || null,
      preview: manualPreview(manual),
      manual,
    };
  });
}

async function searchParameters(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'parameter')) return [];
  const where: Prisma.ConnectorParameterWhereInput = { deletedAt: null };
  if (options.keyword) {
    where.OR = [
      { model: { contains: options.keyword, mode: 'insensitive' } },
      { outerPeelMm: { contains: options.keyword, mode: 'insensitive' } },
      { innerPeelMm: { contains: options.keyword, mode: 'insensitive' } },
      { insertionLengthMm: { contains: options.keyword, mode: 'insensitive' } },
      { remark: { contains: options.keyword, mode: 'insensitive' } },
    ];
  }
  const records = await prisma.connectorParameter.findMany({
    where,
    include: { _count: { select: { assemblyManualBindings: { where: { manual: { deletedAt: null } } } } } },
    orderBy: [{ isHighlighted: 'desc' }, { updatedAt: 'desc' }],
    take,
  });
  return records.map(record => {
    const parameter = serializeConnectorParameter(record) as ConnectorParameterDTO;
    const values = [
      parameter.outerPeelMm ? `外剥 ${parameter.outerPeelMm}` : '',
      parameter.innerPeelMm ? `内剥 ${parameter.innerPeelMm}` : '',
      parameter.insertionLengthMm ? `入长 ${parameter.insertionLengthMm}` : '',
    ].filter(Boolean);
    return {
      key: `parameter:${parameter.id}`,
      sourceType: 'parameter',
      sourceId: parameter.id,
      title: parameter.model || '未命名连接器参数',
      subtitle: values.join(' · ') || '参数待补充',
      summary: excerpt(parameter.remark),
      sourceHref: `/connector-parameters?parameterId=${encodeURIComponent(parameter.id)}`,
      updatedAt: parameter.updatedAt,
      badges: [parameter.isHighlighted ? '重点参数' : '连接器参数', `${parameter.manualCount || 0} 份说明书`],
      productModel: parameter.model,
      parameter,
    };
  });
}

async function searchProcesses(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'process')) return [];
  const where: Prisma.ProcessDefinitionWhereInput = { isActive: true };
  if (options.keyword) where.OR = [{ code: { contains: options.keyword, mode: 'insensitive' } }, { name: { contains: options.keyword, mode: 'insensitive' } }, { timeStandards: { some: { remark: { contains: options.keyword, mode: 'insensitive' } } } }];
  const records = await prisma.processDefinition.findMany({ where, include: { timeStandards: { where: { isCurrent: true }, orderBy: { version: 'desc' }, take: 1 } }, orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], take });
  return records.map(record => {
    const standard = record.timeStandards[0];
    const milliseconds = standard ? standard.standardMillisecondsPerUnit + standard.setupMilliseconds : null;
    return {
      key: `process:${record.id}`,
      sourceType: 'process',
      sourceId: record.id,
      title: record.name,
      subtitle: `${record.code} · ${record.stageGroup === 'frontend' ? '前端' : record.stageGroup === 'backend' ? '后端' : '完工'}`,
      summary: standard ? `当前标准 V${standard.version}，${(milliseconds as number / 1000).toFixed(1)} 秒/${standard.unitLabel}` : '当前工序尚未设置标准工时',
      sourceHref: `/workspace/time-standards?processId=${encodeURIComponent(record.id)}`,
      updatedAt: record.updatedAt.toISOString(),
      badges: [standard ? '已有标准工时' : '待设工时', record.stageGroup],
    };
  });
}

async function searchIssues(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'issue')) return [];
  const where: Prisma.IssueWhereInput = { deletedAt: null, status: 'closed' };
  if (options.keyword) where.OR = [{ title: { contains: options.keyword, mode: 'insensitive' } }, { description: { contains: options.keyword, mode: 'insensitive' } }, { rootCause: { contains: options.keyword, mode: 'insensitive' } }, { solution: { contains: options.keyword, mode: 'insensitive' } }, { sourceCode: { contains: options.keyword, mode: 'insensitive' } }, { workOrder: { specification: { contains: options.keyword, mode: 'insensitive' } } }];
  const records = await prisma.issue.findMany({ where, include: { workOrder: { select: { customerName: true, specification: true, code: true } } }, orderBy: { updatedAt: 'desc' }, take });
  return records.map(record => ({
    key: `issue:${record.id}`,
    sourceType: 'issue',
    sourceId: record.id,
    title: record.title,
    subtitle: `ISS-${String(record.sequence).padStart(6, '0')} · 已关闭`,
    summary: excerpt(record.solution, record.rootCause, record.description),
    sourceHref: `/workspace/issues?issueId=${encodeURIComponent(record.id)}`,
    updatedAt: record.updatedAt.toISOString(),
    badges: [record.type, record.priority],
    customerName: record.workOrder?.customerName,
    specification: record.workOrder?.specification,
  }));
}

async function searchChanges(options: SearchOptions, take: number): Promise<KnowledgeSearchItemDTO[]> {
  if (!matches(options.source, 'change')) return [];
  const where: Prisma.ChangeRequestWhereInput = { deletedAt: null };
  if (options.keyword) where.OR = [{ title: { contains: options.keyword, mode: 'insensitive' } }, { reason: { contains: options.keyword, mode: 'insensitive' } }, { description: { contains: options.keyword, mode: 'insensitive' } }, { impactScope: { contains: options.keyword, mode: 'insensitive' } }, { implementationResult: { contains: options.keyword, mode: 'insensitive' } }, { validationResult: { contains: options.keyword, mode: 'insensitive' } }, { workOrder: { specification: { contains: options.keyword, mode: 'insensitive' } } }];
  const records = await prisma.changeRequest.findMany({ where, include: { workOrder: { select: { customerName: true, specification: true, code: true } } }, orderBy: { updatedAt: 'desc' }, take });
  return records.map(record => ({
    key: `change:${record.id}`,
    sourceType: 'change',
    sourceId: record.id,
    title: record.title,
    subtitle: `CHG-${String(record.sequence).padStart(6, '0')} · ${record.status}`,
    summary: excerpt(record.implementationResult, record.validationResult, record.description, record.reason),
    sourceHref: `/workspace/changes?changeId=${encodeURIComponent(record.id)}`,
    updatedAt: record.updatedAt.toISOString(),
    badges: [record.type, record.priority],
    customerName: record.workOrder?.customerName,
    specification: record.workOrder?.specification,
  }));
}

export async function searchKnowledge(options: SearchOptions): Promise<KnowledgeSearchItemDTO[]> {
  const perSource = options.source === 'all' ? Math.min(options.limit, 12) : options.limit;
  const groups = await Promise.all([
    searchArticles(options, perSource),
    searchDrawings(options, perSource),
    searchManuals(options, perSource),
    searchParameters(options, perSource),
    searchProcesses(options, perSource),
    searchIssues(options, perSource),
    searchChanges(options, perSource),
  ]);
  return groups.flat().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, options.limit);
}
