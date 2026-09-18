import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { readFixtureBom } from "../lib/quality-fixture-bom";
import { confirmBomRows, fixtureAvailable, fixtureRequirements, inferBomMapping, scanBom } from "../lib/quality-fixture-domain";

for (const bookType of ["xlsx", "xls"] as const) test("Excel " + bookType + " preserves models, excludes non-connectors and uses per-product quantities", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["测试 BOM"], ["物料名称", "连接器型号", "单台用量", "单位", "位号"],
    ["连接器", "00123-AB", 2, "个", "X1 X2"], ["热缩管", "TUBE-1", 4, "米", ""],
    ["插座", "ABC/P", 1, "个", "X3"], ["合计", "", 7],
  ]), "物料清单");
  const sheets = readFixtureBom(XLSX.write(book, { bookType, type: "buffer" }), "test." + bookType);
  const mapping = inferBomMapping(sheets), scanned = scanBom(sheets, mapping), rows = confirmBomRows(scanned, scanned);
  assert.equal(rows[0].model, "00123-AB"); assert.equal(rows[1].include, false); assert.equal(rows.length, 3);
  const needs = fixtureRequirements(rows, 2, 1);
  assert.equal(needs.find(n => n.model === "00123-AB")?.required, 5);
  assert.equal(needs.find(n => n.model === "ABC/P")?.required, 3);
});
test("ambiguous rows, bad quantities, hidden corrections and duplicate positions cannot pass confirmation", () => {
  const sheets = [{ name: "BOM", rows: [["型号","数量","名称","位号"],["A","6","连接器","P1"],["B","","不明确","P2"]].map(r => r.map(text => ({ text }))) }];
  const mapping = inferBomMapping(sheets), rows = scanBom(sheets, mapping);
  assert.throws(() => confirmBomRows(rows, rows), /待确认/);
  assert.throws(() => confirmBomRows(rows, [rows[0], { ...rows[1], include: false }]), /依据/);
  assert.throws(() => confirmBomRows(rows, [{ ...rows[0], quantity: 1 }, { ...rows[1], include: false, reason: "非连接器" }]), /依据/);
  assert.throws(() => confirmBomRows(rows, [rows[0], { ...rows[1], quantity: 1, include: true, position: "P1", reason: "核实实物" }]), /重复/);
  assert.equal(scanBom(sheets, { ...mapping, quantityBasis: "ORDER_TOTAL", productQuantity: 3 })[0].quantity, 2);
  assert.equal(scanBom(sheets, { ...mapping, quantityBasis: "ORDER_TOTAL", productQuantity: 4 })[0].quantity, null);
});
test("stock availability and workbook validation fail closed", () => {
  assert.equal(fixtureAvailable({ onHand: 12, held: 3, reserved: 4, repair: 2 }), 3);
  assert.throws(() => readFixtureBom(Buffer.from("not-an-excel"), "test.xlsx"), /有效的 Excel/);
  assert.throws(() => readFixtureBom(Buffer.from("x"), "test.csv"), /仅支持/);
});
