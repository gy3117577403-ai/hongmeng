export type SampleCustomerLevelCode = 'A' | 'B' | 'C' | 'D';

export type SampleCustomerLevel = {
  code: SampleCustomerLevelCode;
  label: string;
  color: string;
  background: string;
  border: string;
  priority: number;
};

export const SAMPLE_CUSTOMER_LEVELS: readonly SampleCustomerLevel[] = [
  { code: 'A', label: 'A级', color: '#B91C1C', background: '#FEE2E2', border: '#FCA5A5', priority: 4 },
  { code: 'B', label: 'B级', color: '#92400E', background: '#FEF3C7', border: '#FCD34D', priority: 3 },
  { code: 'C', label: 'C级', color: '#1D4ED8', background: '#DBEAFE', border: '#93C5FD', priority: 2 },
  { code: 'D', label: 'D级', color: '#166534', background: '#DCFCE7', border: '#86EFAC', priority: 1 },
] as const;

export function sampleCustomerLevel(value: unknown): SampleCustomerLevel | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return SAMPLE_CUSTOMER_LEVELS.find(item => item.code === code) || null;
}

export function sampleCustomerLevelOrDefault(value: unknown): SampleCustomerLevel {
  return sampleCustomerLevel(value) || SAMPLE_CUSTOMER_LEVELS[0];
}

export function sampleCustomerLevelStyle(value: unknown) {
  const level = sampleCustomerLevelOrDefault(value);
  return {
    color: level.color,
    backgroundColor: level.background,
    borderColor: level.border,
  };
}
