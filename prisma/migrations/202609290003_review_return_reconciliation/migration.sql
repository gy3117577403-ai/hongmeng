-- Queue existing unresolved return chains for the same locked reconciliation used on future document changes.
-- Never grant an approval, delete an issue, or overwrite a submitted file snapshot.
INSERT INTO "QfSyncQueue" ("libraryItemId", "updatedAt")
SELECT DISTINCT r."libraryItemId", CURRENT_TIMESTAMP
FROM "QfDocumentReturn" r
JOIN "drawing_library_items" p ON p.id = r."libraryItemId"
WHERE r.status <> 'RESOLVED' AND p."deleted_at" IS NULL
ON CONFLICT ("libraryItemId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt";
