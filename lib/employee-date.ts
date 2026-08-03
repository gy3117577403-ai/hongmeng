export class EmployeeHireDateError extends Error {
  constructor(message = '入职日期格式无效，请使用 YYYY-MM-DD') {
    super(message);
    this.name = 'EmployeeHireDateError';
  }
}

function dateParts(value: string): [number, number, number] | null {
  const normalized = value
    .trim()
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+.*$/, '');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function normalizeEmployeeHireDateInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new EmployeeHireDateError();
    return value.toISOString().slice(0, 10);
  }

  const parts = dateParts(String(value));
  if (!parts) throw new EmployeeHireDateError();
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new EmployeeHireDateError();
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function employeeHireDateToDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatEmployeeHireDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
