import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  TerminalToolingBladePosition,
  TerminalToolingSetupStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { terminalToolingContextKey } from '../lib/terminal-tooling';
import {
  publishTerminalToolingSetup,
  TerminalToolingPublishError,
} from '../lib/terminal-tooling-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('publishing a new setup archives the prior version without losing it', {
  skip: !runDatabaseIntegration,
}, async () => {
  const suffix = randomUUID().slice(0, 8);
  const actor = `terminal-tooling-it-${suffix}`;
  const normalizedKey = `10075-${suffix}`;
  const contextKey = terminalToolingContextKey({
    wireRange: '0.35-0.50mm²',
    equipment: '半自动压接机',
    mold: `M-${suffix}`,
  });
  const terminal = await prisma.terminalToolingTerminal.create({
    data: {
      specification: `10075-${suffix}`,
      normalizedKey,
      createdBy: actor,
      updatedBy: actor,
    },
  });
  const positions = Object.values(TerminalToolingBladePosition);
  const blades = await Promise.all(positions.map((position, index) => (
    prisma.terminalToolingBlade.create({
      data: {
        model: `B-${index + 1}-${suffix}`,
        normalizedKey: `b-${index + 1}-${suffix}`,
        compatiblePositions: [position],
        specification: `${2.4 + index * 0.1}*1.5`,
        createdBy: actor,
        updatedBy: actor,
      },
    })
  )));

  try {
    const first = await prisma.terminalToolingSetup.create({
      data: {
        terminalId: terminal.id,
        name: '首版调模参数',
        wireRange: '0.35-0.50mm²',
        equipment: '半自动压接机',
        mold: `M-${suffix}`,
        contextKey,
        version: 1,
        createdBy: actor,
        updatedBy: actor,
        positions: {
          create: positions.map((position, index) => ({
            position,
            bladeId: blades[index].id,
          })),
        },
      },
    });
    const publishedFirst = await publishTerminalToolingSetup({
      setupId: first.id,
      expectedVersion: 1,
      actor,
    });
    assert.equal(publishedFirst.status, TerminalToolingSetupStatus.PUBLISHED);
    assert.equal(publishedFirst.lockVersion, 2);

    const second = await prisma.terminalToolingSetup.create({
      data: {
        terminalId: terminal.id,
        name: '第二版调模参数',
        wireRange: '0.35-0.50mm²',
        equipment: '半自动压接机',
        mold: `M-${suffix}`,
        contextKey,
        version: 2,
        createdBy: actor,
        updatedBy: actor,
        positions: {
          create: positions.map((position, index) => ({
            position,
            bladeId: blades[index].id,
          })),
        },
      },
    });

    await assert.rejects(
      publishTerminalToolingSetup({ setupId: second.id, expectedVersion: 999, actor }),
      (error: unknown) => (
        error instanceof TerminalToolingPublishError
        && error.kind === 'CONFLICT'
      ),
    );
    const afterConflict = await prisma.terminalToolingSetup.findMany({
      where: { terminalId: terminal.id },
      orderBy: { version: 'asc' },
    });
    assert.deepEqual(afterConflict.map(item => item.status), [
      TerminalToolingSetupStatus.PUBLISHED,
      TerminalToolingSetupStatus.DRAFT,
    ]);

    await publishTerminalToolingSetup({ setupId: second.id, expectedVersion: 1, actor });
    const finalVersions = await prisma.terminalToolingSetup.findMany({
      where: { terminalId: terminal.id },
      orderBy: { version: 'asc' },
    });
    assert.deepEqual(finalVersions.map(item => item.status), [
      TerminalToolingSetupStatus.ARCHIVED,
      TerminalToolingSetupStatus.PUBLISHED,
    ]);
    assert.deepEqual(finalVersions.map(item => item.version), [1, 2]);
  } finally {
    await prisma.terminalToolingSetup.deleteMany({ where: { terminalId: terminal.id } });
    await prisma.terminalToolingTerminal.delete({ where: { id: terminal.id } });
    await prisma.terminalToolingBlade.deleteMany({ where: { id: { in: blades.map(item => item.id) } } });
  }
});
