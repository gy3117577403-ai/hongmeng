CREATE TABLE "employee_number_sequences" (
  "key" TEXT NOT NULL,
  "next_value" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_number_sequences_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "employee_number_sequences_next_value_check" CHECK ("next_value" > 0)
);

INSERT INTO "employee_number_sequences" (
  "key",
  "next_value",
  "created_at",
  "updated_at"
)
SELECT
  'employee',
  GREATEST(
    COALESCE(
      MAX(
        CASE
          WHEN "employee_no" ~ '^[0-9]+$' AND LENGTH("employee_no") <= 9
            THEN "employee_no"::INTEGER
          ELSE NULL
        END
      ),
      0
    ) + 1,
    1
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "employees";
