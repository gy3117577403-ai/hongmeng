import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaDateKey } from '../lib/china-date';
import {
  EmployeeOffboardingError,
  parseEmployeeEffectiveDate,
  parseOffboardingInput,
} from '../lib/employee-offboarding';

test('offboarding input accepts a known reason and keeps an auditable note', () => {
  const today = chinaDateKey(new Date());
  const parsed = parseOffboardingInput({
    effectiveDate: today,
    reason: '主动离职',
    note: ' 已完成工具交接 ',
  });
  assert.equal(parsed.effectiveDateKey, today);
  assert.equal(parsed.reason, '主动离职');
  assert.equal(parsed.note, '已完成工具交接');
});

test('future-dated offboarding is rejected until an automatic scheduler exists', () => {
  assert.throws(
    () => parseEmployeeEffectiveDate('2999-01-01'),
    (error: unknown) => error instanceof EmployeeOffboardingError && /未来日期/.test(error.message),
  );
});

test('offboarding reason must come from the controlled reason list', () => {
  assert.throws(
    () => parseOffboardingInput({
      effectiveDate: chinaDateKey(new Date()),
      reason: '随便填写',
    }),
    (error: unknown) => error instanceof EmployeeOffboardingError && /有效的离职原因/.test(error.message),
  );
});
