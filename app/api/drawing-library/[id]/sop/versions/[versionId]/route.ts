import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  SOP_CONTENT_SCHEMA_VERSION,
  SOP_WRITE_ACCESS,
  SopRequestError,
  assertExpectedRevision,
  assertMutableDraft,
  toPrismaJson,
  validateSopContent,
} from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import {
  assertSopAssetsAvailable,
  assertDraftDeleteRevision,
  cleanSopTitle,
  createSopOperationLog,
  expectedSopRevision,
  findSopVersionForItem,
  loadSopWorkspaceByItemId,
  lockSopScope,
} from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const body = await req.json() as Record<string, unknown>;
    const expectedRevision = expectedSopRevision(body);
    const content = validateSopContent(body.content);
    await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const current = await findSopVersionForItem(tx, params.id, params.versionId);
      assertMutableDraft(current);
      assertExpectedRevision(current.revision, expectedRevision);
      await assertSopAssetsAvailable(tx, current.documentId, content);
      const title = cleanSopTitle(body.title, current.title);
      const updated = await tx.sopVersion.updateMany({
        where: { id: current.id, revision: expectedRevision, status: 'draft', deletedAt: null },
        data: {
          title,
          content: toPrismaJson(content),
          contentSchemaVersion: SOP_CONTENT_SCHEMA_VERSION,
          revision: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new SopRequestError('文档已被其他人更新，请刷新后合并修改', 409, 'SOP_REVISION_CONFLICT');
      await tx.sopDocument.update({ where: { id: current.documentId }, data: { title, updatedById: user.id } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'update_sop_draft',
        targetType: 'sop_version',
        targetId: current.id,
        detail: { itemId: params.id, fromRevision: expectedRevision, toRevision: expectedRevision + 1 },
      });
    });
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, version: workspace.draft, draft: workspace.draft, workspace });
  } catch (error) {
    return sopRouteError(error, '保存 SOP 草稿失败');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const queryRevision = req.nextUrl.searchParams.get('expectedRevision');
    await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const current = await findSopVersionForItem(tx, params.id, params.versionId);
      assertMutableDraft(current);
      const expectedRevision = assertDraftDeleteRevision(current.revision, body, queryRevision);
      const updated = await tx.sopVersion.updateMany({
        where: { id: current.id, revision: expectedRevision, status: 'draft', deletedAt: null },
        data: { deletedAt: new Date(), revision: { increment: 1 }, updatedById: user.id },
      });
      if (updated.count !== 1) throw new SopRequestError('文档已被其他人更新，请刷新后重试', 409, 'SOP_REVISION_CONFLICT');
      await tx.sopDocument.update({ where: { id: current.documentId }, data: { updatedById: user.id } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'delete_sop_draft',
        targetType: 'sop_version',
        targetId: current.id,
        detail: { itemId: params.id, fromRevision: expectedRevision, toRevision: expectedRevision + 1 },
      });
    });
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return sopRouteError(error, '删除 SOP 草稿失败');
  }
}
