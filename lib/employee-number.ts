import type { Prisma } from '@prisma/client';

export const EMPLOYEE_NUMBER_SEQUENCE_KEY = 'employee';
export const EMPLOYEE_NUMBER_LOCK_KEY = 'hongmeng:employee-number-reorder';
export const EMPLOYEE_NUMBER_MINIMUM_WIDTH = 4;

export function formatEmployeeNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('员工编号序号必须是正整数');
  }
  return String(value).padStart(EMPLOYEE_NUMBER_MINIMUM_WIDTH, '0');
}

export async function allocateEmployeeNumber(tx: Prisma.TransactionClient): Promise<string> {
  // Serialize ordinary hires with the one-time reorder transaction. This makes
  // sure a hire that starts during a reorder sees the committed final roster,
  // instead of calculating against temporary or pre-reorder employee numbers.
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${EMPLOYEE_NUMBER_LOCK_KEY}))::text AS "locked"
  `;
  const rows = await tx.$queryRaw<Array<{ allocatedNumber: number }>>`
    WITH "current_employee_number" AS (
      SELECT COALESCE(
        MAX(
          CASE
            WHEN "employee_no" ~ '^[0-9]+$' AND LENGTH("employee_no") <= 9
              THEN "employee_no"::INTEGER
            ELSE NULL
          END
        ),
        0
      ) AS "max_value"
      FROM "employees"
    )
    UPDATE "employee_number_sequences" AS "sequence"
    SET
      "next_value" = GREATEST(
        "sequence"."next_value",
        "current_employee_number"."max_value" + 1
      ) + 1,
      "updated_at" = CURRENT_TIMESTAMP
    FROM "current_employee_number"
    WHERE "key" = ${EMPLOYEE_NUMBER_SEQUENCE_KEY}
    RETURNING "sequence"."next_value" - 1 AS "allocatedNumber"
  `;
  const allocatedNumber = Number(rows[0]?.allocatedNumber);
  if (!Number.isSafeInteger(allocatedNumber) || allocatedNumber < 1) {
    throw new Error('员工编号序列尚未初始化');
  }
  return formatEmployeeNumber(allocatedNumber);
}
