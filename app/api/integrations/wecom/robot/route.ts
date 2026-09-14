import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { wecomIdentity, wecomMentionState, wecomWebhookFingerprint, WECOM_MENTION_STATE_LABELS } from '@/lib/wecom-identity';
import { UnauthorizedError, ForbiddenError, requireAdmin, requireUser, unauthorized } from '@/lib/auth';
import { qualityNotificationOrigin } from '@/lib/quality-risk-notifications';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { maskEmployeeMobile } from '@/lib/employee-contact';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { WECOM_NOTIFICATION_POLICY } from '@/lib/wecom-notification-policy';
import {
  buildWeComRobotTestMessage,
  inspectWeComRobotConfig,
  sendWeComRobotText,
  toWeComMentionMobile,
  toWeComMentionUserId,
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
  wecomUserId: string | null;
  wecomUserIdVerifiedAt: Date | null;
  wecomMentionCheck: unknown;
  updatedAt: Date;
  user: { id: string; displayName: string; username: string } | null;
}) {
  const identity = wecomIdentity(employee);
  const check = employee.wecomMentionCheck as Record<string, unknown> | null;
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    team: employee.team,
    maskedMobile: maskEmployeeMobile(employee.mobile),
    wecomUserId: employee.wecomUserId || '',
    identityMethod: identity.method, maskedTarget: identity.maskedTarget,
    mentionState: wecomMentionState(employee), mentionLabel: WECOM_MENTION_STATE_LABELS[wecomMentionState(employee)],
    accountId: employee.user?.id || null, accountName: employee.user ? `${employee.user.displayName}（${employee.user.username}）` : '尚未绑定登录账号',
    updatedAt: employee.updatedAt.toISOString(),
    testId: typeof check?.testId === 'string' ? check.testId : null,
    testedAt: typeof check?.testedAt === 'string' ? check.testedAt : null,
  };
}

export async function GET() {
  try {
    await requireUser();
    const [employees, lastSuccess] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true },
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          team: true,
          mobile: true,
          notificationEnabled: true,
          wecomUserId: true, wecomUserIdVerifiedAt: true, wecomMentionCheck: true, updatedAt: true,
          user: { select: { id: true, displayName: true, username: true } },
        },
        orderBy: [{ employeeNo: 'asc' }],
      }),
      prisma.operationLog.findFirst({
        where: { action: 'send_wecom_robot_test_succeeded' },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const supported = employees.filter(item => wecomIdentity(item).method !== 'MISSING');
    const recipients = employees.filter(item => item.notificationEnabled).map(serializeRecipient);
    const pausedCount = supported.filter(item => !item.notificationEnabled).length;
    const unsupportedCount = employees.length - supported.length;
    return NextResponse.json({
      ok: true,
      config: inspectWeComRobotConfig(),
      policy: WECOM_NOTIFICATION_POLICY,
      quality: { originReady: Boolean(qualityNotificationOrigin()), workerConfigured: Boolean(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN) },
      recipients,
      counts: {
        activeWithMobile: employees.filter(item => Boolean(toWeComMentionMobile(item.mobile))).length,
        eligible: supported.filter(item => item.notificationEnabled).length,
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
    assertSameOriginMutationRequest(req);
    const user = await requireAdmin();
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
        wecomUserId: true, wecomUserIdVerifiedAt: true, wecomMentionCheck: true,
      },
      orderBy: [{ employeeNo: 'asc' }],
    });
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '部分员工档案不存在，请刷新后重试' }, { status: 409 });
    }
    const invalid = employees.filter(item => !item.isActive || !item.notificationEnabled || wecomIdentity(item).method === 'MISSING');
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
    const identities = employees.map(wecomIdentity);
    await sendWeComRobotText({
      source: { sourceType: 'connection_test', eventType: 'ADMIN_CONFIRMED_TEST' },
      content,
      mentionedMobiles: identities.flatMap(item => item.mentionedMobiles),
      mentionedUserIds: identities.flatMap(item => item.mentionedUserIds),
    });
    for (const employee of employees) {
      const identity = wecomIdentity(employee);
      // Changing a contact while the HTTP call is in flight cannot verify the new identity.
      await prisma.employee.updateMany({ where: { id: employee.id, mobile: employee.mobile,
        wecomUserId: employee.wecomUserId, wecomUserIdVerifiedAt: employee.wecomUserIdVerifiedAt },
        data: { wecomMentionCheck: { state: 'TEST_ACCEPTED', testId: randomUUID(),
          fingerprint: identity.fingerprint, webhookFingerprint: wecomWebhookFingerprint(), testedAt: new Date().toISOString(),
          method: identity.method, maskedTarget: identity.maskedTarget } } });
    }
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
    if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '只有管理员可以发送真实测试消息' }, { status: 403 });
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

export async function PATCH(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireAdmin();
    const body = await req.json() as Record<string, unknown>;
    const employee = await prisma.employee.findUnique({ where: { id: String(body.employeeId || '') } });
    if (!employee || !employee.isActive) return NextResponse.json({ error: '员工不存在或已停用' }, { status: 404 });
    if (employee.updatedAt.toISOString() !== body.expectedUpdatedAt) return NextResponse.json({ error: '员工资料已更新，请刷新后重新核对' }, { status: 409 });
    let data: Prisma.EmployeeUpdateManyMutationInput;
    if (body.action === 'SAVE_IDENTITY') {
      const raw = String(body.wecomUserId || '').trim();
      const id = toWeComMentionUserId(raw);
      if (raw && (!id || body.identityConfirmed !== true)) return NextResponse.json({ error: '请填写有效的企业微信成员 UserID，并确认已与通讯录核对' }, { status: 400 });
      data = { wecomUserId: id, wecomUserIdVerifiedAt: id ? new Date() : null, wecomMentionCheck: Prisma.DbNull };
    } else if (body.action === 'CONFIRM_MENTION') {
      const check = employee.wecomMentionCheck as Record<string, unknown> | null;
      const state = String(body.result);
      if (!['CONFIRMED', 'NEEDS_CHECK'].includes(state) || !check?.testId || check.testId !== body.testId
        || check.fingerprint !== wecomIdentity(employee).fingerprint || check.webhookFingerprint !== wecomWebhookFingerprint()) {
        return NextResponse.json({ error: '提醒身份已变化或尚未试发，请先重新试发并核对群内效果' }, { status: 409 });
      }
      data = { wecomMentionCheck: { ...check, state, confirmedAt: new Date().toISOString(), confirmedById: user.id } as Prisma.InputJsonObject };
    } else return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
    await prisma.$transaction(async tx => {
      const changed = await tx.employee.updateMany({ where: { id: employee.id, updatedAt: employee.updatedAt }, data });
      if (!changed.count) throw new Error('IDENTITY_CHANGED');
      await tx.operationLog.create({ data: { userId: user.id, action: body.action === 'SAVE_IDENTITY' ? 'configure_wecom_identity' : 'confirm_wecom_mention',
        targetType: 'employee', targetId: employee.id, detail: { employeeNo: employee.employeeNo,
          result: body.action === 'SAVE_IDENTITY' ? '身份已核对，群内提醒待验证' : String(body.result) } } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return NextResponse.json({ error: '只有管理员可以配置提醒身份' }, { status: 403 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: '该企业微信成员已绑定其他员工，请先核对' }, { status: 409 });
    return NextResponse.json({ error: '提醒设置保存失败，请刷新后重试' }, { status: 409 });
  }
}
