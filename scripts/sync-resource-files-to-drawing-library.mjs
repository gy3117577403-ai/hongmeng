import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

loadEnvFile();

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');
const confirmed = process.env.CONFIRM_SYNC_DRAWING_LIBRARY === 'YES';
const syncCategoryCodes = ['drawing', 'sop', 'product', 'material', 'notice'];

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

function parseCustomerCode(customerName) {
  const text = String(customerName || '').trim();
  const match = text.match(/\(([^()]*)\)\s*$/);
  return match?.[1]?.trim() || null;
}

function libraryKey(customerName, specification) {
  const spec = String(specification || '').trim();
  const customer = String(customerName || '').trim();
  return customer ? `${customer}::${spec}` : spec;
}

function itemIdentity(workOrder) {
  const specification = String(workOrder.specification || '').trim();
  const customerName = String(workOrder.customerName || '').trim() || '未设置';
  return {
    customerName,
    specification,
    libraryKey: libraryKey(customerName === '未设置' ? '' : customerName, specification),
  };
}

async function ensureItem(workOrder) {
  const identity = itemIdentity(workOrder);
  const existing = await prisma.drawingLibraryItem.findUnique({ where: { libraryKey: identity.libraryKey } });
  const data = {
    customerName: identity.customerName,
    customerCode: parseCustomerCode(identity.customerName),
    productName: workOrder.productName || existing?.productName || null,
    specification: identity.specification,
    libraryKey: identity.libraryKey,
    lastWorkOrderId: workOrder.id,
    lastImportedAt: new Date(),
    deletedAt: null,
  };
  return existing
    ? prisma.drawingLibraryItem.update({ where: { id: existing.id }, data })
    : prisma.drawingLibraryItem.create({ data });
}

async function main() {
  const [workOrderCount, resourceFileCount, connectorParameterCount, files] = await Promise.all([
    prisma.workOrder.count(),
    prisma.resourceFile.count(),
    prisma.connectorParameter.count(),
    prisma.resourceFile.findMany({
      where: {
        deletedAt: null,
        status: 'uploaded',
        category: { code: { in: syncCategoryCodes } },
        workOrder: { deletedAt: null },
      },
      include: {
        category: { select: { code: true } },
        workOrder: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const ids = files.map(file => file.id);
  const objectKeys = files.map(file => file.objectKey);
  const existingFiles = await prisma.drawingLibraryFile.findMany({
    where: {
      OR: [
        { sourceResourceFileId: { in: ids } },
        { objectKey: { in: objectKeys } },
      ],
    },
    select: { id: true, objectKey: true, sourceResourceFileId: true },
  });
  const existingSourceIds = new Set(existingFiles.map(file => file.sourceResourceFileId).filter(Boolean));
  const existingObjectKeys = new Set(existingFiles.map(file => file.objectKey));

  const noSpecification = files.filter(file => !String(file.workOrder.specification || '').trim());
  const alreadySynced = files.filter(file => existingSourceIds.has(file.id) || existingObjectKeys.has(file.objectKey));
  const candidates = files.filter(file => String(file.workOrder.specification || '').trim() && !existingSourceIds.has(file.id) && !existingObjectKeys.has(file.objectKey));
  const candidateKeys = Array.from(new Set(candidates.map(file => itemIdentity(file.workOrder).libraryKey)));
  const existingItems = candidateKeys.length
    ? await prisma.drawingLibraryItem.findMany({ where: { libraryKey: { in: candidateKeys } }, select: { libraryKey: true } })
    : [];
  const existingItemKeys = new Set(existingItems.map(item => item.libraryKey));
  const willCreateItemCount = candidateKeys.filter(key => !existingItemKeys.has(key)).length;

  console.log('Drawing library sync from work order resource files');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`WorkOrders: ${workOrderCount}`);
  console.log(`ResourceFiles: ${resourceFileCount}`);
  console.log(`Syncable active files: ${files.length}`);
  console.log(`Already synced or same objectKey skipped: ${alreadySynced.length}`);
  console.log(`Skipped without specification: ${noSpecification.length}`);
  console.log(`Will create DrawingLibraryItems: ${willCreateItemCount}`);
  console.log(`Will create DrawingLibraryFiles: ${candidates.length}`);
  console.log(`ConnectorParameters unaffected: ${connectorParameterCount}`);

  if (!execute) {
    console.log('DRY RUN ONLY: no database rows or S3 objects were changed.');
    console.log('To execute: set CONFIRM_SYNC_DRAWING_LIBRARY=YES and run npm run drawing-library:sync-from-workorders.');
    return;
  }

  if (!confirmed) {
    console.error('Refusing to sync. Set CONFIRM_SYNC_DRAWING_LIBRARY=YES to execute.');
    process.exitCode = 1;
    return;
  }

  let createdItems = 0;
  let createdFiles = 0;
  let skipped = 0;
  const seenKeys = new Set(existingItemKeys);

  for (const file of candidates) {
    const identity = itemIdentity(file.workOrder);
    const existedBefore = seenKeys.has(identity.libraryKey);
    const item = await ensureItem(file.workOrder);
    seenKeys.add(identity.libraryKey);
    if (!existedBefore) createdItems += 1;

    const duplicate = await prisma.drawingLibraryFile.findFirst({
      where: {
        OR: [
          { sourceResourceFileId: file.id },
          { objectKey: file.objectKey },
        ],
      },
      select: { id: true },
    });
    if (duplicate) {
      skipped += 1;
      continue;
    }

    await prisma.drawingLibraryFile.create({
      data: {
        libraryItemId: item.id,
        categoryId: file.categoryId,
        originalName: file.originalName,
        displayName: file.displayName,
        mimeType: file.mimeType,
        size: file.fileSize,
        version: file.version || 'V1.0',
        objectKey: file.objectKey,
        uploadedById: file.uploadedById,
        sourceResourceFileId: file.id,
        remark: file.remark,
      },
    });
    if (!file.workOrder.drawingLibraryItemId || file.workOrder.drawingLibraryItemId !== item.id) {
      await prisma.workOrder.update({ where: { id: file.workOrder.id }, data: { drawingLibraryItemId: item.id } });
    }
    createdFiles += 1;
  }

  console.log(`DrawingLibraryItems created: ${createdItems}`);
  console.log(`DrawingLibraryFiles created: ${createdFiles}`);
  console.log(`Skipped during execute: ${skipped}`);
  console.log('No ResourceFile, WorkOrder, ConnectorParameter or S3 object was deleted or overwritten.');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
