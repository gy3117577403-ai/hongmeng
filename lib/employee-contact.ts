export class EmployeeContactError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'EmployeeContactError';
  }
}

/**
 * Stores mobile numbers in a stable E.164-like form so formatting differences
 * such as spaces, dashes and a leading 86 do not create duplicate employees.
 */
export function normalizeEmployeeMobile(value: unknown): string | null {
  const source = String(value ?? '').normalize('NFKC').trim();
  if (!source) return null;

  let compact = source.replace(/[\s()-]/g, '');
  if (compact.startsWith('0086')) compact = `+86${compact.slice(4)}`;
  if (/^86\d{11}$/.test(compact)) compact = `+${compact}`;
  if (/^1[3-9]\d{9}$/.test(compact)) compact = `+86${compact}`;

  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new EmployeeContactError('手机号格式不正确，请填写 11 位手机号或带国家区号的号码');
  }
  return compact;
}

export function maskEmployeeMobile(value: string | null | undefined): string {
  if (!value) return '未填写';
  const suffix = value.slice(-4);
  const prefix = value.startsWith('+86') ? '+86 ' : value.slice(0, Math.max(1, value.length - 8));
  return `${prefix}****${suffix}`;
}
