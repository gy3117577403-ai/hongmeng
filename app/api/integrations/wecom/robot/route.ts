import { NextRequest, NextResponse } from 'next/server';
import { UnauthorizedError, requireUser, unauthorized } from '@/lib/auth';
import { maskEmployeeMobile } from '@/lib/employee-contact';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  buildWeComRobotTestMessage,
  inspectWeComRobotConfig,
  sendWeComRobotText,
  toWeComMentionMobile,
  WECOM_ROBOT_TEST_MAX_RECIPIENTS,
  WeComRobotError,
} from '@/lib/wecom-robot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEST_COOLDOWN_MS = 30_000;

function serializeRecipient(employee: {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  mobile: string | null;
}) {
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    team: employee.team,
    maskedMobile: maskEmployeeMobile(employee.mobile),
  };
}

export async function GET() {
  try {
    await requireUser();
    const [employees, lastSuccess] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true, mobile: { not: null } },
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          team: true,
          mobile: true,
          notificationEnabled: true,
        },
        orderBy: [{ employeeNo: 'asc' }],
      }),
      prisma.operationLog.findFirst({
        where: { action: 'send_wecom_robot_test_succeeded' },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const supported = employees.filter(item => Boolean(toWeComMentionMobile(item.mobile)));
    const recipients = supported.filter(item => item.notificationEnabled).map(serializeRecipient);
    const pausedCount = supported.filter(item => !item.notificationEnabled).length;
    const unsupportedCount = employees.length - supported.length;
    return NextResponse.json({
      ok: true,
      config: inspectWeComRobotConfig(),
      recipients,
      counts: {
        activeWithMobile: employees.length,
        eligible: recipients.length,
        paused: pausedCount,
        unsupported: unsupportedCount,
      },
      limits: {
        maxRecipients: WECOM_ROBOT_TEST_MAX_RECIPIENTS,
        cooldownSeconds: TEST_COOLDOWN_MS / 1000,
      },
      lastSuccessAt: lastSuccess?.createdAt.toISOString() || null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('load WeCom robot status failed');
    return NextResponse.json({ ok: false, error: '企业微信连接状态加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let employeeNos: string[] = [];
  let userId: string | null = null;
  try {
    const user = await requireUser();
    userId = user.id;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.confirmed !== true) {
      return NextResponse.json({ ok: false, error: '请先确认这是一次真实的企业微信试发' }, { status: 400 });
    }
    const employeeIds = [...new Set(
      (Array.isArray(body.employeeIds) ? body.employeeIds : [])
        .map(item => String(item || '').trim())
        .filter(Boolean),
    )];
    if (!employeeIds.length) {
      return NextResponse.json({ ok: false, error: '请至少选择 1 名试发员工' }, { status: 400 });
    }
    if (employeeIds.length > WECOM_ROBOT_TEST_MAX_RECIPIENTS) {
      return NextResponse.json({ ok: false, error: `一次最多选择 ${WECOM_ROBOT_TEST_MAX_RECIPIENTS} 人进行联调` }, { status: 400 });
    }

    const config = inspectWeComRobotConfig();
    if (!config.configured) {
      const error = config.state === 'invalid'
        ? 'Sealos 中的 WECOM_ROBOT_WEBHOOK_URL 格式无效'
        : '请先在 Sealos 中配置 WECOM_ROBOT_WEBHOOK_URL';
      return NextResponse.json({ ok: false, error, code: config.state === 'invalid' ? 'WECOM_WEBHOOK_INVALID' : 'WECOM_WEBHOOK_MISSING' }, { status: 503 });
    }

    const recentAttempt = await prisma.operationLog.findFirst({
      where: {
        action: 'send_wecom_robot_test_started',
        createdAt: { gte: new Date(Date.now() - TEST_COOLDOWN_MS) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (recentAttempt) {
      const retryAfter = Math.max(1, Math.ceil((recentAttempt.createdAt.getTime() + TEST_COOLDOWN_MS - Date.now()) / 1000));
      return NextResponse.json({ ok: false, error: `试发冷却中，请 ${retryAfter} 秒后再试`, retryAfter }, {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      });
    }

    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        mobile: true,
        isActive: true,
        notificationEnabled: true,
      },
      orderBy: [{ employeeNo: 'asc' }],
    });
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '部分员工档案不存在，请刷新后重试' }, { status: 409 });
    }
    const invalid = employees.filter(item => !item.isActive || !item.notificationEnabled || !toWeComMentionMobile(item.mobile));
    if (invalid.length) {
      return NextResponse.json({
        ok: false,
        error: `以下员工当前不可通知：${invalid.map(item => `${item.employeeNo} ${item.name}`).join('、')}`,
      }, { status: 409 });
    }

    employeeNos = employees.map(item => item.employeeNo);
    await prisma.operationLog.create({
      data: {
        userId: user.id,
        action: 'send_wecom_robot_test_started',
        targetType: 'wecom_robot',
        detail: { employeeNos, recipientCount: employees.length },
      },
    });
    const content = buildWeComRobotTestMessage(employees);
    await sendWeComRobotText({
      content,
      mentionedMobiles: employees.map(item => item.mobile || ''),
    });
    await logOp({
      userId: user.id,
      action: 'send_wecom_robot_test_succeeded',
      targetType: 'wecom_robot',
      detail: { employeeNos, recipientCount: employees.length },
    });
    return NextResponse.json({
      ok: true,
      recipientCount: employees.length,
      recipients: employees.map(item => ({ employeeNo: item.employeeNo, name: item.name })),
      sentAt: new Date().toISOString(),
      message: '企业微信已接收测试消息，请到机器人所在群确认提醒效果',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const normalized = error instanceof WeComRobotError
      ? error
      : new WeComRobotError('企业微信试发失败，请稍后重试', { status: 500, code: 'WECOM_TEST_FAILED' });
    if (userId) {
      await logOp({
        userId,
        action: 'send_wecom_robot_test_failed',
        targetType: 'wecom_robot',
        detail: {
          employeeNos,
          recipientCount: employeeNos.length,
          code: normalized.code,
          externalCode: normalized.externalCode ?? null,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({
      ok: false,
      error: normalized.message,
      code: normalized.code,
      ...(normalized.externalCode === undefined ? {} : { externalCode: normalized.externalCode }),
    }, { status: normalized.status });
  }
}
