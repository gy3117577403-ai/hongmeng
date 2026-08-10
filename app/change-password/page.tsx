import { redirect } from 'next/navigation';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { currentUser } from '@/lib/auth';
import './change-password.css';

function safeNext(value?: string | string[]): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams?: { next?: string | string[] };
}) {
  const user = await currentUser();
  const nextPath = safeNext(searchParams?.next);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/change-password?next=${encodeURIComponent(nextPath)}`)}`);
  return (
    <ChangePasswordForm
      username={user.username}
      displayName={user.displayName}
      required={user.mustChangePassword}
      nextPath={nextPath}
    />
  );
}
