import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

loadEnvFile();

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

function loadEnvFile() {
  const envFile = existsSync('.env') ? '.env' : existsSync('.env.example') ? '.env.example' : '';
  if (!envFile) return;

  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function hasMeaningfulRemark(remark) {
  const text = String(remark || '').trim();
  return !!text && text !== '-';
}

function isCleanupCandidate(item) {
  return !item.deletedAt
    && item.files.length === 0
    && !hasMeaningfulRemark(item.remark)
    && !!item.lastImportedAt
    && !!item.lastWorkOrderId;
}

function printSample(item, index) {
  console.log(`${index + 1}. ${item.customerName} | ${item.specification} | ${item.productName || '-'} | lastWorkOrderId=${item.lastWorkOrderId}`);
}

async function main() {
  const [items, connectorParameterCount, connectorParameterFileCount, workOrderCount] = await Promise.all([
    prisma.drawingLibraryItem.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        customerName: true,
        productName: true,
        specification: true,
        remark: true,
        deletedAt: true,
        lastImportedAt: true,
        lastWorkOrderId: true,
        files: { select: { id: true } },
      },
      orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
    }),
    prisma.connectorParameter.count(),
    prisma.connectorParameterFile.count(),
    prisma.workOrder.count(),
  ]);

  const candidates = items.filter(isCleanupCandidate);
  const withFileCount = items.filter(item => item.files.length > 0).length;
  const withRemarkCount = items.filter(item => hasMeaningfulRemark(item.remark)).length;

  console.log('Empty drawing library cleanup plan');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Active DrawingLibraryItems: ${items.length}`);
  console.log(`Cleanup candidates: ${candidates.length}`);
  console.log(`Customers involved: ${new Set(candidates.map(item => item.customerName)).size}`);
  console.log(`Specifications involved: ${new Set(candidates.map(item => item.specification)).size}`);
  console.log(`Retained records: ${items.length - candidates.length}`);
  console.log(`Records with files retained: ${withFileCount}`);
  console.log(`Records with remarks retained: ${withRemarkCount}`);
  console.log(`WorkOrders retained: ${workOrderCount}`);
  console.log(`ConnectorParameters retained: ${connectorParameterCount}`);
  console.log(`ConnectorParameterFiles retained: ${connectorParameterFileCount}`);
  console.log('First 20 cleanup candidates:');
  candidates.slice(0, 20).forEach(printSample);

  if (!execute) {
    console.log('DRY RUN ONLY: no database rows or S3 objects were deleted.');
    console.log('Product drawing-library masters are permanent. Execute mode is disabled.');
    return;
  }

  console.error('REFUSED: product drawing-library masters are permanent, including empty masters.');
  console.error('Delete or replace individual files in the application instead. No database rows or S3 objects were changed.');
  process.exitCode = 2;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
