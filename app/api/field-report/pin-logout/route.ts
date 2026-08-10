import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, forbidden } from '@/lib/auth';
import {
  assertFieldReportBrowserMutation,
  clearFieldReportPinSessionCookie,
  revokeCurrentFieldReportPinSession,
} from '@/lib/field-report-pin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    assertFieldReportBrowserMutation(req);
    await revokeCurrentFieldReportPinSession();
    const response = NextResponse.json({ ok: true });
    clearFieldReportPinSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
    console.error('field report pin logout failed', error);
    return NextResponse.json({ ok: false, error: 'PIN 身份退出失败' }, { status: 500 });
  }
}
