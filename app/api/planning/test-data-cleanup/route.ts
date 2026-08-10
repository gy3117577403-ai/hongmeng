import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  previewProductionTestDataRetirement,
  ProductionTestRetirementError,
  retireProductionTestData,
  TEST_RETIREMENT_CONFIRMATION,
} from '@/lib/production-test-data-retirement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const preview = await previewProductionTestDataRetirement();
    const response = NextResponse.json({ ok: true, preview, confirmationText: TEST_RETIREMENT_CONFIRMATION });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('production test data retirement preview failed', error);
    return NextResponse.json({ ok: false, error: '测试订单清理预检失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { fingerprint?: unknown; confirmation?: unknown };
    if (body.confirmation !== TEST_RETIREMENT_CONFIRMATION) {
      return NextResponse.json({ ok: false, error: `请输入“${TEST_RETIREMENT_CONFIRMATION}”后再执行` }, { status: 400 });
    }
    const result = await retireProductionTestData({
      actorId: user.id,
      fingerprint: String(body.fingerprint || ''),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionTestRetirementError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production test data retirement failed', error);
    return NextResponse.json({ ok: false, error: '测试订单清理失败，未修改任何数据' }, { status: 500 });
  }
}
