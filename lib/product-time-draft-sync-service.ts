import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  mergeProductTimeDraftWithPublished,
  type ProductTimeDraftMergeEntry,
  type ProductTimeDraftMergeSummary,
} from '@/lib/product-time-draft-sync';
import {
  productTimeProfileInclude,
  serializeProductTimeProfile,
} from '@/lib/product-time';

export class ProductTimeDraftSyncError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ProductTimeDraftSyncError';
    this.status = status;
    this.code = code;
  }
}

function mergeEntry(entry: ProductTimeDraftMergeEntry): ProductTimeDraftMergeEntry {
  return {
    processDefinitionId: entry.processDefinitionId,
    occurrenceKey: entry.occurrenceKey,
    position: entry.position,
    sequenceGroup: entry.sequenceGroup,
    timeBasis: entry.timeBasis,
    unitMilliseconds: entry.unitMilliseconds,
    actionMilliseconds: entry.actionMilliseconds,
    occurrences: entry.occurrences,
    setupMilliseconds: entry.setupMilliseconds,
    unitLabel: entry.unitLabel,
    reportQuantityBasis: entry.reportQuantityBasis,
    reportUnitLabel: entry.reportUnitLabel,
    countsForEfficiency: entry.countsForEfficiency,
    isCritical: entry.isCritical,
    remark: entry.remark,
  };
}

export type ProductTimeDraftSyncResult = {
  profile: ReturnType<typeof serializeProductTimeProfile>;
  summary: ProductTimeDraftMergeSummary & {
    baseVersion: number | null;
    fromDraftVersion: number;
    publishedVersion: number;
    toDraftVersion: number;
  };
};

async function serializableDraftSync<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      });
    } catch (error) {
      if (
        attempt < 2
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) {
        throw new ProductTimeDraftSyncError(
          '操作期间草稿或正式版本已更新，请刷新后重试',
          409,
          'PRODUCT_TIME_DRAFT_CONFLICT',
        );
      }
      throw error;
    }
  }
  throw new ProductTimeDraftSyncError(
    '操作期间草稿或正式版本已更新，请刷新后重试',
    409,
    'PRODUCT_TIME_DRAFT_CONFLICT',
  );
}

export type ProductTimeDraftRebuildResult = {
  profile: ReturnType<typeof serializeProductTimeProfile>;
  summary: {
    discardedProfileId: string;
    discardedDraftVersion: number;
    publishedVersion: number;
    rebuiltDraftVersion: number;
    processCount: number;
  };
};

export function productTimeDraftRebuildConfirmation(
  draftVersion: number,
  publishedVersion: number,
): string {
  return `放弃草稿 V${draftVersion} 并重建 V${publishedVersion}`;
}

export async function rebuildProductTimeDraftFromPublished(input: {
  itemId: string;
  actorId: string;
  expectedRevision: number;
  expectedPublishedVersion: number;
  confirmationText: string;
}): Promise<ProductTimeDraftRebuildResult> {
  return serializableDraftSync(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-draft-sync:${input.itemId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${input.itemId}`}))`;

    const item = await tx.drawingLibraryItem.findFirst({
      where: { id: input.itemId, deletedAt: null },
      select: { id: true },
    });
    if (!item) {
      throw new ProductTimeDraftSyncError('图纸资料产品不存在', 404, 'PRODUCT_TIME_ITEM_NOT_FOUND');
    }

    const [draft, published] = await Promise.all([
      tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: input.itemId, status: 'draft' },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        include: { entries: { orderBy: { position: 'asc' } } },
      }),
      tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: input.itemId, status: 'published' },
        orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
        include: { entries: { orderBy: { position: 'asc' } } },
      }),
    ]);
    if (!draft) {
      throw new ProductTimeDraftSyncError('当前产品没有可放弃的草稿', 404, 'PRODUCT_TIME_DRAFT_NOT_FOUND');
    }
    if (!published) {
      throw new ProductTimeDraftSyncError('当前产品尚无正式版本，不能按正式版重建', 409, 'PRODUCT_TIME_PUBLISHED_NOT_FOUND');
    }
    if (draft.revision !== input.expectedRevision) {
      throw new ProductTimeDraftSyncError('草稿已被其他人修改，请刷新后重试', 409, 'PRODUCT_TIME_DRAFT_CONFLICT');
    }
    if (published.version !== input.expectedPublishedVersion) {
      throw new ProductTimeDraftSyncError('正式版本已经更新，请刷新后重新确认', 409, 'PRODUCT_TIME_PUBLISHED_CONFLICT');
    }
    const expectedConfirmation = productTimeDraftRebuildConfirmation(draft.version, published.version);
    if (input.confirmationText.trim() !== expectedConfirmation) {
      throw new ProductTimeDraftSyncError(
        `确认文字不匹配，请完整输入“${expectedConfirmation}”`,
        400,
        'PRODUCT_TIME_DRAFT_REBUILD_CONFIRMATION_REQUIRED',
      );
    }

    const maximum = await tx.productTimeProfile.aggregate({
      where: { drawingLibraryItemId: input.itemId },
      _max: { version: true },
    });
    const rebuiltDraftVersion = (maximum._max.version || published.version) + 1;
    const discarded = await tx.productTimeProfile.updateMany({
      where: {
        id: draft.id,
        status: 'draft',
        revision: input.expectedRevision,
        version: draft.version,
      },
      data: {
        status: 'discarded',
        revision: { increment: 1 },
        updatedById: input.actorId,
      },
    });
    if (discarded.count !== 1) {
      throw new ProductTimeDraftSyncError('草稿已经变化，请刷新后重新确认', 409, 'PRODUCT_TIME_DRAFT_CONFLICT');
    }

    const rebuilt = await tx.productTimeProfile.create({
      data: {
        drawingLibraryItemId: input.itemId,
        version: rebuiltDraftVersion,
        revision: 0,
        status: 'draft',
        sourceType: 'rebuild_from_published',
        reportingPolicy: published.reportingPolicy,
        remark: published.remark,
        createdById: input.actorId,
        updatedById: input.actorId,
        entries: published.entries.length ? {
          create: published.entries.map(entry => ({
            processDefinitionId: entry.processDefinitionId,
            occurrenceKey: entry.occurrenceKey,
            position: entry.position,
            sequenceGroup: entry.sequenceGroup,
            timeBasis: entry.timeBasis,
            unitMilliseconds: entry.unitMilliseconds,
            actionMilliseconds: entry.actionMilliseconds,
            occurrences: entry.occurrences,
            setupMilliseconds: entry.setupMilliseconds,
            unitLabel: entry.unitLabel,
            reportQuantityBasis: entry.reportQuantityBasis,
            reportUnitLabel: entry.reportUnitLabel,
            countsForEfficiency: entry.countsForEfficiency,
            isCritical: entry.isCritical,
            remark: entry.remark,
          })),
        } : undefined,
      },
      include: productTimeProfileInclude,
    });
    const summary = {
      discardedProfileId: draft.id,
      discardedDraftVersion: draft.version,
      publishedVersion: published.version,
      rebuiltDraftVersion,
      processCount: published.entries.length,
    };
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'discard_and_rebuild_product_time_draft',
        targetType: 'product_time_profile',
        targetId: rebuilt.id,
        detail: {
          drawingLibraryItemId: input.itemId,
          ...summary,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { profile: serializeProductTimeProfile(rebuilt), summary };
  });
}

export async function syncProductTimeDraftToPublished(input: {
  itemId: string;
  actorId: string;
  expectedRevision: number;
}): Promise<ProductTimeDraftSyncResult> {
  return serializableDraftSync(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-draft-sync:${input.itemId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${input.itemId}`}))`;

    const item = await tx.drawingLibraryItem.findFirst({
      where: { id: input.itemId, deletedAt: null },
      select: { id: true },
    });
    if (!item) {
      throw new ProductTimeDraftSyncError('图纸资料产品不存在', 404, 'PRODUCT_TIME_ITEM_NOT_FOUND');
    }

    const [draft, published] = await Promise.all([
      tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: input.itemId, status: 'draft' },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        include: { entries: { orderBy: { position: 'asc' } } },
      }),
      tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: input.itemId, status: 'published' },
        orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
        include: { entries: { orderBy: { position: 'asc' } } },
      }),
    ]);
    if (!draft) {
      throw new ProductTimeDraftSyncError('当前产品没有可同步的草稿', 404, 'PRODUCT_TIME_DRAFT_NOT_FOUND');
    }
    if (!published) {
      throw new ProductTimeDraftSyncError('当前产品尚无正式版本，草稿无需同步', 409, 'PRODUCT_TIME_PUBLISHED_NOT_FOUND');
    }
    if (draft.revision !== input.expectedRevision) {
      throw new ProductTimeDraftSyncError('草稿已被其他人修改，请刷新后重试', 409, 'PRODUCT_TIME_DRAFT_CONFLICT');
    }
    if (draft.version > published.version) {
      throw new ProductTimeDraftSyncError('当前草稿已经基于最新正式版本，无需再次同步', 409, 'PRODUCT_TIME_DRAFT_ALREADY_CURRENT');
    }

    const base = await tx.productTimeProfile.findFirst({
      where: {
        drawingLibraryItemId: input.itemId,
        status: { in: ['published', 'archived'] },
        version: { lt: draft.version },
      },
      orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
      include: { entries: { orderBy: { position: 'asc' } } },
    });
    const merge = mergeProductTimeDraftWithPublished({
      baseEntries: (base?.entries || []).map(mergeEntry),
      draftEntries: draft.entries.map(mergeEntry),
      publishedEntries: published.entries.map(mergeEntry),
    });
    const maximum = await tx.productTimeProfile.aggregate({
      where: { drawingLibraryItemId: input.itemId },
      _max: { version: true },
    });
    const nextDraftVersion = (maximum._max.version || published.version) + 1;
    const updated = await tx.productTimeProfile.updateMany({
      where: {
        id: draft.id,
        status: 'draft',
        revision: input.expectedRevision,
        version: draft.version,
      },
      data: {
        version: nextDraftVersion,
        revision: { increment: 1 },
        updatedById: input.actorId,
      },
    });
    if (updated.count !== 1) {
      throw new ProductTimeDraftSyncError('草稿或正式版本已经变化，请刷新后重试', 409, 'PRODUCT_TIME_DRAFT_CONFLICT');
    }

    await tx.productProcessTimeEntry.deleteMany({ where: { profileId: draft.id } });
    if (merge.entries.length) {
      await tx.productProcessTimeEntry.createMany({
        data: merge.entries.map(entry => ({
          profileId: draft.id,
          processDefinitionId: entry.processDefinitionId,
          occurrenceKey: entry.occurrenceKey,
          position: entry.position,
          sequenceGroup: entry.sequenceGroup,
          timeBasis: entry.timeBasis,
          unitMilliseconds: entry.unitMilliseconds,
          actionMilliseconds: entry.actionMilliseconds,
          occurrences: entry.occurrences,
          setupMilliseconds: entry.setupMilliseconds,
          unitLabel: entry.unitLabel,
          reportQuantityBasis: entry.reportQuantityBasis,
          reportUnitLabel: entry.reportUnitLabel,
          countsForEfficiency: entry.countsForEfficiency,
          isCritical: entry.isCritical,
          remark: entry.remark,
        })),
      });
    }

    const summary = {
      ...merge.summary,
      baseVersion: base?.version || null,
      fromDraftVersion: draft.version,
      publishedVersion: published.version,
      toDraftVersion: nextDraftVersion,
    };
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'sync_product_time_draft_with_published',
        targetType: 'product_time_profile',
        targetId: draft.id,
        detail: {
          drawingLibraryItemId: input.itemId,
          ...summary,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const profile = await tx.productTimeProfile.findUniqueOrThrow({
      where: { id: draft.id },
      include: productTimeProfileInclude,
    });
    return { profile: serializeProductTimeProfile(profile), summary };
  });
}
