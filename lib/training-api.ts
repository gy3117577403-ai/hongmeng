import { NextResponse } from 'next/server';
import { unauthorized, UnauthorizedError } from '@/lib/auth';
import { TrainingInputError } from '@/lib/training';
import { TrainingQrError } from '@/lib/training-qr';

export function trainingApiError(error: unknown, fallback: string, logLabel: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof TrainingQrError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.statusCode },
    );
  }
  if (error instanceof TrainingInputError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: 'TRAINING_INPUT_INVALID' },
      { status: error.statusCode },
    );
  }
  console.error(logLabel, error);
  return NextResponse.json(
    { ok: false, error: fallback, code: 'TRAINING_INTERNAL_ERROR' },
    { status: 500 },
  );
}
