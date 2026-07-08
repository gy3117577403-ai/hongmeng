import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { invalidSpecificationReason } from '../lib/bulk-original-drawing-parser-core.mjs';

loadEnvFile();

const prisma = new PrismaClient();

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

function anomalyReason(item) {
  const specReason = invalidSpecificationReason(item.specification || '');
  if (specReason) return specReason;
  if (item.files.length === 0 && !hasMeaningfulRemark(item.remark)) return '无文件空记录';
  if (!String(item.libraryKey || '').trim()) return '未归档记录';
  return '';
}

function printSample(item, index) {
  const reason = anomalyReason(item);
  console.log(`${index + 1}. ${reason} | ${item.customerName || '-'} | ${item.specification || '-'} | ${item.productName || '-'} | files=${item.files.length}`);
}

async function main() {
  const items = await prisma.drawingLibraryItem.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      customerName: true,
      productName: true,
      specification: true,
      libraryKey: true,
      remark: true,
      lastImportedAt: true,
      lastWorkOrderId: true,
      files: { where: { deletedAt: null }, select: { id: true } },
    },
    orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
  });

  const anomalies = items.filter(item => !!anomalyReason(item));
  const dateSpecifications = items.filter(item => /日期/.test(invalidSpecificationReason(item.specification || '')));
  const emptySpecifications = items.filter(item => invalidSpecificationReason(item.specification || '') === '规格为空');
  const emptyNoFile = items.filter(item => item.files.length === 0 && !hasMeaningfulRemark(item.remark));
  const abnormalWithFiles = items.filter(item => !!invalidSpecificationReason(item.specification || '') && item.files.length > 0);
  const unarchived = items.filter(item => !String(item.libraryKey || '').trim());

  console.log('Drawing library anomaly audit');
  console.log('Mode: DRY RUN');
  console.log(`Active DrawingLibraryItems: ${items.length}`);
  console.log(`Anomaly records: ${anomalies.length}`);
  console.log(`Date-like specifications: ${dateSpecifications.length}`);
  console.log(`Empty specifications: ${emptySpecifications.length}`);
  console.log(`Empty records without files: ${emptyNoFile.length}`);
  console.log(`Records with files but invalid specification: ${abnormalWithFiles.length}`);
  console.log(`Unarchived records: ${unarchived.length}`);
  console.log('First 50 anomaly records:');
  anomalies.slice(0, 50).forEach(printSample);
  console.log('DRY RUN ONLY: no database rows, DrawingLibraryFiles, S3 objects, WorkOrders or connector data were changed.');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
