import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';

async function main() {
  assert.equal(process.env.QUALITY_CORRECTION_QA_ALLOW, 'disposable-quality-correction');
  const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:33148';
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  const f = JSON.parse(readFileSync('output/quality-correction/fixture.json', 'utf8'));
  assert.ok(f.username.startsWith('QUALITY-TEST-'));
  const checks: string[] = [];
  const check = (ok: boolean, label: string) => { assert.ok(ok, label); checks.push(label); };
  const path = `/api/process-management/routes/${f.routeId}/completions/${f.completionId}/correct-quality`;
  async function login(username: string) {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password: f.password }) });
    assert.equal(r.status, 200, await r.text());
    return r.headers.get('set-cookie')!.match(/hm_session=[^;]+/)![0];
  }
  check((await fetch(base + path)).status === 401, 'anonymous preview denied');
  const viewer = await login(f.viewer);
  check((await fetch(base + path, { headers: { Cookie: viewer } })).status === 403, 'reader cannot preview production correction');
  check((await fetch(base + path, { method: 'POST', headers: { Cookie: viewer, Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status === 403, 'reader cannot mutate');
  const cookie = await login(f.username);
  const get = async () => { const r = await fetch(base + path, { headers: { Cookie: cookie } }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).data; };
  const p = await get(); check(p.canExecute, 'authorized preview succeeds');
  check(p.before.defectQty === 40 && p.after.goodQty === 40 && p.after.defectQty === 0, 'before and proposed quantities shown');
  const original = await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completionId } });
  check(original.defectQty === 40, 'GET preview did not change data');
  const stable = (x: unknown) => JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  const ledger = () => prisma.processLaborPool.findMany({ where: { workOrderId: f.orderId }, orderBy: { id: 'asc' }, include: { claims: { orderBy: { id: 'asc' } } } });
  const before = stable(await ledger());
  const command = { previewToken: p.previewToken, reason: '隔离测试确认实际劳动仅不良误填', confirmActualWork: true, idempotencyKey: randomUUID() };
  const post = (body: unknown, origin = base) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  check((await post(command, 'https://invalid.example')).status === 403, 'cross-origin mutation denied');
  check((await post({ ...command, confirmActualWork: false })).status === 400, 'actual work confirmation required');
  check((await post({ ...command, previewToken: '0'.repeat(64) })).status === 409, 'stale preview rejected');
  const result = await post(command); check(result.status === 200, 'quality correction commits through API');
  check((await post(command)).status === 200, 'retry returns success without second mutation');
  check(before === stable(await ledger()), 'all employee claims and labor pools unchanged');
  const branch = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.branchId } });
  check(branch.branchStatus === 'CANCELLED' && !branch.deletedAt && !branch.planActive, 'empty branch cancelled with history retained');
  const mainOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.orderId } });
  check(mainOrder.completedQty === '14' && mainOrder.status !== 'done', 'partial downstream remains 14/40 instead of forced completion');
  check(await prisma.operationLog.count({ where: { targetId: f.completionId, action: 'correct_quality_quantity' } }) === 1, 'one audit entry only');
  writeFileSync(process.env.QUALITY_CORRECTION_QA_REPORT || 'output/quality-correction/http-acceptance.json', JSON.stringify({ base, checks, count: checks.length, passed: true }, null, 2));
  console.log(`${checks.length} quality correction HTTP and ledger checks passed`);
}
main().finally(() => prisma.$disconnect());
