const DEFAULT_PRINT_RETURN_TO = '/production';
const ALLOWED_PRINT_RETURN_PATHS = new Set(['/production', '/weekly-plan-center']);

export function sanitizeWorkOrderPrintReturnTo(input: unknown): string {
  const raw = Array.isArray(input) ? input[0] : input;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_PRINT_RETURN_TO;
  }
  try {
    const parsed = new URL(value, 'https://print-return.invalid');
    if (parsed.origin !== 'https://print-return.invalid' || !ALLOWED_PRINT_RETURN_PATHS.has(parsed.pathname)) {
      return DEFAULT_PRINT_RETURN_TO;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_PRINT_RETURN_TO;
  }
}

export function workOrderPrintReturnLabel(returnTo: string): string {
  return returnTo.startsWith('/weekly-plan-center') ? '返回计划中心' : '返回生产执行';
}
