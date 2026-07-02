import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse } from '@/lib/data-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return csvResponse('工单导入模板.csv', csv([
      ['工单号', '产品名称', '状态', '优先级', '进度', '计划时间', '备注'],
      ['WO-20260702-001', '示例产品线束总成', '在前端', '高', 50, '2026-07-02 16:00', '可选备注'],
    ]));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '下载模板失败' }, { status: 500 });
  }
}
