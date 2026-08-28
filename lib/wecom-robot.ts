import { isWeComNotificationAllowed, WECOM_POLICY_BLOCK_REASON, type WeComNotificationSource } from '@/lib/wecom-notification-policy';

const WECOM_ROBOT_HOST = 'qyapi.weixin.qq.com';
const WECOM_ROBOT_PATH = '/cgi-bin/webhook/send';

export const WECOM_ROBOT_TEXT_MAX_BYTES = 2048;
export const WECOM_ROBOT_TEST_MAX_RECIPIENTS = 20;

export type WeComRobotConfigState = 'ready' | 'missing' | 'invalid';

export type WeComRobotConfigStatus = {
  configured: boolean;
  state: WeComRobotConfigState;
  endpointHost: string | null;
};

export type WeComRobotTestRecipient = {
  employeeNo: string;
  name: string;
  mobile: string;
};

type WeComRobotApiResponse = {
  errcode?: unknown;
  errmsg?: unknown;
};

export class WeComRobotError extends Error {
  readonly status: number;
  readonly code: string;
  readonly externalCode?: number;

  constructor(message: string, options: { status?: number; code: string; externalCode?: number }) {
    super(message);
    this.name = 'WeComRobotError';
    this.status = options.status ?? 500;
    this.code = options.code;
    this.externalCode = options.externalCode;
  }
}

function parseWebhookUrl(value: string | null | undefined): URL {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new WeComRobotError('尚未配置企业微信消息推送 Webhook', {
      status: 503,
      code: 'WECOM_WEBHOOK_MISSING',
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WeComRobotError('企业微信消息推送 Webhook 格式无效', {
      status: 503,
      code: 'WECOM_WEBHOOK_INVALID',
    });
  }

  const key = url.searchParams.get('key') || '';
  const extraParameters = [...url.searchParams.keys()].filter(item => item !== 'key');
  if (
    url.protocol !== 'https:'
    || url.hostname !== WECOM_ROBOT_HOST
    || url.port
    || url.username
    || url.password
    || url.pathname !== WECOM_ROBOT_PATH
    || url.hash
    || extraParameters.length > 0
    || key.length < 20
    || key.length > 128
    || !/^[A-Za-z0-9_-]+$/.test(key)
  ) {
    throw new WeComRobotError('企业微信消息推送 Webhook 格式无效', {
      status: 503,
      code: 'WECOM_WEBHOOK_INVALID',
    });
  }

  return url;
}

export function inspectWeComRobotConfig(
  value: string | null | undefined = process.env.WECOM_ROBOT_WEBHOOK_URL,
): WeComRobotConfigStatus {
  if (!String(value || '').trim()) {
    return { configured: false, state: 'missing', endpointHost: null };
  }
  try {
    const url = parseWebhookUrl(value);
    return { configured: true, state: 'ready', endpointHost: url.hostname };
  } catch {
    return { configured: false, state: 'invalid', endpointHost: null };
  }
}

export function toWeComMentionMobile(value: string | null | undefined): string | null {
  const compact = String(value || '').trim().replace(/[\s()-]/g, '');
  const match = compact.match(/^(?:\+?86)?(1[3-9]\d{9})$/);
  return match?.[1] || null;
}

function assertTextSize(content: string) {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > WECOM_ROBOT_TEXT_MAX_BYTES) {
    throw new WeComRobotError('企业微信测试消息内容过长', {
      status: 400,
      code: 'WECOM_TEXT_TOO_LONG',
    });
  }
}

export function buildWeComRobotTestMessage(
  recipients: Array<Pick<WeComRobotTestRecipient, 'employeeNo' | 'name'>>,
  sentAt: Date = new Date(),
): string {
  const people = recipients.map(item => `${item.employeeNo} ${item.name}`).join('、');
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(sentAt);
  const content = [
    '【杭连电子协同平台｜连接测试】',
    '企业微信消息推送已成功接入测试链路。',
    `试发人员：${people}`,
    `发送时间：${time}`,
    '说明：这是一条联调消息，无需回复。',
  ].join('\n');
  assertTextSize(content);
  return content;
}

export async function sendWeComRobotText(options: {
  source: WeComNotificationSource;
  content: string;
  mentionedMobiles: string[];
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ errcode: 0 }> {
  if (!isWeComNotificationAllowed(options.source)) {
    throw new WeComRobotError(WECOM_POLICY_BLOCK_REASON, { status: 403, code: 'WECOM_SOURCE_BLOCKED' });
  }
  assertTextSize(options.content);
  const webhook = parseWebhookUrl(options.webhookUrl ?? process.env.WECOM_ROBOT_WEBHOOK_URL);
  const mentionedMobiles = [...new Set(options.mentionedMobiles.map(toWeComMentionMobile).filter((item): item is string => Boolean(item)))];
  if (!mentionedMobiles.length) {
    throw new WeComRobotError('没有可用于企业微信提醒的手机号', {
      status: 400,
      code: 'WECOM_MENTION_MOBILE_MISSING',
    });
  }
  if (mentionedMobiles.length > WECOM_ROBOT_TEST_MAX_RECIPIENTS) {
    throw new WeComRobotError(`一次最多选择 ${WECOM_ROBOT_TEST_MAX_RECIPIENTS} 人进行联调`, {
      status: 400,
      code: 'WECOM_RECIPIENT_LIMIT',
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: options.content,
          mentioned_mobile_list: mentionedMobiles,
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as WeComRobotApiResponse | null;
    if (!response.ok || !payload || typeof payload.errcode !== 'number') {
      throw new WeComRobotError('企业微信消息推送返回了无效结果', {
        status: 502,
        code: 'WECOM_BAD_RESPONSE',
      });
    }
    if (payload.errcode !== 0) {
      throw new WeComRobotError('企业微信拒绝了本次消息，请检查机器人是否停用或 Webhook 是否失效', {
        status: 502,
        code: 'WECOM_REJECTED',
        externalCode: payload.errcode,
      });
    }
    return { errcode: 0 };
  } catch (error) {
    if (error instanceof WeComRobotError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new WeComRobotError('连接企业微信超时，请稍后重试', {
        status: 504,
        code: 'WECOM_TIMEOUT',
      });
    }
    throw new WeComRobotError('暂时无法连接企业微信，请检查网络后重试', {
      status: 502,
      code: 'WECOM_UNAVAILABLE',
    });
  }
}
