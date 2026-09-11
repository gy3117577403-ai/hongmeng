/** Quick warnings use the current work order; major warnings retain their published revision link. */
export function qualityWarningQrPath(publicCode: string, warning: { alertId: string; employeePath?: string | null }) {
  return warning.alertId.startsWith('quick:')
    ? `/field-report/${encodeURIComponent(publicCode)}?mode=report`
    : warning.employeePath || null;
}

/** A drawing warning may appear on several orders in the same print packet. */
export function qualityWarningQrKey(printId: string, alertId: string) {
  return `${printId}:${alertId}`;
}
