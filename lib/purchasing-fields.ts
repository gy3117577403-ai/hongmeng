import { PurchasingError, pcText } from './purchasing-domain';

export const PC_UNITS = ['件', '个', '套', '把', '台', '根', '米', '卷', '盒', '包', '袋', '公斤', '瓶', '桶'];

export function pcLegacyUnit(unit: string) {
  const match = /^(\d+)\s*(件|个|套|把|台|根|米|卷|盒|包|袋|公斤|瓶|桶)$/.exec(unit.trim());
  return match && Number(match[1]) > 0 ? { factor: Number(match[1]), unit: match[2] } : null;
}

export function pcUnit(value: unknown) {
  const unit = pcText(value, '单位', 30);
  if (/^\d/.test(unit)) throw new PurchasingError('请把数字填入采购数量，单位只填写“件、个、包”等；每包数量写在规格中');
  return unit;
}

export function pcPaymentValue(value: unknown) {
  const text = String(value ?? '').trim();
  return !text || /^(0+|待补充|待确认|未填写|未填)$/.test(text) ? '' : text;
}

export function pcPaymentField(value: unknown, label: string, max: number, required = false) {
  return pcText(pcPaymentValue(value), label, max, required);
}

export function pcHasPaymentAccount(p: { payee: string; bank: string; account: string }) {
  return Boolean(pcPaymentValue(p.payee) && pcPaymentValue(p.bank) && pcPaymentValue(p.account));
}

export function pcCycle(value: unknown) {
  const cycle = pcText(value, '月结账期', 7, false);
  if (cycle && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle)) throw new PurchasingError('月结账期格式应为年-月');
  return cycle;
}

export function pcQuantityText(quantity: number, unit: string) {
  return pcLegacyUnit(unit) ? `${quantity} × ${unit}` : `${quantity} ${unit}`;
}
