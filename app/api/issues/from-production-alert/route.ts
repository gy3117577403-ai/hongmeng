import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  alertsForProductionOrder,
  issueDetailInclude,
  issueFingerprint,
  priorityForAlert,
  serializeIssue,
  typeForAlert,
  type IssueDetailRecord,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { loadProductionOrderById } from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workOrderId = optionalText(body.workOrderId, 80);
    const alertCode = optionalText(body.alertCode, 80);
    if (!workOrderId || !alertCode) return NextResponse.json({ ok: false, error: '缺少工单或异常类型' }, { status: 400 });

    const order = await loadProductionOrderById(workOrderId);
    if (!order) return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    const alert = alertsForProductionOrder(order).find(item => item.code === alertCode);
    if (!alert) return NextResponse.json({ ok: false, error: '该生产异常已不存在，请刷新后重试' }, { status: 409 });

    const assigneeId = optionalText(body.assigneeId, 80);
    if (assigneeId) {
      const exists = await prisma.user.findFirst({ where: { id: assigneeId, isActive: true }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '负责人不存在或已停用' }, { status: 404 });
    }
    let dueAt: Date | null = null;
    if (typeof body.dueAt === 'string' && body.dueAt.trim()) {
      dueAt = new Date(body.dueAt);
      if (Number.isNaN(dueAt.getTime())) return NextResponse.json({ ok: false, error: '截止时间格式不正确' }, { status: 400 });
    }

    const fingerprint = issueFingerprint(order.id, alert.code);
    const specification = order.specification?.trim() || order.code;
    const customer = order.customerName?.trim() || '客户未设置';
    const sourceRoute = `/production?${new URLSearchParams({ view: 'exceptions', keyword: specification }).toString()}`;

    let result: { issue: IssueDetailRecord; created: boolean; restored: boolean };
    try {
      result = await prisma.$transaction(async tx => {
        const existing = await tx.issue.findUnique({ where: { sourceFingerprint: fingerprint } });
        if (existing && !existing.deletedAt) {
          const current = await tx.issue.findUniqueOrThrow({ where: { id: existing.id }, include: issueDetailInclude });
          return { issue: current, created: false, restored: false };
        }
        if (existing) {
          await tx.issue.update({
            where: { id: existing.id },
            data: {
              title: `${alert.label}：${specification}`,
              type: typeForAlert(alert.code),
              priority: priorityForAlert(alert),
              status: 'pending',
              description: `${customer} · ${order.productName}\n系统检测到：${alert.label}`,
              assigneeId,
              dueAt,
              reporterId: user.id,
              sourceRoute,
              deletedAt: null,
              resolvedAt: null,
              verifiedAt: null,
              closedAt: null,
            },
          });
          await tx.issueActivity.create({ data: { issueId: existing.id, action: 'restore_from_source', content: '从生产异常收件箱恢复问题', actorId: user.id } });
          const restored = await tx.issue.findUniqueOrThrow({ where: { id: existing.id }, include: issueDetailInclude });
          return { issue: restored, created: false, restored: true };
        }
        const created = await tx.issue.create({
          data: {
            title: `${alert.label}：${specification}`,
            type: typeForAlert(alert.code),
            priority: priorityForAlert(alert),
            status: 'pending',
            description: `${customer} · ${order.productName}\n系统检测到：${alert.label}`,
            sourceType: 'production_alert',
            sourceId: order.id,
            sourceCode: specification,
            sourceRoute,
            sourceAlertCode: alert.code,
            sourceFingerprint: fingerprint,
            workOrderId: order.id,
            reporterId: user.id,
            assigneeId,
            dueAt,
          },
        });
        await tx.issueActivity.create({ data: { issueId: created.id, action: 'create_from_source', content: `由生产异常“${alert.label}”转入`, actorId: user.id } });
        const issue = await tx.issue.findUniqueOrThrow({ where: { id: created.id }, include: issueDetailInclude });
        return { issue, created: true, restored: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const issue = await prisma.issue.findUniqueOrThrow({ where: { sourceFingerprint: fingerprint }, include: issueDetailInclude });
      result = { issue, created: false, restored: false };
    }

    if (result.created || result.restored) {
      await logOp({
        userId: user.id,
        action: result.restored ? 'restore_issue_from_production_alert' : 'create_issue_from_production_alert',
        targetType: 'issue',
        targetId: result.issue.id,
        detail: { workOrderId: order.id, alertCode: alert.code },
      });
    }
    return NextResponse.json({ ok: true, created: result.created, restored: result.restored, issue: serializeIssue(result.issue) }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('create issue from production alert failed', error);
    return NextResponse.json({ ok: false, error: '生产异常转问题失败' }, { status: 500 });
  }
}
