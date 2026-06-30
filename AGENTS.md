# Codex Instructions

Build and maintain a production tablet-first work order resource management system.

Rules:
- Login required.
- No RBAC / role permissions unless requested.
- All logged-in users share the same data.
- Uploaded files must not be stored permanently on local disk.
- Store files in S3-compatible object storage.
- Store metadata in PostgreSQL.
- Use Prisma migrations.
- Use soft delete for files.
- UI target: 1366x1024 horizontal tablet, orange theme, left work order list, middle category menu, right preview panel.
