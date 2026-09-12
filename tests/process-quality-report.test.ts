import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQualityResponsibility, emptyProcessQualityReport, parseProcessQualityReport, processQualityType, qualityReportForQuantity } from '../lib/process-quality-report';
import { emptyQualityForm, qualityResult } from '../lib/quality-data';

test('only inspection processes expose reporting quality; occurrence labels keep the same type', () => {
  for (const name of ['压检', '端子压检', '压检（A端）']) assert.equal(processQualityType(name), 'CRIMP');
  for (const name of ['导通', '导通测试', '导通 · B端']) assert.equal(processQualityType(name), 'CONTINUITY');
  for (const name of ['检验', '成品检验', '检验（复测工位）']) assert.equal(processQualityType(name), 'FINAL');
  for (const name of ['压接', '裁线', '包装', '检验设备准备', '导通治具制作', null]) assert.equal(processQualityType(name), null);
});
test('responsibility preserves exact defective units and strips spoofed names', () => {
  const parsed = parseProcessQualityReport({ ...emptyProcessQualityReport(), responsibility: { status: 'ASSIGNED', allocations: [{ employeeId: 'b', quantity: 2, name: 'spoofed' }, { employeeId: 'a', quantity: 1 }] } })!;
  assert.deepEqual(parsed.responsibility.allocations, [{ employeeId: 'a', quantity: 1 }, { employeeId: 'b', quantity: 2 }]);
  assert.doesNotThrow(() => assertQualityResponsibility(parsed, 3));
  assert.throws(() => assertQualityResponsibility(parsed, 2), /合计/);
  assert.throws(() => parseProcessQualityReport({ ...parsed, responsibility: { status: 'ASSIGNED', allocations: [{ employeeId: 'a', quantity: 1 }, { employeeId: 'a', quantity: 2 }] } }), /重复/);
  assert.equal(qualityReportForQuantity(parsed, 0).responsibility.status, 'PENDING');
  assert.doesNotThrow(() => assertQualityResponsibility(emptyProcessQualityReport(), 2));
});
test('manual templates cover requested fields without inventing measurements or standards', () => {
  assert.deepEqual(emptyQualityForm('CRIMP').rows.map(r => r.item), ['压接外观']);
  assert.deepEqual(emptyQualityForm('FINAL').rows.map(r => r.item), ['外观', '尺寸']);
  assert.deepEqual(emptyQualityForm('PULL').rows.map(r => r.item), ['端子拉力', '端子型号核对']);
  assert.equal(qualityResult(emptyQualityForm('CONTINUITY')), 'PENDING');
});
