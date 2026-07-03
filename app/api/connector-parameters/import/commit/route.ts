import { NextRequest, NextResponse } from 'next/server';
import {
  ConnectorImportPreviewRow,
  connectorDuplicateKey,
  parseConnectorParameterInput,
  serializeConnectorParameter,
} from '@/lib/connector-parameters';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CommitBody = {
  rows?: ConnectorImportPreviewRow[];
  duplicateStrategy?: 'skip' | 'import';
};

async function existingDuplicateKeys() {
  const items = await prisma.connectorParameter.findMany({
    where: { deletedAt: null },
    select: {
      model: true,
      outerPeelMm: true,
      innerPeelMm: true,
      insertionLengthMm: true,
      remark: true,
    },
  });
  return new Set(items.map(connectorDuplicateKey));
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as CommitBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return NextResponse.json({ ok: false, error: '缺少待确认导入的数据' }, { status: 400 });

    const duplicateStrategy = body.duplicateStrategy === 'import' ? 'import' : 'skip';
    const existingKeys = await existingDuplicateKeys();
    const userName = user.displayName || user.username;
    const results: { row: number; model: string; status: 'created' | 'skipped' | 'failed'; message: string }[] = [];
    const createdItems = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let duplicateSkipped = 0;

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
          ...parsed.data,
          createdBy: userName,
          updatedBy: userName,
        },
      });
      existingKeys.add(key);
      created += 1;
      createdItems.push(serializeConnectorParameter(item));
      results.push({ row: index, model: item.model || '', status: 'created', message: row.status === 'duplicate' ? '重复行已按策略导入' : '已新增' });
    }

    await logOp({
      userId: user.id,
      action: 'import_connector_parameters',
      targetType: 'connector_parameter',
      detail: { created, skipped, failed, duplicateSkipped, duplicateStrategy, total: results.length },
    });

    return NextResponse.json({
      ok: true,
      summary: { created, skipped, failed, duplicateSkipped, total: results.length },
      results,
      parameters: createdItems,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '确认导入失败' }, { status: 500 });
  }
}
