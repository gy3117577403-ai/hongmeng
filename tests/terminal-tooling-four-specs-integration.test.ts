import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { parseTerminalToolingBlade, serializeTerminalToolingBlade, terminalToolingBladeInclude, TERMINAL_TOOLING_POSITIONS } from '../lib/terminal-tooling';
import { replaceBladePositionSpecs } from '../lib/terminal-tooling-service';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
test('database keeps each position and supplier independent and rolls back failed updates', { skip: !enabled }, async () => {
  const marker = 'blade-it-' + randomUUID();
  const input = parseTerminalToolingBlade({ model: marker, positionSpecs: TERMINAL_TOOLING_POSITIONS.map((position, i) => ({ position, specification: `SPEC-${i}`, dimensionA: `${i + 1}.25`, dimensionB: '1.5', material: `M-${i}`, supplierLinks: [{ supplierName: marker, supplierSku: `SKU-${i}` }] })) }).data!;
  const blade = await prisma.terminalToolingBlade.create({ data: { model: marker, normalizedKey: marker, compatiblePositions: [...TERMINAL_TOOLING_POSITIONS] } });
  try {
    await prisma.$transaction(tx => replaceBladePositionSpecs(tx, blade.id, input.positionSpecs));
    const read = async () => serializeTerminalToolingBlade(await prisma.terminalToolingBlade.findUniqueOrThrow({ where: { id: blade.id }, include: terminalToolingBladeInclude }));
    const before = await read();
    assert.equal(before.positionSpecs.length, 4);
    const updated = structuredClone(input.positionSpecs);
    updated[0].specification = 'ONLY-UPPER-OUTER';
    updated[0].supplierLinks[0].supplierSku = 'CHANGED';
    await prisma.$transaction(async tx => {
      const result = await tx.terminalToolingBlade.updateMany({ where: { id: blade.id, lockVersion: before.lockVersion }, data: { lockVersion: { increment: 1 } } });
      assert.equal(result.count, 1);
      await replaceBladePositionSpecs(tx, blade.id, updated);
    });
    const after = await read();
    for (const position of TERMINAL_TOOLING_POSITIONS.slice(1)) assert.deepEqual(after.positionSpecs.find(spec => spec.position === position), before.positionSpecs.find(spec => spec.position === position), 'other specs and supplies preserved');
    assert.equal(after.positionSpecs.find(spec => spec.position === 'UPPER_OUTER')?.specification, 'ONLY-UPPER-OUTER');
    assert.equal((await prisma.terminalToolingBlade.updateMany({ where: { id: blade.id, lockVersion: before.lockVersion }, data: { model: 'stale overwrite' } })).count, 0);
    await assert.rejects(prisma.$transaction(async tx => {
      await replaceBladePositionSpecs(tx, blade.id, input.positionSpecs);
      throw new Error('simulate failure');
    }), /simulate failure/);
    assert.deepEqual((await read()).positionSpecs, after.positionSpecs);
  } finally {
    await prisma.terminalToolingBlade.delete({ where: { id: blade.id } });
    await prisma.terminalToolingSupplier.deleteMany({ where: { name: marker } });
  }
});

test('migration preserves old setup references and marks shared specs for review without inventing missing positions', { skip: !enabled }, async () => {
  const marker = 'blade-migrate-' + randomUUID();
  const source = await prisma.terminalToolingBlade.create({ data: { model: marker, normalizedKey: marker, specification: '2.4×1.5', dimensionA: '2.4', dimensionB: '1.5', compatiblePositions: ['UPPER_OUTER', 'LOWER_INNER'], supplierLinks: { create: { supplier: { create: { name: marker, normalizedName: marker } }, supplierSku: 'legacy-sku' } } }, include: { supplierLinks: true } });
  const terminal = await prisma.terminalToolingTerminal.create({ data: { specification: marker, normalizedKey: marker } });
  const setup = await prisma.terminalToolingSetup.create({ data: { terminalId: terminal.id, contextKey: marker, version: 1, status: 'PUBLISHED', positions: { create: { position: 'UPPER_OUTER', bladeId: source.id } } }, include: { positions: true } });
  try {
    const sql = readFileSync('prisma/migrations/202609140003_blade_position_specs/migration.sql', 'utf8');
    const inserts = sql.slice(sql.indexOf('INSERT INTO "terminal_tooling_blade_specs"')).split(';').map(value => value.trim()).filter(Boolean);
    // Apply the actual migration backfill, scoped to this disposable fixture.
    await prisma.$executeRawUnsafe(inserts[0].replace('FROM "terminal_tooling_blades" b', 'FROM (SELECT * FROM "terminal_tooling_blades" WHERE "id" = $1) b'), source.id);
    await prisma.$executeRawUnsafe(inserts[1] + ' WHERE ps."blade_id" = $1', source.id);
    const migrated = await prisma.terminalToolingBlade.findUniqueOrThrow({ where: { id: source.id }, include: terminalToolingBladeInclude });
    assert.deepEqual(migrated.positionSpecs.map(spec => spec.position).sort(), ['LOWER_INNER', 'UPPER_OUTER']);
    assert.ok(migrated.positionSpecs.every(spec => spec.needsReview && spec.specification === source.specification && spec.supplierLinks[0].supplierSku === 'legacy-sku'));
    assert.equal(migrated.specification, source.specification);
    assert.equal(migrated.supplierLinks[0].id, source.supplierLinks[0].id);
    const preserved = await prisma.terminalToolingSetupPosition.findUniqueOrThrow({ where: { id: setup.positions[0].id } });
    assert.equal(preserved.bladeId, source.id);
    assert.equal((await prisma.terminalToolingSetup.findUniqueOrThrow({ where: { id: setup.id } })).status, 'PUBLISHED');
  } finally {
    await prisma.terminalToolingSetup.delete({ where: { id: setup.id } });
    await prisma.terminalToolingTerminal.delete({ where: { id: terminal.id } });
    await prisma.terminalToolingBlade.delete({ where: { id: source.id } });
    await prisma.terminalToolingSupplier.delete({ where: { id: source.supplierLinks[0].supplierId } });
  }
});
