import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueDetailInclude, serializeIssue } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const issue = await prisma.issue.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 2000) : '';
    if (!content) return NextResponse.json({ ok: false, error: '处理记录不能为空' }, { status: 400 });
    const updated = await prisma.$transaction(async tx => {
      await tx.issueActivity.create({ data: { issueId: issue.id, action: 'comment', content, actorId: user.id } });
      await tx.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });
      return tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: 'comment_issue', targetType: 'issue', targetId: issue.id });
    return NextResponse.json({ ok: true, issue: serializeIssue(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue comment failed', error);
    return NextResponse.json({ ok: false, error: '处理记录保存失败' }, { status: 500 });
  }
}
