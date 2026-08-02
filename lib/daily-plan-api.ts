import { NextResponse } from 'next/server';
import {
  ForbiddenError,
  UnauthorizedError,
  forbidden,
  unauthorized,
} from '@/lib/auth';
import { DailyPlanDisabledError } from '@/lib/daily-plan-feature';

type DomainErrorLike = Error & { status?: number; code?: string };

export function dailyPlanSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function readIdempotencyKey(
  request: Request,
  body: Record<string, unknown>,
): unknown {
  return body.idempotencyKey || request.headers.get('idempotency-key');
}

export function readExpectedVersion(body: Record<string, unknown>): unknown {
  return body.expectedVersion ?? body.version;
}

/**
 * Daily-plan mutations are cookie-authenticated, so reject browser requests
 * that originate outside the current deployment origin. `url.origin` covers
 * direct/local access while the forwarded host/protocol pair covers the
 * production reverse proxy.
 */
export function assertDailyPlanMutationRequest(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ForbiddenError('跨站请求已拒绝');
  }

  const origin = request.headers.get('origin');
  if (!origin) return;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || url.host;
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || url.protocol.replace(':', '');
  const allowedOrigins = new Set([url.origin, `${protocol}://${host}`]);

  if (!allowedOrigins.has(origin)) {
    throw new ForbiddenError('跨站请求已拒绝');
  }
}

export function dailyPlanError(error: unknown, context: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof DailyPlanDisabledError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, error: '请求内容不是有效的 JSON', code: 'DAILY_PLAN_BODY_INVALID' },
      { status: 400 },
    );
  }
  if (error instanceof Error) {
    const domainError = error as DomainErrorLike;
    // Only expected client errors may be reflected back to callers. A service,
    // database or upstream error that happens to carry a 5xx status can contain
    // implementation details and must follow the generic server-error path.
    if (
      Number.isInteger(domainError.status)
      && domainError.status! >= 400
      && domainError.status! < 500
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: domainError.message,
          code: domainError.code || 'DAILY_PLAN_INVALID',
        },
        { status: domainError.status },
      );
    }
  }
  console.error(context, error);
  return NextResponse.json(
    { ok: false, error: '日计划操作失败', code: 'DAILY_PLAN_OPERATION_FAILED' },
    { status: 500 },
  );
}
