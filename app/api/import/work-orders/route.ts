import { NextRequest } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseCsv } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headerMap: Record<string, string> = {
  工单号: 'code',
  产品名称: 'productName',
  阶段: 'stage',
  优先级: 'priority',
  状态: 'status',
  进度: 'progress',
  备注: 'remark',
  code: 'code',
  productName: 'productName',
  stage: 'stage',
  priority: 'priority',
  status: 'status',
  progress: 'progress',
  remark: 'remark',
};

const stageMap: Record<string, string> = {
  前端: '前端',
  frontend: '前端',
  后端: '后端',
  backend: '后端',
  未发图: '未发图',
  pending: '未发图',
};

const priorityMap: Record<string, string> = {
  紧急: 'urgent',
  urgent: 'urgent',
  高: 'high',
  high: 'high',
  一般: 'normal',
  normal: 'normal',
};

const statusMap: Record<string, string> = {
  待处理: 'pending',
  pending: 'pending',
  进行中: 'processing',
  processing: 'processing',
  已完成: 'done',
  completed: 'done',
  done: 'done',
};

type ImportResult = {
  row: number;
  code: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  message: string;
};

function normalize(v: string | undefined) {
  return String(v || '').trim();
}

function rowToData(headers: string[], row: string[]) {
  const raw: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = headerMap[header.trim()];
    if (key) raw[key] = normalize(row[index]);
  });

  const errors: string[] = [];
  const code = raw.code || '';
  const productName = raw.productName || '';
  if (!code) errors.push('工单号必填');
  if (!productName) errors.push('产品名称必填');

  const stage = stageMap[raw.stage || '未发图'] || '';
  if (!stage) errors.push('阶段不正确');
  const priority = priorityMap[raw.priority || '一般'] || '';
  if (!priority) errors.push('优先级不正确');
  const status = statusMap[raw.status || '待处理'] || '';
  if (!status) errors.push('状态不正确');
  const progress = Number(raw.progress || 0);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.push('进度必须在 0-100 之间');

  return {
    code,
    data: {
      code: code.slice(0, 80),
      productName: productName.slice(0, 120),
      stage,
      priority,
      status,
      progress: Math.round(progress),
      remark: raw.remark ? raw.remark.slice(0, 500) : null,
    },
    errors,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return Response.json({ ok: false, error: '请选择 CSV 文件' }, { status: 400 });
    if (!upload.name.toLowerCase().endsWith('.csv')) return Response.json({ ok: false, error: '仅支持 CSV 文件' }, { status: 400 });

    const text = new TextDecoder('utf-8').decode(await upload.arrayBuffer());
    const rows = parseCsv(text);
    if (rows.length < 2) return Response.json({ ok: false, error: 'CSV 内容为空' }, { status: 400 });

    const headers = rows[0].map(h => h.trim());
    const results: ImportResult[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const line = i + 1;
      const parsed = rowToData(headers, rows[i]);
      if (parsed.errors.length) {
        failed += 1;
        results.push({ row: line, code: parsed.code || '-', status: 'failed', message: parsed.errors.join('；') });
        continue;
      }

      const existing = await prisma.workOrder.findUnique({ where: { code: parsed.data.code } });
      if (existing?.deletedAt) {
        skipped += 1;
        results.push({ row: line, code: parsed.data.code, status: 'skipped', message: '同工单号记录已软删除，已跳过' });
        continue;
      }

      if (existing) {
        await prisma.workOrder.update({
          where: { id: existing.id },
          data: {
            productName: parsed.data.productName,
            stage: parsed.data.stage,
            priority: parsed.data.priority,
            status: parsed.data.status,
            progress: parsed.data.progress,
            remark: parsed.data.remark,
          },
        });
        updated += 1;
        results.push({ row: line, code: parsed.data.code, status: 'updated', message: '已更新' });
      } else {
        await prisma.workOrder.create({ data: parsed.data });
        created += 1;
        results.push({ row: line, code: parsed.data.code, status: 'created', message: '已新增' });
      }
    }

    await logOp({
      userId: user.id,
      action: 'import_work_orders',
      targetType: 'work_order',
      detail: { created, updated, skipped, failed, total: results.length },
    });

    return Response.json({
      ok: true,
      summary: { created, updated, skipped, failed, total: results.length },
      results,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导入工单失败' }, { status: 500 });
  }
}
