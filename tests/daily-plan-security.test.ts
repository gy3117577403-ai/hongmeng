import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyPlanError } from '../lib/daily-plan-api';
import { renderDailyPlanPrintHtml } from '../lib/daily-plan-print';

test('daily plan API reflects expected 4xx errors but sanitizes 5xx details', async () => {
  const clientError = Object.assign(new Error('版本已经变化'), {
    status: 409,
    code: 'DAILY_PLAN_VERSION_CONFLICT',
  });
  const clientResponse = dailyPlanError(clientError, 'test client error');
  assert.equal(clientResponse.status, 409);
  assert.deepEqual(await clientResponse.json(), {
    ok: false,
    error: '版本已经变化',
    code: 'DAILY_PLAN_VERSION_CONFLICT',
  });

  const serverError = Object.assign(new Error('postgres://private-host/internal-table'), {
    status: 503,
    code: 'DATABASE_UNAVAILABLE',
  });
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const serverResponse = dailyPlanError(serverError, 'test server error');
    assert.equal(serverResponse.status, 500);
    assert.deepEqual(await serverResponse.json(), {
      ok: false,
      error: '日计划操作失败',
      code: 'DAILY_PLAN_OPERATION_FAILED',
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test('daily plan print HTML escapes every user-controlled label and warning', () => {
  const html = renderDailyPlanPrintHtml({
    generatedAt: '2026-08-02T08:00:00.000Z',
    plan: {
      workDate: '2026-08-02T00:00:00.000Z',
      shiftCode: '<img src=x onerror=alert(1)>',
      team: { name: '<script>alert("team")</script>' },
      tasks: [{
        processName: '<svg onload=alert(1)>',
        plannedQty: 1,
        riskWarnings: [{ message: '<img src=x onerror=alert(2)>' }],
        workOrder: {
          code: '<b>WO-1</b>',
          productName: 'A&B',
        },
        assignments: [{
          quantity: 1,
          employee: {
            name: '<script>alert("employee")</script>',
            employeeNo: '0001" autofocus',
          },
        }],
      }],
    },
  }, 'team');

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.match(html, /&lt;script&gt;alert\(&quot;team&quot;\)&lt;\/script&gt;/);
  assert.match(html, /A&amp;B/);
  assert.match(html, /0001&quot; autofocus/);
});
