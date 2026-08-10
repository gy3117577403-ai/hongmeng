import { ForbiddenError } from '@/lib/auth';

/**
 * Cookie-authenticated mutations must originate from the current deployment.
 * This accepts direct/local access and the forwarded host/protocol pair used by
 * the production reverse proxy.
 */
export function assertSameOriginMutationRequest(request: Request): void {
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

  if (!allowedOrigins.has(origin)) throw new ForbiddenError('跨站请求已拒绝');
}
