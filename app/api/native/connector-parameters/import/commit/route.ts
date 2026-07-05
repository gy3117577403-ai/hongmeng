import { NextRequest } from 'next/server';
import {
  ConnectorImportPreviewRow,
  connectorDuplicateKey,
  parseConnectorParameterInput,
  serializeConnectorParameter,
  summarizeConnectorPreview,
} from '@/lib/connector-parameters';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CommitBody = {
  rows?: ConnectorImportPreviewRow[];
  duplicateStrategy?: 'skip' | 'import';
  sourceType?: string;
  fileName?: string | null;
  confirmText?: string;
};

async function existingDuplicateKeys() {
  const items = await prisma.connectorParameter.findMany({
    where: { deletedAt: null },
    select: { model: true, outerPeelMm: true, innerPeelMm: true, insertionLengthMm: true, remark: true },
  });
  return new Set(items.map(connectorDuplicateKey));
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as CommitBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return nativeError('缺少待确认导入的数据', 400);
    const duplicateStrategy = body.duplicateStrategy === 'import' ? 'import' : 'skip';
    const previewSummary = summarizeConnectorPreview(rows);
    if (previewSummary.totalRows > 100 && String(body.confirmText || '').trim() !== 'IMPORT_CONFIRM') {
      return nativeError('导入超过 100 行，请输入 IMPORT_CONFIRM 确认', 400);
    }
    const existingKeys = await existingDuplicateKeys();
    const userName = user.displayName || user.username;
    const results: { row: number; model: string; status: 'created' | 'skipped' | 'failed'; message: string }[] = [];
    const createdItems = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let duplicateSkipped = 0;
    const batch = await prisma.connectorParameterImportBatch.create({
      data: {
        sourceType: String(body.sourceType || 'harmony_native').slice(0, 40),
        fileName: body.fileName ? String(body.fileName).slice(0, 200) : null,
        totalRows: previewSummary.totalRows,
        readyCount: previewSummary.readyCount,
        duplicateCount: previewSummary.duplicateCount,
        invalidCount: previewSummary.invalidCount,
        skippedCount: previewSummary.skippedCount,
        insertedCount: 0,
        duplicateStrategy,
        createdBy: userName,
        summaryJson: previewSummary,
      },
    });

    for (const row of rows) {
      const index = Number(row.index || 0) || results.length + 1;
      if (row.status === 'skipped') {
        skipped += 1;
        results.push({ row: index, model: row.model || '', status: 'skipped', message: row.reason || '空行已跳过' });
        continue;
      }
      if (row.status === 'invalid') {
        failed += 1;
        results.push({ row: index, model: row.model || '', status: 'failed', message: row.reason || '数据格式不正确' });
        continue;
      }
      const parsed = parseConnectorParameterInput(row);
      if (parsed.empty) {
        skipped += 1;
        results.push({ row: index, model: '', status: 'skipped', message: '空行已跳过' });
        continue;
      }
      if (parsed.errors.length) {
        failed += 1;
        results.push({ row: index, model: row.model || '', status: 'failed', message: parsed.errors.join('；') });
        continue;
      }
      const key = connectorDuplicateKey(parsed.data);
      if (duplicateStrategy === 'skip' && (row.status === 'duplicate' || existingKeys.has(key))) {
        skipped += 1;
        duplicateSkipped += 1;
        results.push({ row: index, model: parsed.data.model || '', status: 'skipped', message: '疑似重复，已跳过' });
        continue;
      }
      const item = await prisma.connectorParameter.create({
        data: {
          rowNo: parsed.data.rowNo,
          model: parsed.data.model,
          outerPeelMm: parsed.data.outerPeelMm,
          innerPeelMm: parsed.data.innerPeelMm,
          insertionLengthMm: parsed.data.insertionLengthMm,
          remark: parsed.data.remark,
          isHighlighted: parsed.data.isHighlighted,
          createdBy: userName,
          updatedBy: userName,
          importBatchId: batch.id,
        },
      });
      existingKeys.add(key);
      created += 1;
      createdItems.push(serializeConnectorParameter(item));
      await snapshotChange({ entityType: 'connector_parameter', entityId: item.id, action: 'create_connector_parameter', after: connectorParameterSnapshot(item), changedBy: userName });
      results.push({ row: index, model: item.model || '', status: 'created', message: row.status === 'duplicate' ? '重复行已按策略导入' : '已新增' });
    }

    await prisma.connectorParameterImportBatch.update({
      where: { id: batch.id },
      data: {
        insertedCount: created,
        summaryJson: {
          totalRows: previewSummary.totalRows,
          readyCount: previewSummary.readyCount,
          duplicateCount: previewSummary.duplicateCount,
          invalidCount: previewSummary.invalidCount,
          skippedCount: previewSummary.skippedCount,
          highlightedCount: previewSummary.highlightedCount,
          created,
          skipped,
          failed,
          duplicateSkipped,
        },
      },
    });
    await logOp({ userId: user.id, action: 'import_connector_parameters', targetType: 'connector_parameter', detail: { created, skipped, failed, duplicateSkipped, duplicateStrategy, total: results.length, batchId: batch.id, client: 'harmony_native' } });
    await logOp({ userId: user.id, action: 'create_connector_parameter_import_batch', targetType: 'connector_parameter_import_batch', targetId: batch.id, detail: { created, skipped, failed, duplicateSkipped, duplicateStrategy, total: results.length, client: 'harmony_native' } });
    await snapshotChange({ entityType: 'connector_parameter_import_batch', entityId: batch.id, action: 'create_connector_parameter_import_batch', after: { id: batch.id, sourceType: batch.sourceType, fileName: batch.fileName, insertedCount: created, totalRows: rows.length }, changedBy: userName });
    return nativeOk({ summary: { created, skipped, failed, duplicateSkipped, total: results.length }, results, parameters: createdItems, batch: { id: batch.id, insertedCount: created } });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('确认导入失败', 500);
  }
}
