import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

type ResponsibilityCompatibilityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export default async function ResponsibilityCollaborationPage({ searchParams }: ResponsibilityCompatibilityPageProps) {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fresponsibilities');

  const params = await searchParams;
  const legacyTab = readParam(params?.tab);
  const person = readParam(params?.person);
  const matter = readParam(params?.matter);
  const next = new URLSearchParams();

  if (legacyTab === 'roles') {
    next.set('view', 'directory');
    next.set('detail', 'collaboration');
  } else if (legacyTab === 'work') {
    next.set('view', 'approvals');
  } else {
    next.set('view', 'responsibilities');
  }
  if (person) next.set('person', person);
  if (matter) next.set('matter', matter);

  redirect(`/workspace/employees?${next.toString()}`);
}
