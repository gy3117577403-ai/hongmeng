import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { connectorParameterTechnicalFingerprint, parseConnectorParameterInput, serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const parsed = parseConnectorParameterInput(body, { partial: true });
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const existing = await prisma.connectorParameter.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        productBindings: { where: { isCurrent: true, status: 'PUBLISHED' }, orderBy: { publishedAt: 'asc' } },
        assemblyManualBindings: { select: { manualId: true } },
      },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '连接器参数不存在' }, { status: 404 });
    const userName = user.displayName || user.username;
    const nextValues = {
      rowNo: parsed.data.rowNo !== undefined ? parsed.data.rowNo : existing.rowNo,
      model: parsed.data.model !== undefined ? parsed.data.model : existing.model,
      outerPeelMm: parsed.data.outerPeelMm !== undefined ? parsed.data.outerPeelMm : existing.outerPeelMm,
      innerPeelMm: parsed.data.innerPeelMm !== undefined ? parsed.data.innerPeelMm : existing.innerPeelMm,
      insertionLengthMm: parsed.data.insertionLengthMm !== undefined ? parsed.data.insertionLengthMm : existing.insertionLengthMm,
      remark: parsed.data.remark !== undefined ? parsed.data.remark : existing.remark,
      isHighlighted: parsed.data.isHighlighted !== undefined ? parsed.data.isHighlighted : existing.isHighlighted,
    };
    const technicalChanged = ['model', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'remark']
      .some(key => String(existing[key as keyof typeof existing] ?? '') !== String(nextValues[key as keyof typeof nextValues] ?? ''));
    const requiresRevision = technicalChanged && (existing.lockedAt !== null || existing.productBindings.length > 0);

    const item = requiresRevision
      ? await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connector-parameter-edit:${existing.id}`}))`;
          const current = await tx.connectorParameter.findUnique({ where: { id: existing.id }, select: { updatedAt: true, deletedAt: true, status: true } });
          if (!current || current.deletedAt || current.updatedAt.getTime() !== existing.updatedAt.getTime() || current.status !== existing.status) {
            throw new Error('CONNECTOR_PARAMETER_EDIT_CONFLICT');
          }
          const now = new Date();
          const next = await tx.connectorParameter.create({
            data: {
              ...nextValues,
              technicalFingerprint: connectorParameterTechnicalFingerprint(nextValues),
              sourceType: 'MANUAL_CORRECTION',
              revision: existing.revision + 1,
              status: 'PUBLISHED',
              supersedesParameterId: existing.id,
              lockedAt: existing.productBindings.length ? now : null,
              createdBy: userName,
              updatedBy: userName,
            },
          });

          for (const binding of existing.productBindings) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connector-parameter-binding:${binding.drawingLibraryItemId}`}))`;
            const latest = await tx.productConnectorParameterBinding.aggregate({ where: { drawingLibraryItemId: binding.drawingLibraryItemId }, _max: { version: true } });
            await tx.productConnectorParameterBinding.update({
              where: { id: binding.id },
              data: { isCurrent: false, status: 'SUPERSEDED', effectiveTo: now, retiredAt: now, retiredById: user.id, retireReason: `参数人工修订为 R${next.revision}` },
            });
            await tx.productConnectorParameterBinding.create({
              data: {
                drawingLibraryItemId: binding.drawingLibraryItemId,
                connectorParameterId: next.id,
                positionLabel: binding.positionLabel,
                positionKey: binding.positionKey,
                version: (latest._max.version || binding.version) + 1,
                isCurrent: true,
                status: 'PUBLISHED',
                sourceType: 'MANUAL_CORRECTION',
                sourceSampleTaskId: binding.sourceSampleTaskId,
                sourceSubmissionId: binding.sourceSubmissionId,
                sourceSampleEntryId: null,
                sourceDrawingFileId: binding.sourceDrawingFileId,
                sourcePayloadHash: connectorParameterTechnicalFingerprint(nextValues),
                parameterSnapshot: {
                  model: next.model,
                  outerPeelMm: next.outerPeelMm,
                  innerPeelMm: next.innerPeelMm,
                  insertionLengthMm: next.insertionLengthMm,
                  remark: next.remark,
                  revision: next.revision,
                },
                supersedesBindingId: binding.id,
                effectiveFrom: now,
                publishedById: user.id,
                publishedByName: userName,
                publishedAt: now,
              },
            });
          }
          if (existing.assemblyManualBindings.length) {
            await tx.connectorAssemblyManualBinding.createMany({
              data: existing.assemblyManualBindings.map(binding => ({ manualId: binding.manualId, connectorParameterId: next.id })),
              skipDuplicates: true,
            });
          }
          await tx.connectorParameter.update({ where: { id: existing.id }, data: { status: 'SUPERSEDED', updatedBy: userName } });
          return next;
        })
      : await prisma.connectorParameter.update({
          where: { id: params.id },
          data: {
            ...parsed.data,
            ...(technicalChanged ? { technicalFingerprint: connectorParameterTechnicalFingerprint(nextValues) } : {}),
            updatedBy: userName,
          },
        });
    await logOp({
      userId: user.id,
      action: requiresRevision ? 'revise_connector_parameter' : 'update_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo, isHighlighted: item.isHighlighted, previousParameterId: requiresRevision ? existing.id : null, revision: item.revision, reboundProductCount: existing.productBindings.length },
    });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: requiresRevision ? 'revise_connector_parameter' : 'update_connector_parameter',
      before: connectorParameterSnapshot(existing),
      after: connectorParameterSnapshot(item),
      changedBy: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, revised: requiresRevision, parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof Error && e.message === 'CONNECTOR_PARAMETER_EDIT_CONFLICT') return NextResponse.json({ ok: false, error: '参数已经被其他人修改，请刷新后重试' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '更新连接器参数失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { confirmText?: unknown };
    if (String(body.confirmText || '').trim() !== 'DELETE') return NextResponse.json({ ok: false, error: '删除确认不匹配' }, { status: 400 });
    const existing = await prisma.connectorParameter.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        _count: {
          select: {
            productBindings: { where: { isCurrent: true, status: 'PUBLISHED' } },
            assemblyManualBindings: true,
          },
        },
      },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '连接器参数不存在' }, { status: 404 });
    if (existing._count.productBindings > 0 || existing._count.assemblyManualBindings > 0 || existing.lockedAt) {
      return NextResponse.json({
        ok: false,
        code: 'CONNECTOR_PARAMETER_IN_USE',
        error: `该参数已被 ${existing._count.productBindings} 个产品和 ${existing._count.assemblyManualBindings} 份说明书引用，不能删除；请使用“编辑”创建修订版本。`,
      }, { status: 409 });
    }
    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'RETIRED', updatedBy: user.displayName || user.username },
    });
    await logOp({
      userId: user.id,
      action: 'delete_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo },
    });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'delete_connector_parameter',
      before: connectorParameterSnapshot(existing),
      after: connectorParameterSnapshot(item),
      changedBy: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '删除连接器参数失败' }, { status: 500 });
  }
}
