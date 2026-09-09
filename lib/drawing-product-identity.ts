/** Customer suffixes are codes only when the final parentheses contain digits.
 * Meaningful text such as 伽利略（天津） and model revisions are preserved. */
export function normalizeProductText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function drawingCustomerIdentity(value: string) {
  const normalized = normalizeProductText(value);
  const match = normalized.match(/\s*\((\d+)\)$/);
  return { name: match ? normalized.slice(0, match.index).trim() : normalized, code: match?.[1] || null };
}

export function drawingProductIdentity(customerName: string, specification: string): string {
  return `${drawingCustomerIdentity(customerName).name}::${normalizeProductText(specification)}`;
}

export function sameDrawingProduct(
  a: { customerName: string; specification: string; customerCode?: string | null },
  b: { customerName: string; specification: string; customerCode?: string | null },
): boolean {
  const left = drawingCustomerIdentity(a.customerName);
  const right = drawingCustomerIdentity(b.customerName);
  left.code ||= a.customerCode && /^\d+$/.test(normalizeProductText(a.customerCode)) ? normalizeProductText(a.customerCode) : null;
  right.code ||= b.customerCode && /^\d+$/.test(normalizeProductText(b.customerCode)) ? normalizeProductText(b.customerCode) : null;
  return Boolean(left.name && right.name)
    && left.name === right.name
    && (!left.code || !right.code || left.code === right.code)
    && normalizeProductText(a.specification) === normalizeProductText(b.specification);
}
