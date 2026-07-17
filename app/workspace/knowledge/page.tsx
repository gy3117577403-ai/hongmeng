import { redirect } from 'next/navigation';
import KnowledgeBaseShell from '@/components/KnowledgeBaseShell';
import { currentUser } from '@/lib/auth';
import './knowledge-workbench.css';

export const dynamic = 'force-dynamic';

type KnowledgePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function queryValue(searchParams: KnowledgePageProps['searchParams'], key: string): string {
  const value = searchParams?.[key];
  return (Array.isArray(value) ? value[0] : value || '').slice(0, 240);
}

export default async function KnowledgeBasePage({ searchParams }: KnowledgePageProps) {
  const articleId = queryValue(searchParams, 'articleId');
  const initialState = {
    keyword: queryValue(searchParams, 'q'),
    source: queryValue(searchParams, 'source') || (articleId ? 'article' : 'all'),
    category: queryValue(searchParams, 'category') || 'all',
    selectedKey: queryValue(searchParams, 'item') || (articleId ? `article:${articleId}` : ''),
  };
  const user = await currentUser();
  if (!user) {
    const nextParams = new URLSearchParams();
    if (initialState.keyword) nextParams.set('q', initialState.keyword);
    if (initialState.source !== 'all') nextParams.set('source', initialState.source);
    if (initialState.category !== 'all') nextParams.set('category', initialState.category);
    if (initialState.selectedKey) nextParams.set('item', initialState.selectedKey);
    const query = nextParams.toString();
    const nextPath = query ? `/workspace/knowledge?${query}` : '/workspace/knowledge';
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return (
    <KnowledgeBaseShell
      user={user}
      initialState={initialState}
    />
  );
}
