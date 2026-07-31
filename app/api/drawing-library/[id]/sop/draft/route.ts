import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  EMPTY_SOP_CONTENT,
  SOP_DRAFT_STATUS,
  SOP_CONTENT_SCHEMA_VERSION,
  SOP_WRITE_ACCESS,
  SopRequestError,
  cloneSopContent,
  toPrismaJson,
  validateSopContent,
} from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import {
  assertSopAssetsAvailable,
  cleanSopTitle,
  contentFromStoredVersion,
  createSopOperationLog,
  getOrCreateSopDocument,
  loadSopWorkspaceByItemId,
  lockSopScope,
} from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function createDraft(req: NextRequest, itemId: string) {
  const user = await requireUser({ write: SOP_WRITE_ACCESS });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await prisma.$transaction(async tx => {
    await lockSopScope(tx, itemId);
    const { item, document } = await getOrCreateSopDocument(tx, itemId, user.id, body.title);
    const activeDraft = await tx.sopVersion.findFirst({
      where: { documentId: document.id, status: SOP_DRAFT_STATUS, deletedAt: null },
    });
    if (activeDraft) {
      if (body.content !== undefined) {
        throw new SopRequestError('已有 SOP 草稿，请在现有草稿上继续编辑', 409, 'SOP_DRAFT_EXISTS', { versionId: activeDraft.id });
      }
      return activeDraft;
    }

    let basedOn = null;
    if (typeof body.basedOnVersionId === 'string' && body.basedOnVersionId.trim()) {
      basedOn = await tx.sopVersion.findFirst({
        where: { id: body.basedOnVersionId.trim(), documentId: document.id, deletedAt: null },
      });
      if (!basedOn) throw new SopRequestError('作为起点的 SOP 版本不存在', 404, 'SOP_BASE_VERSION_NOT_FOUND');
    } else if (document.currentPublishedVersionId) {
      basedOn = await tx.sopVersion.findFirst({ where: { id: document.currentPublishedVersionId, documentId: document.id, deletedAt: null } });
    }

    const content = body.content !== undefined
      ? validateSopContent(body.content)
      : basedOn
        ? validateSopContent(contentFromStoredVersion(basedOn.content))
        : cloneSopContent(EMPTY_SOP_CONTENT);
    await assertSopAssetsAvailable(tx, document.id, content);
    const maxVersion = await tx.sopVersion.aggregate({ where: { documentId: document.id }, _max: { version: true } });
    const title = cleanSopTitle(body.title, basedOn?.title || document.title);
    const version = await tx.sopVersion.create({
      data: {
        documentId: document.id,
        version: (maxVersion._max.version || 0) + 1,
        revision: 0,
        status: SOP_DRAFT_STATUS,
        title,
        content: toPrismaJson(content),
        contentSchemaVersion: SOP_CONTENT_SCHEMA_VERSION,
        basedOnVersionId: basedOn?.id || null,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await tx.sopDocument.update({ where: { id: document.id }, data: { title, updatedById: user.id } });
    await createSopOperationLog(tx, {
      userId: user.id,
      action: 'create_sop_draft',
      targetType: 'sop_version',
      targetId: version.id,
      detail: { itemId: item.id, basedOnVersionId: basedOn?.id || null },
    });
    return version;
  });
  const workspace = await loadSopWorkspaceByItemId(prisma, itemId);
  return NextResponse.json({ ok: true, version: workspace.draft || result, draft: workspace.draft || result, workspace });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return await createDraft(req, params.id);
  } catch (error) {
    return sopRouteError(error, '创建 SOP 草稿失败');
  }
}

// PUT is kept as a compatibility alias for clients that model draft creation as an upsert.
export const PUT = POST;
