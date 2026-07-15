import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

function safeNext(value?: string | string[]): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

export default async function Login({ searchParams }: { searchParams?: { next?: string | string[] } }) {
  const next = safeNext(searchParams?.next);
  if (await currentUser()) redirect(next);
  return <LoginForm nextPath={next} />;
}
