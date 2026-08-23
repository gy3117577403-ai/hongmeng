import { NextResponse } from 'next/server';
import { trainingApiError } from '@/lib/training-api';
import { requireTrainingSelfUser } from '@/lib/training-self-auth';
import { resolveTrainingSelfScan } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  try {
    const user = await requireTrainingSelfUser();
    const data = await resolveTrainingSelfScan({ code: params.code, employeeId: user.employeeId! });
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return trainingApiError(error, '培训二维码读取失败', 'training self scan failed');
  }
}
