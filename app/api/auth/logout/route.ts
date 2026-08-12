import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/constants';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const user = await currentUser();
    if (user) {
      await logOp({ userId: user.id, action: 'logout', targetType: 'user', targetId: user.id });
    }
  } catch (error) {
    // Logging out must still clear the browser session when the audit store is
    // temporarily unavailable. Keep the failure visible in server diagnostics.
    console.error('logout audit failed', error);
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
