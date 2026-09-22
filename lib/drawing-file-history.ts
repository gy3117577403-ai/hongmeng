type HistoryFile = {
  id: string; supersedesFileId?: string | null; originalName: string; displayName?: string | null;
  version: string; sourceType?: string | null; sourceSopVersionId?: string | null; sourcePdfOverlayVersionId?: string | null;
  createdAt: Date; uploadedBy?: { displayName?: string | null; username: string } | null;
  firstUploadedAt?: Date | null;
};

/** Content versions are immutable rows. Metadata updatedAt is deliberately not used. */
export function drawingFileHistory(file: HistoryFile, files: HistoryFile[]) {
  const index = new Map(files.map(f => [f.id, f])), seen = new Set<string>(), history: HistoryFile[] = [];
  let cursor: HistoryFile | undefined = file;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); history.push(cursor);
    cursor = cursor.supersedesFileId ? index.get(cursor.supersedesFileId) : undefined;
  }
  const oldest = history.at(-1)!;
  const originKnown = !oldest.supersedesFileId && oldest.sourceType === "MANUAL_UPLOAD";
  return {
    firstUploadedAt: file.firstUploadedAt?.toISOString() || (originKnown ? oldest.createdAt.toISOString() : null),
    contentChangedAt: file.supersedesFileId ? file.createdAt.toISOString() : null,
    recordedAt: file.createdAt.toISOString(),
    timeKind: file.sourceType === "MANUAL_UPLOAD" ? "UPLOAD" : file.sourceSopVersionId || file.sourcePdfOverlayVersionId ? "PUBLISH" : "RECORD",
    history: history.map(f => ({ id: f.id, name: f.displayName || f.originalName, version: f.version,
      at: f.createdAt.toISOString(), actor: f.uploadedBy?.displayName || f.uploadedBy?.username || "历史未记录",
      kind: f.sourceType === "MANUAL_UPLOAD" ? "UPLOAD" : f.sourceSopVersionId || f.sourcePdfOverlayVersionId ? "PUBLISH" : "RECORD",
      downloadUrl: "/api/drawing-library/files/" + f.id + "/download" })),
  };
}
