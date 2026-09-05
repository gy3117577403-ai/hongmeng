import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { QualityDataError, qualityText, type QualityFormData } from './quality-data';

export async function qualityOptions(q: string | null) {
  const query = qualityText(q, 160);
  const [teams, terminals] = await Promise.all([
    prisma.productionTeam.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, code: true, legacyTeamName: true } }),
    prisma.terminalToolingTerminal.findMany({ where: { isActive: true, ...(query ? { OR: [{ specification: { contains: query, mode: 'insensitive' } }, { manufacturer: { contains: query, mode: 'insensitive' } }] } : {}) }, orderBy: { specification: 'asc' }, take: 60, select: { id: true, specification: true, manufacturer: true, wireRange: true } }),
  ]);
  return { teams, terminals };
}

export async function bindQualityTeam(tx: Prisma.TransactionClient, data: QualityFormData, previous?: QualityFormData) {
  if (data.teamId && data.teamId === previous?.teamId) {
    data.context.team = previous.context.team;
    return;
  }
  if (data.teamId) {
    const team = await tx.productionTeam.findFirst({ where: { id: data.teamId, isActive: true } });
    if (!team) throw new QualityDataError('所选班组不存在或已停用，请重新选择');
    data.context.team = team.name;
  } else if (data.context.team && data.context.team !== previous?.context.team) {
    const matches = await tx.productionTeam.findMany({ where: { isActive: true, OR: [{ name: data.context.team }, { legacyTeamName: data.context.team }] }, take: 2 });
    if (matches.length !== 1) throw new QualityDataError('请从已有班组中选择明确的班组');
    const team = matches[0];
    data.teamId = team.id; data.context.team = team.name;
  }
}
