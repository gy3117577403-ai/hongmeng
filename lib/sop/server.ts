import type { Prisma, PrismaClient } from '@prisma/client';
import {
  EMPTY_SOP_CONTENT,
  assertExpectedRevision,
  cloneSopContent,
  collectSopAssetIds,
  parseExpectedRevision,
  SopRequestError,
  type SopDocumentContent,
} from '@/lib/sop';

type SopReader = Pick<PrismaClient, 'drawingLibraryItem' | 'sopDocument'> | Pick<Prisma.TransactionClient, 'drawingLibraryItem' | 'sopDocument'>;

const userSelect = { id: true, username: true, displayName: true } as const;

export function cleanSopTitle(value: unknown, fallback = '在线 SOP') {
  if (typeof value !== 'string') return fallback;
  const title = value.trim();
  if (!title) return fallback;
  if (title.length > 160) throw new SopRequestError('SOP 标题不能超过 160 个字符');
  return title;
}

export function defaultSopTitle(item: { specification: string; productName?: string | null }) {
  return `${item.specification}${item.productName ? ` · ${item.productName}` : ''} SOP`;
}

export async function assertSopAssetsAvailable(
  tx: Pick<Prisma.TransactionClient, 'sopAsset'>,
  documentId: string,
  content: SopDocumentContent,
) {
  const assetIds = collectSopAssetIds(content);
  if (!assetIds.length) return [];
  const assets = await tx.sopAsset.findMany({
    where: { id: { in: assetIds }, documentId, deletedAt: null },
    select: { id: true },
  });
  const found = new Set(assets.map(asset => asset.id));
  const missing = assetIds.filter(id => !found.has(id));
  if (missing.length) {
    throw new SopRequestError('SOP 引用了不存在、已删除或属于其他产品的图片', 409, 'SOP_ASSET_UNAVAILABLE', { assetIds: missing });
  }
  return assetIds;
}

function serializeUser(user?: { id: string; username: string; displayName: string } | null) {
  return user ? { id: user.id, username: user.username, displayName: user.displayName } : null;
}

function serializePublishedFile(file?: {
  id: string;
  originalName: string;
  displayName: string | null;
  mimeType: string;
  size: number;
  version: string;
  deletedAt: Date | null;
  createdAt: Date;
} | null) {
  if (!file) return null;
  return {
    id: file.id,
    originalName: file.originalName,
    displayName: file.displayName,
    mimeType: file.mimeType,
    size: file.size,
    version: file.version,
    deletedAt: file.deletedAt?.toISOString() || null,
    createdAt: file.createdAt.toISOString(),
    contentUrl: `/api/drawing-library/files/${file.id}/content`,
    downloadUrl: `/api/drawing-library/files/${file.id}/download`,
  };
}

function serializeVersion(version: any) {
  return {
    id: version.id,
    documentId: version.documentId,
    version: version.version,
    revision: version.revision,
    status: version.status,
    controlMode: version.controlMode,
    title: version.title,
    content: version.content,
    contentSchemaVersion: version.contentSchemaVersion,
    basedOnVersionId: version.basedOnVersionId,
    createdBy: serializeUser(version.createdBy),
    updatedBy: serializeUser(version.updatedBy),
    publishedBy: serializeUser(version.publishedBy),
    publishedAt: version.publishedAt?.toISOString() || null,
    deletedAt: version.deletedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    publishedFile: serializePublishedFile(version.publishedFile),
  };
}

function serializeAsset(asset: any) {
  return {
    id: asset.id,
    documentId: asset.documentId,
    originalName: asset.originalName,
    displayName: asset.displayName,
    mimeType: asset.mimeType,
    size: asset.size,
    fileHash: asset.fileHash,
    uploadedBy: serializeUser(asset.uploadedBy),
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    url: `/api/drawing-library/sop-assets/${asset.id}`,
  };
}

export async function loadSopWorkspaceByItemId(client: SopReader, drawingLibraryItemId: string) {
  const item = await client.drawingLibraryItem.findFirst({
    where: { id: drawingLibraryItemId, deletedAt: null },
    select: {
      id: true,
      customerName: true,
      productName: true,
      specification: true,
      libraryKey: true,
    },
  });
  if (!item) throw new SopRequestError('图纸资料主档不存在', 404, 'SOP_ITEM_NOT_FOUND');

  const document = await client.sopDocument.findFirst({
    where: { drawingLibraryItemId, deletedAt: null },
    include: {
      createdBy: { select: userSelect },
      updatedBy: { select: userSelect },
      versions: {
        where: { deletedAt: null },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        include: {
          createdBy: { select: userSelect },
          updatedBy: { select: userSelect },
          publishedBy: { select: userSelect },
          publishedFile: {
            select: {
              id: true,
              originalName: true,
              displayName: true,
              mimeType: true,
              size: true,
              version: true,
              deletedAt: true,
              createdAt: true,
            },
          },
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: userSelect } },
      },
    },
  });

  if (!document) {
    return { item, document: null, draft: null, publishedVersion: null, versions: [], assets: [] };
  }
  const versions = document.versions.map(serializeVersion);
  const draft = versions.find(version => version.status === 'draft') || null;
  const publishedVersion = versions.find(version => version.id === document.currentPublishedVersionId) || null;
  return {
    item,
    document: {
      id: document.id,
      drawingLibraryItemId: document.drawingLibraryItemId,
      title: document.title,
      sopStage: document.sopStage,
      drawingStatus: document.drawingStatus,
      remark: document.remark,
      currentPublishedVersionId: document.currentPublishedVersionId,
      createdBy: serializeUser(document.createdBy),
      updatedBy: serializeUser(document.updatedBy),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    },
    draft,
    publishedVersion,
    versions,
    assets: document.assets.map(serializeAsset),
  };
}

export async function createSopOperationLog(
  tx: Pick<Prisma.TransactionClient, 'operationLog'>,
  input: { userId: string; action: string; targetType: string; targetId: string; detail?: Prisma.InputJsonValue },
) {
  await tx.operationLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail,
    },
  });
}

export function serializeSopAsset(asset: any) {
  return serializeAsset(asset);
}

export function expectedSopRevision(input: Record<string, unknown> | FormData) {
  const value = input instanceof FormData
    ? input.get('expectedRevision') ?? input.get('lockVersion')
    : input.expectedRevision ?? input.lockVersion;
  return parseExpectedRevision(value);
}

export function assertDraftDeleteRevision(
  actualRevision: number,
  input: Record<string, unknown>,
  queryExpectedRevision?: string | null,
) {
  const expectedRevision = parseExpectedRevision(input.expectedRevision ?? queryExpectedRevision);
  assertExpectedRevision(actualRevision, expectedRevision);
  return expectedRevision;
}

export async function lockSopScope(tx: Prisma.TransactionClient, scope: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sop:${scope}`}))`;
}

export async function findSopItem(tx: Prisma.TransactionClient, itemId: string) {
  const item = await tx.drawingLibraryItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { id: true, customerName: true, productName: true, specification: true, libraryKey: true },
  });
  if (!item) throw new SopRequestError('图纸资料主档不存在', 404, 'SOP_ITEM_NOT_FOUND');
  return item;
}

export async function getOrCreateSopDocument(tx: Prisma.TransactionClient, itemId: string, userId: string, title?: unknown) {
  const item = await findSopItem(tx, itemId);
  const existing = await tx.sopDocument.findFirst({ where: { drawingLibraryItemId: itemId, deletedAt: null } });
  if (existing) return { item, document: existing };
  const document = await tx.sopDocument.create({
    data: {
      drawingLibraryItemId: itemId,
      title: cleanSopTitle(title, defaultSopTitle(item)),
      createdById: userId,
      updatedById: userId,
    },
  });
  return { item, document };
}

export async function findSopVersionForItem(tx: Prisma.TransactionClient, itemId: string, versionId: string) {
  const version = await tx.sopVersion.findFirst({
    where: { id: versionId, document: { drawingLibraryItemId: itemId, deletedAt: null } },
    include: { document: true },
  });
  if (!version) throw new SopRequestError('SOP 版本不存在', 404, 'SOP_VERSION_NOT_FOUND');
  return version;
}

export function contentFromStoredVersion(value: unknown) {
  try {
    return cloneSopContent(value as SopDocumentContent);
  } catch {
    return cloneSopContent(EMPTY_SOP_CONTENT);
  }
}
