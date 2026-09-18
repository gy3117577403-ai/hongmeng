import type { Prisma } from "@prisma/client";
import type { PcActor } from "@/lib/purchasing-service";
import { pcChoice, pcInt, pcText, pcVersion, type PcInput } from "@/lib/purchasing-domain";
import { FixtureError, fixtureAvailable } from "@/lib/quality-fixture-domain";

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const fail = (s: string): never => { throw new FixtureError(s, "FIXTURE_STOCK_CONFLICT", 409); };

/** Call inside the shared purchasing/fixture advisory lock. All stock has one physical ledger. */
export async function moveFixtureStock(tx: Tx, input: PcInput, actor: PcActor) {
  const kind = pcChoice(input.kind, ["OPENING", "RESERVE", "RELEASE", "ISSUE", "RETURN", "HOLD", "VERIFY", "REPAIR", "REPAIRED", "SCRAP", "ADJUST"], "库存操作");
  const quantity = pcInt(input.quantity, "数量", 1, 1000000);
  const person = pcText(input.person || actor.displayName || actor.username, "经办人", 100);
  const reason = pcText(input.reason, "操作说明", 1000, !["RESERVE", "RELEASE", "ISSUE", "RETURN"].includes(kind));
  let stock;
  if (kind === "OPENING") {
    const fixture = await tx.qfFixture.findFirst({ where: { id: pcText(input.fixtureId, "对插件", 100), active: true } });
    if (!fixture) throw new FixtureError("对插件不存在或已停用");
    stock = await tx.pcStockBalance.create({ data: { itemId: fixture.itemId,
      warehouse: pcText(input.warehouse, "仓库", 100), location: pcText(input.location, "库位", 100) } });
  } else {
    stock = await tx.pcStockBalance.findUnique({ where: { id: pcText(input.id, "库存记录", 100) } });
    if (!stock || !await tx.qfFixture.findUnique({ where: { itemId: stock.itemId } })) throw new FixtureError("治具库存不存在");
    pcVersion(stock.version, input.version);
  }
  const before = stock;
  let onHand = stock.onHand, held = stock.held, repair = stock.repair, reserved = stock.reserved, issued = stock.issued;
  const available = fixtureAvailable(stock);
  let holding = null;
  if (["RESERVE", "RELEASE", "ISSUE", "RETURN"].includes(kind)) {
    const libraryItemId = pcText(input.libraryItemId, "领用产品", 100), workOrderId = pcText(input.workOrderId, "工单", 100, false);
    if (!await tx.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } })) throw new FixtureError("请选择有效产品");
    if (workOrderId && !await tx.workOrder.findFirst({ where: { id: workOrderId, drawingLibraryItemId: libraryItemId, deletedAt: null } }))
      throw new FixtureError("工单不属于所选产品");
    holding = await tx.qfHolding.upsert({ where: { stockId_libraryItemId_workOrderId_person: { stockId: stock.id, libraryItemId, workOrderId, person } },
      create: { stockId: stock.id, libraryItemId, workOrderId, person }, update: {} });
    if (kind === "RESERVE") {
      if (quantity > available) fail("可用数量不足，其他预留、待验证和维修中的治具不能重复预留");
      reserved += quantity; holding.reserved += quantity;
    } else if (kind === "RELEASE") {
      if (quantity > holding.reserved) fail("释放数量超过该产品和领用人的预留数量");
      reserved -= quantity; holding.reserved -= quantity;
    } else if (kind === "ISSUE") {
      const fromReservation = Math.min(quantity, holding.reserved);
      if (quantity - fromReservation > available) fail("领用数量超过可用及本人的预留数量");
      reserved -= fromReservation; holding.reserved -= fromReservation;
      onHand -= quantity; issued += quantity; holding.issued += quantity;
    } else {
      if (quantity > holding.issued) fail("归还数量超过该产品和领用人的在借数量");
      issued -= quantity; holding.issued -= quantity; onHand += quantity;
      if (input.returnCondition !== "GOOD") held += quantity;
    }
    await tx.qfHolding.update({ where: { id: holding.id }, data: { reserved: holding.reserved, issued: holding.issued, version: { increment: 1 } } });
  } else if (kind === "OPENING") {
    onHand += quantity;
    // Opening stock is never presumed validated.
    held += quantity;
  } else if (kind === "HOLD") {
    if (quantity > available) fail("待验证数量超过当前可用库存");
    held += quantity;
  } else if (kind === "VERIFY") {
    if (quantity > held) fail("验证数量超过待验证库存");
    if (input.fitConfirmed !== true || input.continuityConfirmed !== true) throw new FixtureError("请确认对插适配与导通验证均通过");
    held -= quantity;
  } else if (kind === "REPAIR") {
    const from = pcChoice(input.from || "HELD", ["HELD", "AVAILABLE"], "维修来源");
    if (quantity > (from === "HELD" ? held : available)) fail("送修数量超过所选状态库存");
    if (from === "HELD") held -= quantity;
    repair += quantity;
  } else if (kind === "REPAIRED") {
    if (quantity > repair) fail("维修返回数量超过维修中库存");
    repair -= quantity; held += quantity;
  } else if (kind === "SCRAP") {
    const from = pcChoice(input.from || "HELD", ["HELD", "REPAIR", "AVAILABLE"], "报废来源");
    if (quantity > (from === "HELD" ? held : from === "REPAIR" ? repair : available)) fail("报废数量超过所选状态库存");
    if (from === "HELD") held -= quantity;
    if (from === "REPAIR") repair -= quantity;
    onHand -= quantity;
  } else if (kind === "ADJUST") {
    const direction = pcChoice(input.direction, ["IN", "OUT"], "盘点调整方向");
    if (direction === "IN") { onHand += quantity; held += quantity; }
    else { if (quantity > available) fail("盘亏数量超过未占用可用库存，请先核实预留和借用"); onHand -= quantity; }
  }
  if ([onHand, held, repair, reserved, issued].some(n => !Number.isSafeInteger(n) || n < 0) || held + repair + reserved > onHand)
    fail("库存状态不平衡，请刷新核实");
  const result = await tx.pcStockBalance.update({ where: { id: stock.id }, data: { onHand, held, repair, reserved, issued, version: { increment: 1 } } });
  await tx.pcStockMovement.create({ data: { stockId: stock.id, lineId: stock.lineId, kind: "FIXTURE_" + kind,
    quantity: onHand - before.onHand, balance: onHand, sourceId: holding?.id || stock.id, reason, person,
    actorId: actor.id, actorName: actor.displayName || actor.username } });
  await tx.qfEvent.create({ data: { entityType: "STOCK", entityId: stock.id, action: kind, actorId: actor.id,
    actorName: actor.displayName || actor.username, reason, snapshot: json({ before, after: result, holding, quantity,
      fitConfirmed: input.fitConfirmed === true, continuityConfirmed: input.continuityConfirmed === true }) } });
  return result;
}
