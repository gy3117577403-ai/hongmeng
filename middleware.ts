import { NextRequest, NextResponse } from 'next/server';

const ORIGINAL_METHOD_HEADER = 'x-hm-request-method';
const ORIGINAL_PATH_HEADER = 'x-hm-request-path';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ORIGINAL_METHOD_HEADER, request.method.toUpperCase());
  requestHeaders.set(ORIGINAL_PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: '/api/:path*',
};
