import { connectorTemplateCsv } from '@/lib/connector-parameters';
import { csvResponse } from '@/lib/data-tools';
import { NativeUnauthorizedError, nativeError, nativeUnauthorized, requireNativeDownloadUser } from '@/lib/native-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireNativeDownloadUser(req);
    return csvResponse('connector-parameters-template.csv', connectorTemplateCsv());
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('下载模板失败', 500);
  }
}
