import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, localImportTaskData, pairLocalImportTask } from '@/lib/local-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RateState = { count: number; resetAt: number };
const globalRate = globalThis as typeof globalThis & { localImportPairingRate?: Map<string, RateState> };
const rateMap = globalRate.localImportPairingRate ?? new Map<string, RateState>();
globalRate.localImportPairingRate = rateMap;

function clientKey(req: NextRequest) {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'local')
    .split(',')[0]
    .trim()
    .slice(0, 96);
}

function assertPairingRate(req: NextRequest) {
  const key = clientKey(req);
  const now = Date.now();
  if (rateMap.size > 1_000) {
    for (const [itemKey, item] of rateMap) if (item.resetAt <= now) rateMap.delete(itemKey);
  }
  const current = rateMap.get(key);
  if (!current || current.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return;
  }
  if (current.count >= 8) throw Object.assign(new Error('任务码尝试过多，请稍后重试'), { pairingRateLimited: true });
  current.count += 1;
}

function appBaseUrl(req: NextRequest) {
  const configured = process.env.APP_BASE_URL?.trim();
  return configured ? new URL(configured).origin : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    assertPairingRate(req);
    const body = await req.json().catch(() => ({})) as { code?: unknown; helperInstanceId?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const helperInstanceId = typeof body.helperInstanceId === 'string' ? body.helperInstanceId : '';
    const { task, ticket, alreadyConnected } = await pairLocalImportTask(code, helperInstanceId);
    return NextResponse.json({
      ok: true,
      data: {
        taskId: task.id,
        ticket,
        baseUrl: appBaseUrl(req),
        expiresAt: task.detail.expiresAt,
        alreadyConnected,
        task: await localImportTaskData(task),
      },
    });
  } catch (error) {
    if (error instanceof Error && 'pairingRateLimited' in error) {
      return NextResponse.json({ ok: false, error: error.message, code: 'PAIRING_RATE_LIMITED' }, { status: 429 });
    }
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
