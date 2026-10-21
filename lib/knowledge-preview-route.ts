import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorized } from '@/lib/auth';
import { KnowledgePreviewError } from '@/lib/knowledge-preview';
export function previewRouteError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof KnowledgePreviewError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error('Knowledge preview request failed', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json({ ok: false, error: '预览暂时无法读取，请重试' }, { status: 500 });
}
