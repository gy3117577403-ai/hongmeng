import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { trainingApiError } from '@/lib/training-api';
import { trainingSessionLive } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const data = await trainingSessionLive(params.id);
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return trainingApiError(error, '培训现场数据加载失败', 'training session live load failed');
  }
}
