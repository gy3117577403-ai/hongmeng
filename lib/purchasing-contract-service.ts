import { prisma } from './prisma';
import { contractContent, defaultContractContent } from './purchasing-contract';

export async function purchasingContractTemplates() {
  const rows=await prisma.pcContractTemplate.findMany({orderBy:{revision:'desc'},take:50});
  return { latestRevision:rows[0]?.revision || 0, templates:rows.map(t=>({id:t.id,revision:t.revision,name:t.name,content:contractContent(t.content),actorName:t.actorName,createdAt:t.createdAt.toISOString()})),
    initial:defaultContractContent() };
}
