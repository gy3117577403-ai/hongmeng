/** Shared preparation rules; evidence identity and signatures are checked on the server. */
export type FixtureDocumentPackage = {
  needFixture: boolean | null;
  drawingFiles: unknown;
  sopFiles: unknown;
  bomFileId?: string | null;
  bomConfirmed?: boolean;
  bomRows?: unknown;
};

export function fixtureSubmissionIssues(p: FixtureDocumentPackage): string[] {
  const issues: string[] = [];
  if (!(Array.isArray(p.drawingFiles) && p.drawingFiles.length) && !(Array.isArray(p.sopFiles) && p.sopFiles.length))
    issues.push("请至少上传一份图纸或 SOP");
  if (p.needFixture === null) issues.push("请选择是否需要治具");
  return issues;
}

export function fixtureDraftReady(p: FixtureDocumentPackage & { status: string }): boolean {
  return p.status === "DRAFT" && fixtureSubmissionIssues(p).length === 0;
}

export function fixtureDocumentLabel(p: Pick<FixtureDocumentPackage, "drawingFiles" | "sopFiles">): string {
  return [Array.isArray(p.drawingFiles) && p.drawingFiles.length ? "图纸" : "", Array.isArray(p.sopFiles) && p.sopFiles.length ? "SOP" : ""].filter(Boolean).join("、") || "生产资料";
}
