import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  CAPABILITY_SHOWCASE_SITE_KEY,
  defaultCapabilityShowcaseContent,
  normalizeCapabilityShowcaseContent,
  referencedCapabilityShowcaseMediaIds,
  type CapabilityShowcaseContent,
} from '@/lib/capability-showcase';
import { prisma } from '@/lib/prisma';

export class CapabilityShowcaseConflictError extends Error {}
export class CapabilityShowcaseNotFoundError extends Error {}
export class CapabilityShowcaseValidationError extends Error {}

export type CapabilityShowcaseMediaDTO = {
  id: string;
  originalName: string;
  displayName: string | null;
  mimeType: string;
  size: number;
  altText: string | null;
  createdAt: string;
  contentUrl: string;
};

export type CapabilityShowcaseShareDTO = {
  id: string;
  tokenPrefix: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
};

function json(value: CapabilityShowcaseContent): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function normalizeOrValidationError(value: unknown): CapabilityShowcaseContent {
  try {
    return normalizeCapabilityShowcaseContent(value);
  } catch (error) {
    throw new CapabilityShowcaseValidationError(error instanceof Error ? error.message : '展示内容无效');
  }
}

function hashShareToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function serializeCapabilityShowcaseMedia(media: {
  id: string;
  originalName: string;
  displayName: string | null;
  mimeType: string;
  size: bigint;
  altText: string | null;
  createdAt: Date;
}): CapabilityShowcaseMediaDTO {
  return {
    id: media.id,
    originalName: media.originalName,
    displayName: media.displayName,
    mimeType: media.mimeType,
    size: Number(media.size),
    altText: media.altText,
    createdAt: media.createdAt.toISOString(),
    contentUrl: `/api/capability-showcase/media/${media.id}/content`,
  };
}

export function serializeCapabilityShowcaseShare(share: {
  id: string;
  tokenPrefix: string;
  label: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
  createdAt: Date;
}): CapabilityShowcaseShareDTO {
  return {
    id: share.id,
    tokenPrefix: share.tokenPrefix,
    label: share.label,
    expiresAt: share.expiresAt?.toISOString() || null,
    revokedAt: share.revokedAt?.toISOString() || null,
    lastAccessedAt: share.lastAccessedAt?.toISOString() || null,
    createdAt: share.createdAt.toISOString(),
  };
}

export async function ensureCapabilityShowcaseSite(userId?: string | null) {
  const initial = defaultCapabilityShowcaseContent();
  return prisma.capabilityShowcaseSite.upsert({
    where: { key: CAPABILITY_SHOWCASE_SITE_KEY },
    create: {
      key: CAPABILITY_SHOWCASE_SITE_KEY,
      draft: json(initial),
      createdBy: userId || null,
      updatedBy: userId || null,
    },
    update: {},
  });
}

async function assertMediaReferencesExist(siteId: string, content: CapabilityShowcaseContent) {
  const ids = [...referencedCapabilityShowcaseMediaIds(content)];
  if (!ids.length) return;
  const found = await prisma.capabilityShowcaseMedia.findMany({
    where: { siteId, id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const foundIds = new Set(found.map(entry => entry.id));
    const missing = ids.filter(id => !foundIds.has(id));
    throw new CapabilityShowcaseValidationError(`图片不存在或已删除：${missing.join('、')}`);
  }
}

export async function getCapabilityShowcaseWorkbench(userId?: string | null) {
  const site = await ensureCapabilityShowcaseSite(userId);
  const [media, publications, shares] = await Promise.all([
    prisma.capabilityShowcaseMedia.findMany({
      where: { siteId: site.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.capabilityShowcasePublication.findMany({
      where: { siteId: site.id },
      orderBy: { revision: 'desc' },
      take: 12,
      select: { id: true, revision: true, createdAt: true, createdBy: true },
    }),
    prisma.capabilityShowcaseShare.findMany({
      where: { siteId: site.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
  ]);
  return {
    site: {
      id: site.id,
      draftRevision: site.draftRevision,
      publishedRevision: site.publishedRevision,
      publishedAt: site.publishedAt?.toISOString() || null,
      updatedAt: site.updatedAt.toISOString(),
      content: normalizeOrValidationError(site.draft),
    },
    media: media.map(serializeCapabilityShowcaseMedia),
    publications: publications.map(entry => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    shares: shares.map(serializeCapabilityShowcaseShare),
  };
}

export async function saveCapabilityShowcaseDraft(input: {
  userId: string;
  expectedRevision: number;
  content: unknown;
}) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new CapabilityShowcaseValidationError('草稿版本无效');
  }
  const content = normalizeOrValidationError(input.content);
  const site = await ensureCapabilityShowcaseSite(input.userId);
  await assertMediaReferencesExist(site.id, content);
  const updated = await prisma.capabilityShowcaseSite.updateMany({
    where: { id: site.id, draftRevision: input.expectedRevision },
    data: {
      draft: json(content),
      draftRevision: { increment: 1 },
      updatedBy: input.userId,
    },
  });
  if (updated.count !== 1) throw new CapabilityShowcaseConflictError('草稿已被其他登录用户更新，请刷新后重试');
  const saved = await prisma.capabilityShowcaseSite.findUniqueOrThrow({ where: { id: site.id } });
  return {
    draftRevision: saved.draftRevision,
    updatedAt: saved.updatedAt.toISOString(),
    content: normalizeOrValidationError(saved.draft),
  };
}

export async function publishCapabilityShowcase(input: {
  userId: string;
  expectedRevision: number;
}) {
  const site = await ensureCapabilityShowcaseSite(input.userId);
  if (site.draftRevision !== input.expectedRevision) {
    throw new CapabilityShowcaseConflictError('草稿版本已变化，请先刷新再发布');
  }
  const content = normalizeOrValidationError(site.draft);
  await assertMediaReferencesExist(site.id, content);
  const nextRevision = (site.publishedRevision || 0) + 1;
  const publishedAt = new Date();

  const publication = await prisma.$transaction(async tx => {
    const updated = await tx.capabilityShowcaseSite.updateMany({
      where: {
        id: site.id,
        draftRevision: input.expectedRevision,
        publishedRevision: site.publishedRevision,
      },
      data: {
        publishedRevision: nextRevision,
        publishedAt,
        updatedBy: input.userId,
      },
    });
    if (updated.count !== 1) throw new CapabilityShowcaseConflictError('发布时草稿已变化，请刷新后重试');
    return tx.capabilityShowcasePublication.create({
      data: {
        siteId: site.id,
        revision: nextRevision,
        snapshot: json(content),
        createdBy: input.userId,
      },
    });
  });
  return {
    id: publication.id,
    revision: publication.revision,
    createdAt: publication.createdAt.toISOString(),
  };
}

export async function createCapabilityShowcaseShare(input: {
  userId: string;
  label: unknown;
  expiresInDays?: unknown;
}) {
  const site = await ensureCapabilityShowcaseSite(input.userId);
  if (!site.publishedRevision) throw new CapabilityShowcaseValidationError('请先发布一个版本，再创建分享链接');
  const label = String(input.label ?? '').trim().slice(0, 80) || `外部分享 ${new Date().toLocaleDateString('zh-CN')}`;
  const parsedDays = input.expiresInDays === null || input.expiresInDays === undefined || input.expiresInDays === ''
    ? null
    : Number(input.expiresInDays);
  if (parsedDays !== null && (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 3650)) {
    throw new CapabilityShowcaseValidationError('有效期必须为1至3650天');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = parsedDays === null ? null : new Date(Date.now() + parsedDays * 24 * 60 * 60 * 1000);
  const share = await prisma.capabilityShowcaseShare.create({
    data: {
      siteId: site.id,
      tokenHash: hashShareToken(token),
      tokenPrefix: token.slice(0, 8),
      label,
      expiresAt,
      createdBy: input.userId,
    },
  });
  return { share: serializeCapabilityShowcaseShare(share), token };
}

export async function revokeCapabilityShowcaseShare(input: { userId: string; shareId: string }) {
  const site = await ensureCapabilityShowcaseSite(input.userId);
  const result = await prisma.capabilityShowcaseShare.updateMany({
    where: { id: input.shareId, siteId: site.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw new CapabilityShowcaseNotFoundError('分享链接不存在或已停用');
}

export async function resolveCapabilityShowcaseShare(token: string) {
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(token)) return null;
  const now = new Date();
  const share = await prisma.capabilityShowcaseShare.findUnique({
    where: { tokenHash: hashShareToken(token) },
    include: { site: true },
  });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= now)) return null;
  const revision = share.site.publishedRevision;
  if (!revision) return null;
  const publication = await prisma.capabilityShowcasePublication.findUnique({
    where: { siteId_revision: { siteId: share.siteId, revision } },
  });
  if (!publication) return null;
  if (!share.lastAccessedAt || now.getTime() - share.lastAccessedAt.getTime() > 60 * 60 * 1000) {
    await prisma.capabilityShowcaseShare.updateMany({
      where: { id: share.id, revokedAt: null },
      data: { lastAccessedAt: now },
    });
  }
  return {
    shareId: share.id,
    siteId: share.siteId,
    revision,
    content: normalizeOrValidationError(publication.snapshot),
    publishedAt: publication.createdAt,
  };
}

export async function getCapabilityShowcaseMediaForDraft(mediaId: string, userId: string) {
  const site = await ensureCapabilityShowcaseSite(userId);
  return prisma.capabilityShowcaseMedia.findFirst({
    where: { id: mediaId, siteId: site.id, deletedAt: null },
  });
}

export async function getCapabilityShowcaseMediaForShare(input: {
  token: string;
  mediaId: string;
}) {
  const resolved = await resolveCapabilityShowcaseShare(input.token);
  if (!resolved) return null;
  const referenced = referencedCapabilityShowcaseMediaIds(resolved.content);
  if (!referenced.has(input.mediaId)) return null;
  return prisma.capabilityShowcaseMedia.findFirst({
    where: { id: input.mediaId, siteId: resolved.siteId, deletedAt: null },
  });
}

export async function deleteCapabilityShowcaseMedia(input: { userId: string; mediaId: string }) {
  const site = await ensureCapabilityShowcaseSite(input.userId);
  const media = await prisma.capabilityShowcaseMedia.findFirst({
    where: { id: input.mediaId, siteId: site.id, deletedAt: null },
  });
  if (!media) throw new CapabilityShowcaseNotFoundError('图片不存在或已删除');
  const draft = normalizeOrValidationError(site.draft);
  if (referencedCapabilityShowcaseMediaIds(draft).has(media.id)) {
    throw new CapabilityShowcaseConflictError('该图片仍被草稿引用，请先替换图片并保存');
  }
  if (site.publishedRevision) {
    const publications = await prisma.capabilityShowcasePublication.findMany({
      where: { siteId: site.id },
      select: { snapshot: true },
    });
    if (publications.some(publication => referencedCapabilityShowcaseMediaIds(normalizeOrValidationError(publication.snapshot)).has(media.id))) {
      throw new CapabilityShowcaseConflictError('该图片仍被发布历史引用，为保持版本完整不能删除');
    }
  }
  await prisma.capabilityShowcaseMedia.update({
    where: { id: media.id },
    data: { deletedAt: new Date() },
  });
  return media;
}
