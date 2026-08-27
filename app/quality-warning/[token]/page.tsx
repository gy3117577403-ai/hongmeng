import type { Metadata } from 'next';
import { loadEmployeeQualityWarning } from '@/lib/quality-warning-employee';
import EmployeeQualityWarning from '@/components/EmployeeQualityWarning';
import '../employee-warning.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '员工异常作业指引', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function EmployeeWarningPage({ params }: { params: { token: string } }) {
  const data = await loadEmployeeQualityWarning(params.token);
  if (!data) return <main className="employee-warning unavailable"><h1>此异常指引暂不可用</h1><p>链接可能已撤销、过期或对应内容尚未发布。请联系现场质量人员确认，不要依据旧指引继续作业。</p><small>无需后台账号；此页不会跳转到后台登录。</small></main>;
  return <EmployeeQualityWarning warning={data.view} />;
}
