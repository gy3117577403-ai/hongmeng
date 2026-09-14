import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualityNotificationMessage } from '../lib/quality-risk-notifications';
import { wecomIdentity, wecomMentionState, wecomWebhookFingerprint } from '../lib/wecom-identity';
import { sendWeComRobotText, toWeComMentionUserId } from '../lib/wecom-robot';

test('compact quality notice keeps the responsible person, unique products, deadline and login link', () => {
  const content = buildQualityNotificationMessage({ recipientName: '林波', event: 'ASSIGNED', url: 'https://example.com/q/abcdefghijkl', items: [
    { title: '插入误配色', products: ['D014503-8279-V03', 'D014503-8279-V03'], problem: '插入孔位错误', dueAt: new Date('2026-09-14T15:59:59Z') },
  ] });
  assert.match(content, /责任人：林波/); assert.match(content, /插入误配色/); assert.match(content, /插入孔位错误/);
  assert.equal(content.match(/D014503-8279-V03/g)?.length, 1); assert.match(content, /2026-09-14/);
  assert.match(content, /https:\/\/example.com\/q\/abcdefghijkl/);
  assert.doesNotMatch(content, /通知编号|此消息|taskId=|reportId=|@林波/);
  const grouped = buildQualityNotificationMessage({ recipientName: '林波', event: 'RETURNED', url: 'https://example.com/q/abcdefghijkl',
    items: Array.from({ length: 20 }, () => ({ title: '问题😀'.repeat(200), products: ['产品'.repeat(100)], problem: '', reason: '请补充'.repeat(200) })) });
  assert.ok(Buffer.byteLength(grouped) <= 2000); assert.doesNotMatch(grouped, /\ufffd/); assert.match(grouped, /\/q\/abcdefghijkl$/);
});

test('verified WeCom UserID preferred, unverified legacy values use phone and changes invalidate verification', () => {
  const employee = { id: 'employee', mobile: '+86 13800138000', wecomUserId: 'lin.bo', wecomUserIdVerifiedAt: null as Date | null };
  assert.equal(wecomIdentity(employee).method, 'MOBILE');
  employee.wecomUserIdVerifiedAt = new Date();
  const identity = wecomIdentity(employee); assert.equal(identity.method, 'USER_ID'); assert.deepEqual(identity.mentionedUserIds, ['lin.bo']);
  const check = { ...employee, wecomMentionCheck: { state: 'CONFIRMED', fingerprint: identity.fingerprint, webhookFingerprint: wecomWebhookFingerprint('group1') } };
  assert.equal(wecomMentionState(check, 'group1'), 'CONFIRMED');
  assert.equal(wecomMentionState(check, 'group2'), 'UNVERIFIED');
  assert.equal(wecomMentionState({ ...check, wecomUserId: 'someone.else' }, 'group1'), 'UNVERIFIED');
  assert.equal(wecomMentionState({ ...check, wecomMentionCheck: { ...check.wecomMentionCheck, state: 'TEST_ACCEPTED' } }, 'group1'), 'TEST_ACCEPTED');
  assert.equal(toWeComMentionUserId('@all'), null); assert.equal(toWeComMentionUserId('lin.bo\nother'), null);
});

test('UserID produces native mentioned_list without accidental phone or all-member mention', async () => {
  let payload: any;
  await sendWeComRobotText({ source: { sourceType: 'internal_quality_risk', eventType: 'ASSIGNED' }, content: '质量待办', mentionedUserIds: ['lin.bo', 'lin.bo'],
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=isolated-test-20260914-no-real-robot',
    fetchImpl: (async (_url, init) => { payload = JSON.parse(String(init?.body)); return new Response('{"errcode":0}'); }) as typeof fetch });
  assert.deepEqual(payload, { msgtype: 'text', text: { content: '质量待办', mentioned_list: ['lin.bo'] } });
});
