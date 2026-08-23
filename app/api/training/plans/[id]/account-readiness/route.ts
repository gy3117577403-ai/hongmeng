import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { trainingApiError } from '@/lib/training-api';
import { trainingPlanAccountReadiness } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const data = await trainingPlanAccountReadiness(params.id);
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return trainingApiError(error, '参训账号检查失败', 'training account readiness failed');
  }
}
