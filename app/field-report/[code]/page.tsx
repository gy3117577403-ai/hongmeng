import FieldReportMobile, { type FieldReportIdentityDTO } from '@/components/FieldReportMobile';
import FieldReportPinGate from '@/components/FieldReportPinGate';
import { currentUser } from '@/lib/auth';
import {
  resolveFieldReportPinPrincipal,
  resolveFieldReportTerminal,
} from '@/lib/field-report-pin-auth';
import { requirePageAccess } from '@/lib/page-access';
import { redirect } from 'next/navigation';
import './field-report.css';

export const dynamic = 'force-dynamic';

export default async function FieldReportPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { terminalBootstrap?: string };
}) {
  const terminal = await resolveFieldReportTerminal();
  if (terminal) {
    const principal = await resolveFieldReportPinPrincipal(params.code, terminal);
    if (!principal) {
      return <FieldReportPinGate code={params.code} terminal={terminal} />;
    }
    // FieldReportMobile only reads displayName from this compatibility prop;
    // request authorization always comes from the database-backed PIN session.
    const pinUser: FieldReportIdentityDTO = {
      id: principal.userId,
      displayName: principal.employee.name,
      employeeId: principal.employee.id,
    };
    return <FieldReportMobile code={params.code} user={pinUser} authMode="FIELD_PIN" />;
  }
  const next = `/field-report/${encodeURIComponent(params.code)}`;
  // SameSite=Strict may omit the terminal cookie on the first navigation from
  // an external camera app. One same-origin browser hop restores the cookie
  // without changing the printed QR URL or weakening the cookie policy.
  if (!await currentUser() && searchParams.terminalBootstrap !== '1') {
    redirect(`/field-terminal?bootstrap=1&next=${encodeURIComponent(next)}`);
  }
  const user = await requirePageAccess(next);
  return <FieldReportMobile code={params.code} user={user} authMode="ACCOUNT" />;
}
