import { NextRequest } from 'next/server';
import { NativeUnauthorizedError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    return nativeOk({ user });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    return nativeUnauthorized();
  }
}
