export type StandardHourlyCapacity =
  | { kind: 'value'; quantityPerHour: number }
  | { kind: 'per_batch' }
  | { kind: 'missing' };

/** Theoretical hourly output. Setup time is excluded because it is not repeated per unit. */
export function calculateStandardHourlyCapacity(input: {
  timeBasis: string | null;
  standardMillisecondsPerUnit: number | null;
  unitsPerProduct: number;
}): StandardHourlyCapacity {
  if (input.timeBasis === 'per_batch') return { kind: 'per_batch' };
  const standard = Number(input.standardMillisecondsPerUnit);
  const units = Number(input.unitsPerProduct);
  if (input.timeBasis !== 'per_unit'
    || !Number.isSafeInteger(standard)
    || standard <= 0
    || !Number.isSafeInteger(units)
    || units <= 0) {
    return { kind: 'missing' };
  }
  return {
    kind: 'value',
    quantityPerHour: Math.round((3_600_000 / (standard * units)) * 10) / 10,
  };
}
