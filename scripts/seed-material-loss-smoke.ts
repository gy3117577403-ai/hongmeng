import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { prisma } from '../lib/prisma';
import { s3, bucket } from '../lib/s3';
import { ensureSampleWarehouse } from '../lib/sample-plan-operations';
import { reportSampleShortages } from '../lib/material-exception-service';
async function main() {
  const db = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
  if (process.env.MATERIAL_LOSS_QA_ALLOW !== 'disposable-material-loss-runtime' || !['localhost', '127.0.0.1'].includes(db.hostname) || !/(?:_ci|_test|_mirror)$/.test(db.pathname)) throw Error('Disposable local acceptance database required');
  const marker = 'MLQ-' + randomUUID().slice(0, 8), password = randomBytes(20).toString('hex') + 'Aa9!', passwordHash = await bcrypt.hash(password, 10);
  const users: Record<string, { id: string; username: string; name: string }> = {};
  for (const [name, grants] of Object.entries({ reporter: ['material-loss-report:COLLABORATE', 'warehouse:COLLABORATE', 'material-follow-up:COLLABORATE', 'messages:READ'], reviewer: ['material-loss-approval:COLLABORATE', 'messages:READ'], reader: ['material-loss-report:READ'], admin: [] })) {
    const user = await prisma.user.create({ data: { username: marker + '-' + name, displayName: '隔离验收-' + name, passwordHash, mustChangePassword: false, laborRole: name === 'admin' ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: name === 'admin' ? [{ profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:' + marker }] : [{ profile: 'MODULE_ACCESS', scopeKey: 'MODULES:ON' }, ...grants.map(key => ({ profile: 'MODULE_ACCESS' as const, scopeKey: 'MODULE:' + key, grantType: 'CONCURRENT' as const }))] } } });
    if(name==='reporter'){const employee=await prisma.employee.create({data:{employeeNo:marker+'-WH',name:marker+'损耗申报员',attendanceEnabled:false,attainmentEligible:false}});await prisma.user.update({where:{id:user.id},data:{employeeId:employee.id}});}
    users[name] = { id: user.id, username: user.username, name: name==='reporter'?marker+'损耗申报员':user.displayName };
  }
  const item = await prisma.drawingLibraryItem.create({ data: { libraryKey: marker, specification: marker + '-SAMPLE', customerName: '测试客户', productName: '验收连接线' } });
  const sample = await prisma.sampleTask.create({ data: { code: marker, qrCode: marker, drawingLibraryItemId: item.id, customerNameSnapshot: 'Thu Oct 29 2026 00:00:00 GMT+0000 (Coordinated Universal Time)', specificationSnapshot: marker + '-SAMPLE', productNameSnapshot: '验收连接线', sampleQuantity: 3, taskType: 'REPEAT', dueDate: new Date('2026-11-20'), createdById: users.reporter.id, createdByName: '隔离验收-reporter' } });
  const warehouse = await prisma.$transaction(tx => ensureSampleWarehouse(tx, sample));
  if (!warehouse) throw Error('Sample warehouse fixture missing');
  await reportSampleShortages(sample.id, { version: warehouse.version, shortages: [{ materialModel: marker + '-客供连接器', supplySource: 'CUSTOMER', shortageQuantity: 3, unit: '个' }] }, users.reporter.id, true);
  try { await s3().send(new HeadBucketCommand({ Bucket: bucket() })); } catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw e; await s3().send(new CreateBucketCommand({ Bucket: bucket() })); }
  const file = process.env.MATERIAL_LOSS_FIXTURE || '.local/material-loss-fixture.json'; mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ marker, password, users, sampleId: sample.id, warehouseId: warehouse.id }));
  console.log('Created disposable material loss and sample acceptance fixtures:', marker);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
