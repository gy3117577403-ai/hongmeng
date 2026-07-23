import { NextRequest, NextResponse } from 'next/server';

const ORIGINAL_METHOD_HEADER = 'x-hm-request-method';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ORIGINAL_METHOD_HEADER, request.method.toUpperCase());
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: '/api/:path*',
};
