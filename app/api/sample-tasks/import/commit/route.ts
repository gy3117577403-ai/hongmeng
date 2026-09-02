import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { drawingLibraryKey, invalidSpecificationReason, parseCustomerCode } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';
import {
  cleanImportText,
  parsePositiveInteger,
  parseSamplePlanDate,
  samplePlanFingerprint,
} from '@/lib/sample-plan-import';
import { sampleActor, sampleQrCode, sampleRequestHash, sampleTaskCode } from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportDecision = { mode: 'reuse'; drawingLibraryItemId: string } | { mode: 'create' };

type CommitRow = {
  rowNumber: number;
  customerName: string;
  productName: string;
  specification: string;
  customerLevelCode: string;
  sampleQuantity: number;
  dueDate: string;
  libraryKey: string;
  matchStatus: string;
};

function normalizeDecision(value: unknown): ImportDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.mode === 'create') return { mode: 'create' };
  const drawingLibraryItemId = cleanImportText(record.drawingLibraryItemId, 80);
  return record.mode === 'reuse' && drawingLibraryItemId ? { mode: 'reuse', drawingLibraryItemId } : null;
}

function normalizeRow(value: unknown): { row: CommitRow | null; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { row: null, error: '数据格式无效' };
  const record = value as Record<string, unknown>;
  const rowNumber = Number(record.rowNumber);
  const customerName = cleanImportText(record.customerName);
  const productName = cleanImportText(record.productName);
  const specification = cleanImportText(record.specification);
  const level = sampleCustomerLevel(record.customerLevelCode);
  const sampleQuantity = parsePositiveInteger(record.sampleQuantity);
  const dueDate = parseSamplePlanDate(record.dueDate);
  const libraryKey = cleanImportText(record.libraryKey, 240);
  const errors: string[] = [];
  if (!Number.isInteger(rowNumber) || rowNumber < 1) errors.push('行号无效');
  if (!customerName) errors.push('客户名称不能为空');
  if (!productName) errors.push('产品名称不能为空');
  if (!specification) errors.push('型号/规格不能为空');
  if (specification) {
    const reason = invalidSpecificationReason(specification);
    if (reason) errors.push(`型号/规格格式异常：${reason}`);
  }
  if (!level) errors.push('客户等级只能是 A、B、C、D');
  if (sampleQuantity === null) errors.push('样品数量必须是大于 0 的整数');
  if (!dueDate) errors.push('计划日期无效');
  if (errors.length || !level || sampleQuantity === null || !dueDate) return { row: null, error: errors.join('；') };
  return {
    row: {
      rowNumber,
      customerName,
      productName,
      specification,
      customerLevelCode: level.code,
      sampleQuantity,
      dueDate,
      libraryKey,
      matchStatus: cleanImportText(record.matchStatus, 20).toUpperCase(),
    },
    error: '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mutationId = cleanImportText(body.clientMutationId, 100);
    const sourceFileName = cleanImportText(body.fileName, 255);
    const rawRows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
    const rawDecisions = body.decisions && typeof body.decisions === 'object' && !Array.isArray(body.decisions)
      ? body.decisions as Record<string, unknown>
      : {};
    if (!mutationId) return NextResponse.json({ ok: false, error: '导入请求编号缺失，请重新打开导入窗口' }, { status: 400 });
    if (!rawRows.length) return NextResponse.json({ ok: false, error: '没有可导入的数据' }, { status: 400 });
    const requestHash = sampleRequestHash({ rows: rawRows, decisions: rawDecisions, sourceFileName });

    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-plan-import:${mutationId}`}))`;
      const replay = await tx.sampleTaskImportBatch.findUnique({ where: { mutationId } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error('SAMPLE_IMPORT_MUTATION_CONFLICT');
        return { ...(replay.result as Record<string, unknown> || {}), replayed: true };
      }

      const rows = rawRows.map(normalizeRow);
      const seen = new Set<string>();
      const results: Array<Record<string, unknown>> = [];
      let createdTaskCount = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const normalized = rows[index];
        const raw = rawRows[index] as Record<string, unknown>;
        const fallbackRowNumber = Number(raw?.rowNumber) || index + 1;
        if (!normalized.row) {
          results.push({ rowNumber: fallbackRowNumber, status: 'BLOCKED', message: normalized.error || '数据格式无效' });
          continue;
        }
        const row = normalized.row;
        if (row.matchStatus === 'BLOCKED') {
          results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: '预览已标记为阻止导入，请修正模板后重新上传' });
          continue;
        }
        const fingerprint = samplePlanFingerprint(row);
        if (seen.has(fingerprint)) {
          results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: '本批次存在重复计划，未重复创建' });
          continue;
        }
        seen.add(fingerprint);
        const decision = normalizeDecision(rawDecisions[String(row.rowNumber)]);
        let item = null;
        if (row.libraryKey) {
          item = await tx.drawingLibraryItem.findFirst({ where: { OR: [{ id: row.libraryKey }, { libraryKey: row.libraryKey }] } });
          if (!item) {
            results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: '图纸库编号不存在' });
            continue;
          }
        } else if (decision?.mode === 'reuse') {
          item = await tx.drawingLibraryItem.findFirst({ where: { id: decision.drawingLibraryItemId, deletedAt: null } });
          if (!item) {
            results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: '选择的图纸库已不存在，请重新预览' });
            continue;
          }
        } else {
          const key = drawingLibraryKey(row.customerName, row.specification);
          item = await tx.drawingLibraryItem.findUnique({ where: { libraryKey: key } });
          if (!item && row.matchStatus === 'CONFIRM' && decision?.mode !== 'create') {
            results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: '相似图纸库尚未确认' });
            continue;
          }
          if (!item) {
            item = await tx.drawingLibraryItem.create({
              data: {
                customerName: row.customerName,
                customerCode: parseCustomerCode(row.customerName),
                productName: row.productName,
                specification: row.specification,
                libraryKey: key,
              },
            });
          }
        }
        if (item.deletedAt) {
          item = await tx.drawingLibraryItem.update({ where: { id: item.id }, data: { deletedAt: null } });
        } else if (!item.productName && row.productName && drawingLibraryKey(item.customerName, item.specification) === drawingLibraryKey(row.customerName, row.specification)) {
          item = await tx.drawingLibraryItem.update({ where: { id: item.id }, data: { productName: row.productName } });
        }
        const level = sampleCustomerLevel(row.customerLevelCode)!;
        const dueDate = new Date(`${row.dueDate}T00:00:00.000Z`);
        const duplicate = await tx.sampleTask.findFirst({
          where: {
            drawingLibraryItemId: item.id,
            customerLevelCode: level.code,
            sampleQuantity: row.sampleQuantity,
            dueDate,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
          select: { id: true, code: true },
        });
        if (duplicate) {
          results.push({ rowNumber: row.rowNumber, status: 'BLOCKED', message: `系统已有相同计划 ${duplicate.code}，未重复创建`, existingTaskId: duplicate.id });
          continue;
        }
        const task = await tx.sampleTask.create({
          data: {
            code: sampleTaskCode(),
            qrCode: sampleQrCode(),
            drawingLibraryItemId: item.id,
            customerNameSnapshot: item.customerName,
            productNameSnapshot: item.productName,
            specificationSnapshot: item.specification,
            customerLevelCode: level.code,
            customerLevelLabel: level.label,
            customerLevelColor: level.color,
            sampleQuantity: row.sampleQuantity,
            dueDate,
            priority: level.priority,
            createdById: actor.id,
            createdByName: actor.name,
            updatedById: actor.id,
            updatedByName: actor.name,
          },
          select: { id: true, code: true },
        });
        createdTaskCount += 1;
        results.push({ rowNumber: row.rowNumber, status: 'CREATED', message: '样品计划已创建', taskId: task.id, taskCode: task.code, drawingLibraryItemId: item.id });
      }
      const payload = {
        createdTaskCount,
        blockedCount: results.filter(item => item.status === 'BLOCKED').length,
        total: results.length,
        rows: results,
      };
      await tx.sampleTaskImportBatch.create({
        data: {
          mutationId,
          requestHash,
          sourceFileName: sourceFileName || null,
          rowCount: results.length,
          createdTaskCount,
          result: payload as Prisma.InputJsonValue,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'bulk_import_sample_tasks',
          targetType: 'sample_task_import_batch',
          targetId: mutationId,
          detail: { sourceFileName, rowCount: results.length, createdTaskCount, blockedCount: payload.blockedCount },
        },
      });
      return payload;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'SAMPLE_IMPORT_MUTATION_CONFLICT') {
      return NextResponse.json({ ok: false, error: '同一导入请求的内容已变化，请关闭窗口后重新导入' }, { status: 409 });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '导入期间检测到并发重复数据，请重新预览' }, { status: 409 });
    }
    console.error('sample plan import commit failed', error);
    return NextResponse.json({ ok: false, error: '批量导入提交失败，未完成的数据请重新预览' }, { status: 500 });
  }
}
