-- Additive execution counters for quantity-based production flow.
-- Existing text quantity columns remain unchanged for backward compatibility.
ALTER TABLE "work_orders"
ADD COLUMN "frontend_transferred_qty" INTEGER,
ADD COLUMN "execution_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "work_orders"
ADD CONSTRAINT "work_orders_frontend_transferred_qty_nonnegative"
CHECK ("frontend_transferred_qty" IS NULL OR "frontend_transferred_qty" >= 0),
ADD CONSTRAINT "work_orders_execution_version_nonnegative"
CHECK ("execution_version" >= 0);
