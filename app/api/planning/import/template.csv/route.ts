import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse } from '@/lib/data-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return csvResponse('周排单清单导入模板.csv', csv([
      ['订单日期', '业务员', '客户名称', '客户等级', '品名', '规格', '工序', '未交量', '工时', '总工时', '图纸', '交期', '配料', '备注', '图纸下发日期'],
      ['2026-07-27', '张三', '示例客户', 'A', '示例线束总成', 'D011601-8175-V01', '裁线', 1000, '13分', '216.67小时', '已发图', '周五', '未配料', '示例排单', '2026-07-27'],
    ]));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '下载模板失败' }, { status: 500 });
  }
}
