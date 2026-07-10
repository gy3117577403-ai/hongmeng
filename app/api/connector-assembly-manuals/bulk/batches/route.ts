import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { parseBulkManualCandidate, serializeManualImportBatch } from '@/lib/connector-manual-bulk-import';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const importActions = new Set(['create_manual', 'create_version']);

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 30) || 30));
    const batches = await prisma.connectorAssemblyManualImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { items: { orderBy: { createdAt: 'asc' }, take: 1000 } },
    });
    return NextResponse.json({ ok: true, batches: batches.map(serializeManualImportBatch) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书导入批次加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { confirmText?: string; sourceName?: string; rows?: unknown[] };
    if (String(body.confirmText || '').trim() !== 'IMPORT_MANUALS') return NextResponse.json({ ok: false, error: '请输入 IMPORT_MANUALS 确认导入' }, { status: 400 });
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    if (!rows.length) return NextResponse.json({ ok: false, error: '没有可创建批次的预览行' }, { status: 400 });
    const parsedRows = rows.map(value => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const parsed = parseBulkManualCandidate(record);
      const action = String(record.action || 'skip');
      const suggestedRevision = String(record.suggestedRevision || parsed.candidate.revisionCandidate || '待识别').trim().slice(0, 80);
      return { record, parsed, action, suggestedRevision };
    });
    const invalid = parsedRows.filter(row => row.parsed.errors.length);
    if (invalid.length) return NextResponse.json({ ok: false, error: `${invalid.length} 条预览数据无效，请重新预览` }, { status: 400 });
    const unresolved = parsedRows.filter(row => ['conflict', 'manual_review', 'invalid'].includes(row.action));
    if (unresolved.length) return NextResponse.json({ ok: false, error: `仍有 ${unresolved.length} 条冲突或待确认项，请选择新版本或跳过` }, { status: 400 });
    const readyCount = parsedRows.filter(row => importActions.has(row.action)).length;
    const duplicateCount = parsedRows.filter(row => row.action === 'duplicate').length;
    const userName = user.displayName || user.username;
    const batch = await prisma.connectorAssemblyManualImportBatch.create({
      data: {
        sourceName: String(body.sourceName || '').trim().slice(0, 260) || null,
        totalCount: parsedRows.length,
        readyCount,
        duplicateCount,
        skippedCount: parsedRows.length - readyCount - duplicateCount,
        status: readyCount ? 'uploading' : 'completed',
        createdBy: userName,
        startedAt: readyCount ? new Date() : null,
        completedAt: readyCount ? null : new Date(),
        items: {
          create: parsedRows.map(({ record, parsed, action, suggestedRevision }) => ({
            clientId: parsed.candidate.clientId,
            fileName: parsed.candidate.fileName,
            relativePath: parsed.candidate.relativePath || null,
            fileMode: parsed.candidate.fileMode,
            fileHash: parsed.candidate.hash || null,
            action,
            status: action === 'duplicate' ? 'duplicate' : importActions.has(action) ? 'pending' : 'skipped',
            title: parsed.candidate.defaultTitle,
            revision: suggestedRevision,
            detectedTitle: parsed.candidate.detectedTitle || null,
            pageCount: parsed.candidate.pageCount || null,
            warningsJson: parsed.candidate.warnings as Prisma.InputJsonValue,
            metadataJson: record as Prisma.InputJsonValue,
          })),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    await logOp({
      userId: user.id,
      action: 'create_connector_assembly_manual_import_batch',
      targetType: 'connector_assembly_manual_import_batch',
      targetId: batch.id,
      detail: { totalCount: batch.totalCount, readyCount, duplicateCount },
    });
    return NextResponse.json({ ok: true, batch: serializeManualImportBatch(batch) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return NextResponse.json({ ok: false, error: '批次内 clientId 重复，请重新选择文件' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书导入批次创建失败' }, { status: 500 });
  }
}
