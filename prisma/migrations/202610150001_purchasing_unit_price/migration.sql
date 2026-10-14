-- Historical totals are retained as totals. Do not invent historical unit prices.
ALTER TABLE "PcLine"
  ADD COLUMN "unitPrice" DECIMAL(18,6),
  ADD COLUMN "goodsCents" INTEGER,
  ADD COLUMN "freightCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_pricing_check" CHECK (
  "freightCents" >= 0 AND "discountCents" >= 0 AND
  (("unitPrice" IS NULL AND "goodsCents" IS NULL AND "freightCents" = 0 AND "discountCents" = 0) OR
   ("unitPrice" IS NOT NULL AND "goodsCents" IS NOT NULL AND
    "unitPrice" > 0 AND "goodsCents" > 0 AND "actualCents" = "goodsCents" + "freightCents" - "discountCents"))
);
