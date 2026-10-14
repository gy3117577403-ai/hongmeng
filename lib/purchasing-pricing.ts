import { PurchasingError, pcInt, type PcInput } from './purchasing-domain';

// Unit prices retain six decimal places; money is rounded only once, to cents.
export function pcUnitPrice(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,6})?$/.test(text)) throw new PurchasingError('成交单价须为正数，最多六位小数');
  const [whole, fraction = ''] = text.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (micros <= 0n || micros > 10000000000000n) throw new PurchasingError('成交单价须大于零且不超过 10000000 元');
  return `${BigInt(whole)}.${fraction.padEnd(6, '0')}`;
}

export function pcGoodsCents(unitPrice: unknown, quantity: number): number {
  pcInt(quantity, '采购数量');
  const normalized = pcUnitPrice(unitPrice);
  const micros = BigInt(normalized.replace('.', ''));
  return pcInt(Number((micros * BigInt(quantity) + 5000n) / 10000n), '商品金额（分）');
}

export function pcPurchasePricing(input: PcInput, quantity: number) {
  if (input.unitPrice == null || input.unitPrice === '') {
    if (Number(input.freightCents || 0) || Number(input.discountCents || 0)) throw new PurchasingError('按总额登记时请勿另填运费或优惠，请改用单价登记');
    return { unitPrice: null, goodsCents: null, freightCents: 0, discountCents: 0, actualCents: pcInt(input.actualCents, '实际采购总额（分）') };
  }
  const unitPrice = pcUnitPrice(input.unitPrice);
  const goodsCents = pcGoodsCents(unitPrice, quantity);
  const freightCents = pcInt(input.freightCents ?? 0, '运费（分）', 0);
  const discountCents = pcInt(input.discountCents ?? 0, '优惠（分）', 0);
  const actualCents = pcInt(goodsCents + freightCents - discountCents, '实际采购总额（分）');
  if (input.actualCents != null && pcInt(input.actualCents, '实际采购总额（分）') !== actualCents) throw new PurchasingError('采购总额须等于数量乘单价，加运费、减优惠，请重新核对');
  return { unitPrice, goodsCents, freightCents, discountCents, actualCents };
}

export function pcPricingSnapshot(p: {
  spec: string; quantity: number; unit: string; unitPrice: { toString(): string } | string | null;
  goodsCents: number | null; freightCents: number; discountCents: number; actualCents: number;
}) {
  return { snapshotVersion: 2, spec: p.spec, quantity: p.quantity, unit: p.unit,
    unitPrice: p.unitPrice?.toString() ?? null, goodsCents: p.goodsCents,
    freightCents: p.freightCents, discountCents: p.discountCents, actualCents: p.actualCents };
}
