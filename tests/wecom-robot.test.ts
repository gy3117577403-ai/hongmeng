import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWeComRobotTestMessage,
  inspectWeComRobotConfig,
  sendWeComRobotText,
  toWeComMentionMobile,
  WECOM_ROBOT_TEXT_MAX_BYTES,
  WeComRobotError,
} from '@/lib/wecom-robot';
import { QUALITY_WECOM_EVENTS, isWeComNotificationAllowed } from '@/lib/wecom-notification-policy';

const testSource = { sourceType: 'connection_test', eventType: 'ADMIN_CONFIRMED_TEST' };

const validWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=0123456789abcdef0123456789abcdef';

test('Webhook 状态只暴露连接状态，不暴露密钥', () => {
  const status = inspectWeComRobotConfig(validWebhook);
  assert.deepEqual(status, {
    configured: true,
    state: 'ready',
    endpointHost: 'qyapi.weixin.qq.com',
  });
  assert.equal(JSON.stringify(status).includes('0123456789abcdef'), false);
});

test('Webhook 只接受企业微信官方 HTTPS 地址和唯一 key 参数', () => {
  assert.equal(inspectWeComRobotConfig('').state, 'missing');
  assert.equal(inspectWeComRobotConfig('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=0123456789abcdef0123456789abcdef').state, 'invalid');
  assert.equal(inspectWeComRobotConfig('https://example.com/cgi-bin/webhook/send?key=0123456789abcdef0123456789abcdef').state, 'invalid');
  assert.equal(inspectWeComRobotConfig(`${validWebhook}&redirect=https://example.com`).state, 'invalid');
});

test('企业微信提醒手机号统一成中国大陆 11 位格式', () => {
  assert.equal(toWeComMentionMobile('138 0013 8000'), '13800138000');
  assert.equal(toWeComMentionMobile('+86-138-0013-8000'), '13800138000');
  assert.equal(toWeComMentionMobile('8613800138000'), '13800138000');
  assert.equal(toWeComMentionMobile('+852 6123 4567'), null);
  assert.equal(toWeComMentionMobile('123'), null);
});

test('试发消息包含员工身份和上海时间且不超过接口限制', () => {
  const content = buildWeComRobotTestMessage([
    { employeeNo: '0008', name: '测试员工甲' },
    { employeeNo: '0012', name: '测试员工乙' },
  ], new Date('2026-08-06T02:03:04.000Z'));
  assert.match(content, /0008 测试员工甲/);
  assert.match(content, /0012 测试员工乙/);
  assert.match(content, /2026\/08\/06 10:03:04/);
  assert.ok(Buffer.byteLength(content, 'utf8') <= WECOM_ROBOT_TEXT_MAX_BYTES);
});

test('发送器去重手机号并生成企业微信文本消息结构', async () => {
  let capturedUrl = '';
  let capturedBody: unknown = null;
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body || '{}')) as unknown;
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await sendWeComRobotText({
    source: testSource,
    content: '连接测试',
    mentionedMobiles: ['+86 13800138000', '13800138000', '13900139000'],
    webhookUrl: validWebhook,
    fetchImpl,
  });

  assert.deepEqual(result, { errcode: 0 });
  assert.equal(capturedUrl, validWebhook);
  assert.deepEqual(capturedBody, {
    msgtype: 'text',
    text: {
      content: '连接测试',
      mentioned_mobile_list: ['13800138000', '13900139000'],
    },
  });
});

test('发送边界拒绝非质量、未知来源和伪装成质量标题的消息，绝不发起网络请求', async () => {
  let calls = 0;
  for (const source of [
    { sourceType: 'process_route_change', eventType: 'PROCESS_ROUTE_CHANGE_APPROVED' },
    { sourceType: 'process_route_change', eventType: 'ASSIGNED' },
    { sourceType: 'internal_quality_risk', eventType: 'NEW_UNKNOWN_EVENT' },
    { sourceType: 'connection_test', eventType: 'ASSIGNED' },
    undefined,
  ]) {
    await assert.rejects(sendWeComRobotText({
      source: source as typeof testSource, content: '质量管理：检验工序已报工',
      mentionedMobiles: ['13800138000'], webhookUrl: validWebhook,
      fetchImpl: (async () => { calls++; return new Response('{}'); }) as typeof fetch,
    }), (error: unknown) => error instanceof WeComRobotError && error.code === 'WECOM_SOURCE_BLOCKED');
  }
  assert.equal(calls, 0);
});

test('所有现有质量事件允许外发，但无责任人手机号不能退化为群广播', async () => {
  for (const eventType of QUALITY_WECOM_EVENTS) {
    const source = { sourceType: 'internal_quality_risk', eventType };
    assert.equal(isWeComNotificationAllowed(source), true);
    await sendWeComRobotText({ source, content: '质量任务', mentionedMobiles: ['13800138000'], webhookUrl: validWebhook,
      fetchImpl: (async () => new Response(JSON.stringify({ errcode: 0 }))) as typeof fetch });
    await assert.rejects(sendWeComRobotText({ source, content: '质量任务', mentionedMobiles: [], webhookUrl: validWebhook,
      fetchImpl: (async () => { throw new Error('不应请求'); }) as typeof fetch,
    }), (error: unknown) => error instanceof WeComRobotError && error.code === 'WECOM_MENTION_MOBILE_MISSING');
  }
});

test('企业微信业务拒绝时返回可审计的安全错误', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

  await assert.rejects(
    () => sendWeComRobotText({
      source: testSource,
      content: '连接测试',
      mentionedMobiles: ['13800138000'],
      webhookUrl: validWebhook,
      fetchImpl,
    }),
    (error: unknown) => {
      assert.ok(error instanceof WeComRobotError);
      assert.equal(error.code, 'WECOM_REJECTED');
      assert.equal(error.externalCode, 93000);
      assert.equal(error.message.includes('0123456789abcdef'), false);
      return true;
    },
  );
});

test('超出企业微信文本字节限制时在请求前拒绝', async () => {
  await assert.rejects(
    () => sendWeComRobotText({
      source: testSource,
      content: '测'.repeat(WECOM_ROBOT_TEXT_MAX_BYTES),
      mentionedMobiles: ['13800138000'],
      webhookUrl: validWebhook,
      fetchImpl: (async () => {
        throw new Error('不应发起请求');
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof WeComRobotError && error.code === 'WECOM_TEXT_TOO_LONG',
  );
});
