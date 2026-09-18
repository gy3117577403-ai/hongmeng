import assert from "node:assert/strict";
import test from "node:test";
import {
  pcCents,
  pcSplit,
  pcDate,
  pcComplete,
  pcFundingKey,
} from "../lib/purchasing-domain";
test("purchasing money accepts exact cents and rejects ambiguous rounding", () => {
  assert.equal(pcCents("19.90"), 1990);
  assert.equal(pcCents("0.01"), 1);
  for (const s of ["1.001", "-1", "1e2", "NaN", ""])
    assert.throws(() => pcCents(s));
  assert.throws(() => pcDate("2026-02-30"));
});
test("partial payments allocate only the remaining amount without reducing an earlier payment", () => {
  const totals = [1500, 1500, 900, 500, 500, 200],
    paid = totals.map(() => 0);
  for (
    let payment = 0;
    payment < totals.reduce((s, n) => s + n, 0);
    payment++
  ) {
    const delta = pcSplit(
      1,
      totals.map((n, i) => n - paid[i]),
    );
    assert.equal(
      delta.reduce((s, n) => s + n, 0),
      1,
    );
    delta.forEach((n, i) => {
      assert.ok(n >= 0);
      paid[i] += n;
      assert.ok(paid[i] <= totals[i]);
    });
  }
  assert.deepEqual(paid, totals);
  assert.deepEqual(pcSplit(100, [1, 1, 1]), [34, 33, 33]);
});
test("advance reimbursement merges across vendors but monthly and corporate settlement do not", () => {
  const p = {
    settlement: "ADVANCE",
    supplierId: "a",
    payee: "员工",
    payeeUserId: "u",
    bank: "bank",
    account: "1",
    currency: "CNY",
    cycle: "2026-09",
  };
  assert.equal(pcFundingKey(p), pcFundingKey({ ...p, supplierId: "b" }));
  assert.notEqual(
    pcFundingKey({ ...p, settlement: "MONTHLY" }),
    pcFundingKey({ ...p, settlement: "MONTHLY", cycle: "2026-10" }),
  );
  assert.notEqual(
    pcFundingKey({ ...p, settlement: "CORPORATE" }),
    pcFundingKey({ ...p, settlement: "CORPORATE", supplierId: "b" }),
  );
});
test("completion needs the physical, cash, refund and invoice facts together", () => {
  const p = {
    status: "ORDERED",
    quantity: 5,
    receivedQty: 3,
    cancelledQty: 2,
    payableCents: 300,
    reservedCents: 500,
    paidCents: 500,
    refundedCents: 200,
    invoiceCents: 300,
    refundOpen: 0,
  };
  assert.equal(pcComplete(p), true);
  for (const q of [
    { receivedQty: 2 },
    { refundedCents: 0 },
    { invoiceCents: 500 },
    { refundOpen: 1 },
  ])
    assert.equal(pcComplete({ ...p, ...q }), false);
});
