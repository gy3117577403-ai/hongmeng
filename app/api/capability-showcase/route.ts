import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import {
  getCapabilityShowcaseWorkbench,
  saveCapabilityShowcaseDraft,
} from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const workbench = await getCapabilityShowcaseWorkbench(user.id);
    return NextResponse.json({ ok: true, ...workbench });
  } catch (error) {
    return capabilityShowcaseApiError(error, '能力展厅读取失败');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null) as null | { expectedRevision?: unknown; content?: unknown };
    const result = await saveCapabilityShowcaseDraft({
      userId: user.id,
      expectedRevision: Number(body?.expectedRevision),
      content: body?.content,
    });
    await logOp({
      userId: user.id,
      action: 'update_capability_showcase_draft',
      targetType: 'capability_showcase',
      detail: { draftRevision: result.draftRevision },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return capabilityShowcaseApiError(error, '能力展厅保存失败');
  }
}
