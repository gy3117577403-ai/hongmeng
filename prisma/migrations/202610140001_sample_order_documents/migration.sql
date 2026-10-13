ALTER TABLE "sample_tasks" ADD COLUMN "document_snapshot" JSONB;
ALTER TABLE "sample_completions" ADD COLUMN "document_snapshot" JSONB;

-- Freeze each order's evidence before removing its sample-only approval gate.
-- Mass-production packages, signatures and shared current files are untouched.
UPDATE sample_tasks t SET document_review_required = FALSE,
  document_snapshot = COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', COALESCE(f.display_name, f.original_name),
      'kind', c.code, 'version', f.version, 'mimeType', f.mime_type,
      'size', f.size, 'createdAt', f.created_at
    ) ORDER BY c.code, f.created_at, f.id)
    FROM drawing_library_files f JOIN resource_categories c ON c.id=f.category_id
    WHERE f.library_item_id=t.drawing_library_item_id
      AND c.code IN ('drawing','sop')
      AND (CASE WHEN t.approved_package_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM "QfPackage" p WHERE p.id=t.approved_package_id
      ) THEN EXISTS (
        SELECT 1 FROM "QfPackage" p,
          jsonb_array_elements(p."drawingFiles" || p."sopFiles") e
        WHERE p.id=t.approved_package_id AND e->>'id'=f.id
      ) ELSE f.is_current AND f.deleted_at IS NULL END)
  ), '[]'::jsonb);

UPDATE sample_completions s SET document_snapshot = COALESCE((
  SELECT jsonb_agg(e.file) FROM "QfPackage" p,
    LATERAL (
      SELECT d || jsonb_build_object('kind','drawing') AS file FROM jsonb_array_elements(p."drawingFiles") d
      UNION ALL
      SELECT s || jsonb_build_object('kind','sop') AS file FROM jsonb_array_elements(p."sopFiles") s
    ) e
  WHERE p.id=s.approved_package_id
), '[]'::jsonb);
