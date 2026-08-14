import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorized } from '@/lib/auth';
import {
  CapabilityShowcaseConflictError,
  CapabilityShowcaseNotFoundError,
  CapabilityShowcaseValidationError,
} from '@/lib/capability-showcase-service';

export function capabilityShowcaseApiError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof CapabilityShowcaseValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof CapabilityShowcaseConflictError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof CapabilityShowcaseNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
