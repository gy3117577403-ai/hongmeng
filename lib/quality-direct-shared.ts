/** Task analysis and operator identity shared by the form, review and print views. */
export type QualityOperator = { id: string; employeeNo: string; name: string; department: string; team: string };
export type QualityOperatorAssignments = Record<string, QualityOperator[]>;
export type QualityTaskAnalysis = { occurrenceCause?: string; rootCause?: string; legacy?: boolean; legacyOccurrenceCause?: string; legacyRootCause?: string };
export function qualityTaskCauses(task: { analysis?: unknown }, report: { occurrenceCause?: string | null; rootCause?: string | null }) {
  const analysis = (task.analysis && typeof task.analysis === 'object' ? task.analysis : {}) as QualityTaskAnalysis;
  return { occurrenceCause: analysis.occurrenceCause || (analysis.legacy ? analysis.legacyOccurrenceCause ?? report.occurrenceCause : '') || '',
    rootCause: analysis.rootCause || (analysis.legacy ? analysis.legacyRootCause ?? report.rootCause : '') || '', legacy: Boolean(analysis.legacy) };
}
export function qualityOperators(value: unknown): QualityOperator[] {
  return Array.isArray(value) ? value.filter((item): item is QualityOperator => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')) : [];
}
