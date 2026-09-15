-- Read submitted work by its original business date, without changing production facts.
CREATE INDEX "process_report_submissions_status_work_date_idx" ON "process_report_submissions"("status", "work_date");
CREATE INDEX "process_completions_work_date_voided_at_idx" ON "process_completions"("work_date", "voided_at");
