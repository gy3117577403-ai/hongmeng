import { NextRequest } from 'next/server';
import { isAllowedNativeDownloadPath, nativeError, nativeOk, NativeUnauthorizedError, nativeUnauthorized, requireNativeUser, ticketedNativeDownloadPath } from '@/lib/native-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || '';
    if (!path.startsWith('/api/native/')) return nativeError('下载路径不合法', 400);
    if (!isAllowedNativeDownloadPath(path)) return nativeError('下载路径不允许', 400);
    return nativeOk({ url: ticketedNativeDownloadPath(path, user.id) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('下载授权失败', 500);
  }
}
