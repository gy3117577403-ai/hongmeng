CREATE TABLE "connector_parameters" (
    "id" TEXT NOT NULL,
    "row_no" INTEGER,
    "model" TEXT,
    "outer_peel_mm" TEXT,
    "inner_peel_mm" TEXT,
    "insertion_length_mm" TEXT,
    "remark" TEXT,
    "is_highlighted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "connector_parameters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "connector_parameter_files" (
    "id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "display_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "connector_parameter_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "connector_parameters_row_no_idx" ON "connector_parameters"("row_no");
CREATE INDEX "connector_parameters_model_idx" ON "connector_parameters"("model");
CREATE INDEX "connector_parameters_is_highlighted_idx" ON "connector_parameters"("is_highlighted");
CREATE INDEX "connector_parameters_deleted_at_idx" ON "connector_parameters"("deleted_at");
CREATE INDEX "connector_parameter_files_deleted_at_idx" ON "connector_parameter_files"("deleted_at");
CREATE INDEX "connector_parameter_files_created_at_idx" ON "connector_parameter_files"("created_at");
