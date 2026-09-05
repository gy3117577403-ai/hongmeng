import { NextResponse } from 'next/server';
import { ForbiddenError, requireCapability, UnauthorizedError } from '@/lib/auth';
import { qualityActor, QualityDataError } from '@/lib/quality-data';
import { ReportDateRangeError } from '@/lib/report-date-range';
export async function qualitySession(action: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' = 'READ') {
  const user = await requireCapability('QUALITY_DATA', action);
  return { user, actor: qualityActor(user) };
}
export function qualityError(error: unknown) {
  if (error instanceof QualityDataError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof UnauthorizedError) return NextResponse.json({ ok: false, error: '请登录后操作' }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '没有质量数据访问权限' }, { status: 403 });
  if (error instanceof SyntaxError || error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: '请求内容或日期范围不正确' }, { status: 400 });
  console.error('quality data request failed', error);
  return NextResponse.json({ ok: false, error: '质量数据操作失败，请稍后重试' }, { status: 500 });
}
export async function qualityBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 256000) throw new QualityDataError('表单内容过大', 413);
  const body = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new QualityDataError('请求格式不正确');
  return body;
}
