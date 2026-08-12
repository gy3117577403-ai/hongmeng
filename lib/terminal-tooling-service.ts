import type { Prisma } from '@prisma/client';
import {
  terminalToolingSetupInclude,
  terminalToolingSupplierKey,
  validateTerminalToolingPublish,
  type ParsedTerminalToolingSetupPosition,
  type ParsedTerminalToolingSupply,
} from '@/lib/terminal-tooling';
import { prisma } from '@/lib/prisma';

type ToolingTransaction = Prisma.TransactionClient;

async function supplierId(
  tx: ToolingTransaction,
  link: ParsedTerminalToolingSupply,
): Promise<string> {
  const normalizedName = terminalToolingSupplierKey(link.supplierName);
  const supplier = await tx.terminalToolingSupplier.upsert({
    where: { normalizedName },
    create: {
      name: link.supplierName,
      normalizedName,
      website: link.productUrl,
    },
    update: {
      name: link.supplierName,
      isActive: true,
      ...(link.productUrl ? { website: link.productUrl } : {}),
    },
    select: { id: true },
  });
  return supplier.id;
}

export async function replaceTerminalSuppliers(
  tx: ToolingTransaction,
  terminalId: string,
  links: ParsedTerminalToolingSupply[],
) {
  await tx.terminalToolingTerminalSupply.deleteMany({ where: { terminalId } });
  for (const link of links) {
    await tx.terminalToolingTerminalSupply.create({
      data: {
        terminalId,
        supplierId: await supplierId(tx, link),
        supplierSku: link.supplierSku,
        productUrl: link.productUrl,
        remark: link.remark,
      },
    });
  }
}

export async function replaceBladeSuppliers(
  tx: ToolingTransaction,
  bladeId: string,
  links: ParsedTerminalToolingSupply[],
) {
  await tx.terminalToolingBladeSupply.deleteMany({ where: { bladeId } });
  for (const link of links) {
    await tx.terminalToolingBladeSupply.create({
      data: {
        bladeId,
        supplierId: await supplierId(tx, link),
        supplierSku: link.supplierSku,
        productUrl: link.productUrl,
        remark: link.remark,
      },
    });
  }
}

export async function replaceSetupPositions(
  tx: ToolingTransaction,
  setupId: string,
  positions: ParsedTerminalToolingSetupPosition[],
) {
  await tx.terminalToolingSetupPosition.deleteMany({ where: { setupId } });
  if (!positions.length) return;
  await tx.terminalToolingSetupPosition.createMany({
    data: positions.map(position => ({
      setupId,
      position: position.position,
      bladeId: position.bladeId,
      remark: position.remark,
    })),
  });
}

export async function replaceSetupTags(
  tx: ToolingTransaction,
  setupId: string,
  labels: string[],
) {
  await tx.terminalToolingSetupTag.deleteMany({ where: { setupId } });
  for (const label of labels) {
    const normalizedKey = terminalToolingSupplierKey(label);
    const tag = await tx.terminalToolingTag.upsert({
      where: { normalizedKey },
      create: { label, normalizedKey },
      update: { label, isActive: true },
      select: { id: true },
    });
    await tx.terminalToolingSetupTag.create({ data: { setupId, tagId: tag.id } });
  }
}

export async function nextSetupVersion(
  tx: ToolingTransaction,
  terminalId: string,
  contextKey: string,
): Promise<number> {
  const latest = await tx.terminalToolingSetup.findFirst({
    where: { terminalId, contextKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version || 0) + 1;
}

export class TerminalToolingPublishError extends Error {
  constructor(
    public readonly kind: 'NOT_FOUND' | 'STATE' | 'VALIDATION' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

export async function publishTerminalToolingSetup(input: {
  setupId: string;
  expectedVersion: number;
  actor: string;
}) {
  const setupId = await prisma.$transaction(async tx => {
    const current = await tx.terminalToolingSetup.findUnique({
      where: { id: input.setupId },
      include: terminalToolingSetupInclude,
    });
    if (!current) throw new TerminalToolingPublishError('NOT_FOUND', '调模方案不存在');
    if (current.status !== 'DRAFT') throw new TerminalToolingPublishError('STATE', '只有草稿可以发布');
    const errors = validateTerminalToolingPublish({
      terminalActive: current.terminal.isActive,
      positions: current.positions,
    });
    if (errors.length) throw new TerminalToolingPublishError('VALIDATION', errors.join('；'));

    const result = await tx.terminalToolingSetup.updateMany({
      where: { id: current.id, status: 'DRAFT', lockVersion: input.expectedVersion },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedBy: input.actor,
        updatedBy: input.actor,
        lockVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new TerminalToolingPublishError('CONFLICT', '调模方案已被其他人修改，请刷新后重试');

    await tx.terminalToolingSetup.updateMany({
      where: {
        terminalId: current.terminalId,
        contextKey: current.contextKey,
        status: 'PUBLISHED',
        id: { not: current.id },
      },
      data: { status: 'ARCHIVED', updatedBy: input.actor, lockVersion: { increment: 1 } },
    });
    return current.id;
  }, { isolationLevel: 'Serializable' });

  return prisma.terminalToolingSetup.findUniqueOrThrow({
    where: { id: setupId },
    include: terminalToolingSetupInclude,
  });
}
