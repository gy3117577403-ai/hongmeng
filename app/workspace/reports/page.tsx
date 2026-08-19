import { redirect } from 'next/navigation';
import { legacyReportRoute } from '@/lib/report-center-navigation';
import { requirePageAccess } from '@/lib/page-access';

type ReportsPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function appendLegacyFilters(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, raw]) => {
    if (['view', 'branch', 'section'].includes(key)) return;
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    values.filter(Boolean).forEach(value => query.append(key === 'workDate' ? 'date' : key, value));
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export default async function ReportsPage({ searchParams = {} }: ReportsPageProps) {
  const user = await requirePageAccess('/workspace/reports');
  const path = legacyReportRoute(searchParams, user.access.modules);
  redirect(appendLegacyFilters(path, searchParams));
}
