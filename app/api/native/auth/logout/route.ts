import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    await logOp({ userId: user.id, action: 'logout', targetType: 'user', targetId: user.id, detail: { client: 'harmony_native' } });
    return nativeOk({ loggedOut: true });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    return nativeUnauthorized();
  }
}
