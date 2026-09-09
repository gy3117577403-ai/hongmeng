-- CreateEnum
CREATE TYPE "OtherWorkTimeStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'VOIDED');

-- CreateTable
CREATE TABLE "other_work_time_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "other_work_time_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_work_time_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "employeeNoSnapshot" TEXT NOT NULL,
    "teamSnapshot" TEXT,
    "teamIdSnapshot" TEXT,
    "attainmentEligibleSnapshot" BOOLEAN NOT NULL,
    "attainmentStreamSnapshot" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryNameSnapshot" TEXT NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "approvedMinutes" INTEGER,
    "description" TEXT NOT NULL,
    "arranger" TEXT,
    "sampleReference" TEXT,
    "backfillReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" "OtherWorkTimeStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "correctionOfId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByName" TEXT,
    "correctionRequestedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "other_work_time_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_work_time_attachments" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "other_work_time_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_work_time_reviews" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "reason" TEXT,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "other_work_time_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "other_work_time_categories_code_key" ON "other_work_time_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "other_work_time_categories_name_key" ON "other_work_time_categories"("name");

-- CreateIndex
CREATE INDEX "other_work_time_requests_employeeId_workDate_status_idx" ON "other_work_time_requests"("employeeId", "workDate", "status");

-- CreateIndex
CREATE INDEX "other_work_time_requests_status_workDate_idx" ON "other_work_time_requests"("status", "workDate");

-- CreateIndex
CREATE INDEX "other_work_time_requests_teamIdSnapshot_status_idx" ON "other_work_time_requests"("teamIdSnapshot", "status");

-- CreateIndex
CREATE INDEX "other_work_time_requests_correctionOfId_idx" ON "other_work_time_requests"("correctionOfId");

-- CreateIndex
CREATE UNIQUE INDEX "other_work_time_requests_createdById_idempotencyKey_key" ON "other_work_time_requests"("createdById", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "other_work_time_attachments_objectKey_key" ON "other_work_time_attachments"("objectKey");

-- CreateIndex
CREATE INDEX "other_work_time_attachments_requestId_deletedAt_idx" ON "other_work_time_attachments"("requestId", "deletedAt");

-- CreateIndex
CREATE INDEX "other_work_time_reviews_requestId_createdAt_idx" ON "other_work_time_reviews"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_time_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_time_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_time_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "other_work_time_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_time_requests_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "other_work_time_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_attachments" ADD CONSTRAINT "other_work_time_attachments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "other_work_time_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_attachments" ADD CONSTRAINT "other_work_time_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_reviews" ADD CONSTRAINT "other_work_time_reviews_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "other_work_time_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_work_time_reviews" ADD CONSTRAINT "other_work_time_reviews_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Approved facts are bounded once, without discounting their actual duration.
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_minutes_valid" CHECK ("requestedMinutes" BETWEEN 1 AND 1440 AND ("approvedMinutes" IS NULL OR "approvedMinutes" BETWEEN 1 AND "requestedMinutes"));
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_approved_fact" CHECK (status NOT IN ('APPROVED', 'VOIDED') OR ("approvedMinutes" IS NOT NULL AND "reviewedAt" IS NOT NULL));
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_times_valid" CHECK (("startedAt" IS NULL AND "endedAt" IS NULL) OR ("startedAt" IS NOT NULL AND "endedAt" IS NOT NULL AND "endedAt" > "startedAt"));
INSERT INTO "other_work_time_categories" (id, code, name, "sortOrder", "updatedAt") VALUES
('other-sample', 'SAMPLE_ASSISTANCE', '协助样品', 0, CURRENT_TIMESTAMP),
('other-assignment', 'TEMPORARY_ASSIGNMENT', '临时安排', 1, CURRENT_TIMESTAMP),
('other-public', 'PUBLIC_ASSISTANCE', '公共辅助事务', 2, CURRENT_TIMESTAMP),
('other-misc', 'OTHER', '其他', 3, CURRENT_TIMESTAMP);
