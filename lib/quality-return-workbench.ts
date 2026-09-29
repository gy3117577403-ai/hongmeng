/** Shared presentation rules for the workbench and return dialog. */
export const returnStatusLabel: Record<string, string> = {
  OPEN: '待处理', READY: '待提交', REVIEWING: '待复核', RESOLVED: '已关闭',
};
export function returnCounts(issues: readonly { status: string }[]) {
  const count = (status: string) => issues.filter(i => i.status === status).length;
  return { open: count('OPEN'), ready: count('READY'), reviewing: count('REVIEWING'), resolved: count('RESOLVED'), active: issues.filter(i => i.status !== 'RESOLVED').length };
}
export function orderedReturns<T extends { status: string; createdAt: string | Date }>(issues: readonly T[]): T[] {
  const priority: Record<string, number> = { OPEN: 0, READY: 1, REVIEWING: 2, RESOLVED: 3 };
  return [...issues].sort((a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4) || +new Date(b.createdAt) - +new Date(a.createdAt));
}
type LineageFile = { id: string; supersedesFileId: string | null; isCurrent: boolean; deletedAt?: string | Date | null; category: { code: string } };
export function replacementCandidates<T extends LineageFile>(files: readonly T[], issue: { fileId: string | null; kind: string }): T[] {
  const byId = new Map(files.map(f => [f.id, f]));
  return files.filter(file => {
    if (!file.isCurrent || file.deletedAt || issue.kind !== 'package' && file.category.code !== issue.kind) return false;
    if (!issue.fileId) return issue.kind === 'package';
    let cursor: T | undefined = file;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      if (cursor.id === issue.fileId || cursor.supersedesFileId === issue.fileId) return true;
      seen.add(cursor.id); cursor = byId.get(cursor.supersedesFileId || '');
    }
    return false;
  });
}
