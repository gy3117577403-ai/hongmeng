import { NextResponse } from 'next/server';
import { trainingApiError } from '@/lib/training-api';
import { requireTrainingSelfUser } from '@/lib/training-self-auth';
import { checkInTrainingSelf } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { code: string } }) {
  try {
    const user = await requireTrainingSelfUser();
    const data = await checkInTrainingSelf({ code: params.code, employeeId: user.employeeId! });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return trainingApiError(error, '培训签到失败', 'training self check-in failed');
  }
}
