import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

loadEnvFile();
const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');
const confirmed = process.env.CONFIRM_CLEAR_WORKORDER_DATA === 'YES';
const deleteS3Objects = process.env.DELETE_S3_OBJECTS === 'true';

const workOrderTargetTypes = [
  'WorkOrder',
  'workOrder',
  'work_order',
  'ResourceFile',
  'resourceFile',
  'resource_file',
];

const workOrderActions = [
  'create_work_order',
  'update_work_order',
  'update_work_order_customer',
  'update_work_order_status',
  'update_work_order_priority',
  'update_work_order_planned_at',
  'delete_work_order',
  'restore_work_order',
  'upload',
  'upload_retry',
  'upload_failed',
  'delete',
  'delete_resource_file',
  'restore_resource_file',
  'update_resource_file',
  'move_resource_file',
  'download',
  'download_work_order_package',
];

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

function boolEnv(value) {
  return value === 'true' || value === '1';
}

function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey || !process.env.S3_BUCKET) {
    throw new Error('S3 deletion requested but S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing.');
  }

  return new S3Client({
    endpoint,
    region,
    forcePathStyle: boolEnv(process.env.S3_FORCE_PATH_STYLE),
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function deleteS3Keys(objectKeys) {
  if (!deleteS3Objects || objectKeys.length === 0) return { deleted: 0, failed: 0 };

  const bucket = process.env.S3_BUCKET;
  const client = createS3Client();
  let deleted = 0;
  let failed = 0;

  for (const key of objectKeys) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(`[S3 DELETE FAILED] key=${key} message=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { deleted, failed };
}

async function main() {
  const [workOrders, resourceFiles, connectorParameters, connectorFiles, connectorBatches] = await Promise.all([
    prisma.workOrder.count(),
    prisma.resourceFile.findMany({ select: { id: true, objectKey: true } }),
    prisma.connectorParameter.count(),
    prisma.connectorParameterFile.count(),
    prisma.connectorParameterImportBatch.count(),
  ]);

  const objectKeys = Array.from(new Set(resourceFiles.map(file => file.objectKey).filter(Boolean)));
  const logWhere = {
    OR: [
      { targetType: { in: workOrderTargetTypes } },
      { action: { in: workOrderActions } },
    ],
  };
  const snapshotWhere = {
    entityType: { in: workOrderTargetTypes },
  };
  const [operationLogs, snapshots] = await Promise.all([
    prisma.operationLog.count({ where: logWhere }),
    prisma.dataChangeSnapshot.count({ where: snapshotWhere }),
  ]);

  console.log('Work order data cleanup plan');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`WorkOrders: ${workOrders}`);
  console.log(`ResourceFiles: ${resourceFiles.length}`);
  console.log(`ResourceFile objectKeys: ${objectKeys.length}`);
  console.log(`OperationLogs scoped to work-order data: ${operationLogs}`);
  console.log(`DataChangeSnapshots scoped to work-order data: ${snapshots}`);
  console.log(`ConnectorParameters retained: ${connectorParameters}`);
  console.log(`ConnectorParameterFiles retained: ${connectorFiles}`);
  console.log(`ConnectorParameterImportBatches retained: ${connectorBatches}`);

  if (!execute) {
    console.log('DRY RUN ONLY: no database rows or S3 objects were deleted.');
    console.log('To execute locally, run npm run data:clear-workorders with CONFIRM_CLEAR_WORKORDER_DATA=YES.');
    return;
  }

  if (!confirmed) {
    console.error('Refusing to delete data. Set CONFIRM_CLEAR_WORKORDER_DATA=YES to execute.');
    process.exitCode = 1;
    return;
  }

  const s3Result = await deleteS3Keys(objectKeys);
  if (s3Result.failed > 0) {
    console.error(`Refusing to delete database rows because ${s3Result.failed} S3 object deletions failed.`);
    process.exitCode = 1;
    return;
  }

  const [deletedLogs, deletedSnapshots, deletedFiles, deletedOrders] = await prisma.$transaction([
    prisma.operationLog.deleteMany({ where: logWhere }),
    prisma.dataChangeSnapshot.deleteMany({ where: snapshotWhere }),
    prisma.resourceFile.deleteMany({}),
    prisma.workOrder.deleteMany({}),
  ]);

  console.log(`S3 objects deleted: ${s3Result.deleted}`);
  console.log(`OperationLogs deleted: ${deletedLogs.count}`);
  console.log(`DataChangeSnapshots deleted: ${deletedSnapshots.count}`);
  console.log(`ResourceFiles deleted: ${deletedFiles.count}`);
  console.log(`WorkOrders deleted: ${deletedOrders.count}`);
  console.log('Connector parameter data was not modified.');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
