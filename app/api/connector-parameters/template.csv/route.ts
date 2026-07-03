import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { connectorTemplateCsv } from '@/lib/connector-parameters';
import { csvResponse } from '@/lib/data-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return csvResponse('连接器参数导入模板.csv', connectorTemplateCsv());
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '下载模板失败' }, { status: 500 });
  }
}
