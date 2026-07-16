import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  issueDetailInclude,
  parseIssueInput,
  serializeIssue,
  summarizeIssues,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import type { IssuePriority, IssueStatus, IssueType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const status = params.get('status');
    const type = params.get('type');
    const priority = params.get('priority');
    const assigneeId = String(params.get('assigneeId') || '').trim();
    const workOrderId = String(params.get('workOrderId') || '').trim();
    const sourceType = String(params.get('sourceType') || '').trim();
    const overdueOnly = params.get('overdue') === 'true';
    const unassignedOnly = params.get('unassigned') === 'true';
    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 40, 100);

    if (status && status !== 'all' && !ISSUE_STATUSES.includes(status as IssueStatus)) {
      return NextResponse.json({ ok: false, error: '问题状态筛选不正确' }, { status: 400 });
    }
    if (type && type !== 'all' && !ISSUE_TYPES.includes(type as IssueType)) {
      return NextResponse.json({ ok: false, error: '问题类型筛选不正确' }, { status: 400 });
    }
    if (priority && priority !== 'all' && !ISSUE_PRIORITIES.includes(priority as IssuePriority)) {
      return NextResponse.json({ ok: false, error: '优先级筛选不正确' }, { status: 400 });
    }

    const where: Prisma.IssueWhereInput = { deletedAt: null };
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;
    if (priority && priority !== 'all') where.priority = priority;
    if (assigneeId) where.assigneeId = assigneeId;
    if (workOrderId) where.workOrderId = workOrderId;
    if (sourceType) where.sourceType = sourceType;
    if (unassignedOnly) where.assigneeId = null;
    if (overdueOnly) {
      where.status = { not: 'closed' };
      where.dueAt = { lt: new Date() };
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { sourceCode: { contains: keyword, mode: 'insensitive' } },
        { rootCause: { contains: keyword, mode: 'insensitive' } },
        { solution: { contains: keyword, mode: 'insensitive' } },
        { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
      ];
      const sequence = Number(keyword.replace(/^ISS-/i, ''));
      if (Number.isInteger(sequence) && sequence > 0) where.OR.push({ sequence });
    }

    const [records, total, summary] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: issueDetailInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.issue.count({ where }),
      summarizeIssues(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({
      ok: true,
      issues: records.map(serializeIssue),
      summary,
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue list failed', error);
    return NextResponse.json({ ok: false, error: '问题列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const data = parsed.data;

    if (data.workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: data.workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    if (data.assigneeId) {
      const exists = await prisma.user.findFirst({ where: { id: data.assigneeId, isActive: true }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '负责人不存在或已停用' }, { status: 404 });
    }

    const issue = await prisma.$transaction(async tx => {
      const created = await tx.issue.create({
        data: {
          title: data.title as string,
          type: data.type || 'production',
          priority: data.priority || 'normal',
          description: data.description,
          workOrderId: data.workOrderId,
          assigneeId: data.assigneeId,
          dueAt: data.dueAt,
          rootCause: data.rootCause,
          solution: data.solution,
          reporterId: user.id,
          sourceType: 'manual',
          sourceId: data.workOrderId,
          sourceRoute: data.workOrderId ? `/dashboard?workOrderId=${encodeURIComponent(data.workOrderId)}` : '/workspace/issues',
        },
      });
      await tx.issueActivity.create({
        data: { issueId: created.id, action: 'create', content: '创建问题', actorId: user.id },
      });
      return tx.issue.findUniqueOrThrow({ where: { id: created.id }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: 'create_issue', targetType: 'issue', targetId: issue.id, detail: { code: issue.sequence, type: issue.type, priority: issue.priority } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue create failed', error);
    return NextResponse.json({ ok: false, error: '问题创建失败' }, { status: 500 });
  }
}
