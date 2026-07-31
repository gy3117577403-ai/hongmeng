import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { SOP_DRAFT_STATUS, SOP_CONTENT_SCHEMA_VERSION, SOP_WRITE_ACCESS, SopRequestError, toPrismaJson, validateSopContent } from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import {
  assertSopAssetsAvailable,
  createSopOperationLog,
  findSopVersionForItem,
  loadSopWorkspaceByItemId,
  lockSopScope,
} from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string; versionId: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const source = await findSopVersionForItem(tx, params.id, params.versionId);
      if (source.deletedAt) throw new SopRequestError('源 SOP 版本已删除', 409, 'SOP_VERSION_DELETED');
      const existing = await tx.sopVersion.findFirst({ where: { documentId: source.documentId, status: SOP_DRAFT_STATUS, deletedAt: null } });
      if (existing) throw new SopRequestError('已有 SOP 草稿，请先完成或删除当前草稿', 409, 'SOP_DRAFT_EXISTS', { versionId: existing.id });
      const content = validateSopContent(source.content);
      await assertSopAssetsAvailable(tx, source.documentId, content);
      const maxVersion = await tx.sopVersion.aggregate({ where: { documentId: source.documentId }, _max: { version: true } });
      const restored = await tx.sopVersion.create({
        data: {
          documentId: source.documentId,
          version: (maxVersion._max.version || 0) + 1,
          revision: 0,
          status: SOP_DRAFT_STATUS,
          title: source.title,
          content: toPrismaJson(content),
          contentSchemaVersion: SOP_CONTENT_SCHEMA_VERSION,
          basedOnVersionId: source.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await tx.sopDocument.update({ where: { id: source.documentId }, data: { title: source.title, updatedById: user.id } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'restore_sop_version',
        targetType: 'sop_version',
        targetId: restored.id,
        detail: { itemId: params.id, sourceVersionId: source.id },
      });
    });
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, version: workspace.draft, draft: workspace.draft, workspace });
  } catch (error) {
    return sopRouteError(error, '恢复 SOP 历史版本失败');
  }
}
