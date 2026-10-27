import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../lib/prisma';
import { otherWorkToday } from '../lib/other-work-time-service';

async function main() {
  assert.equal(process.env.OTHER_HOURS_QA_ALLOW, 'disposable-other-hours-batch');
  const db = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname) && ['/hongmeng_ci', '/hongmeng_sample_mirror'].includes(db.pathname), 'Only named disposable runtimes');
  const marker = 'OHBQA-' + randomUUID().slice(0, 8), today = otherWorkToday();
  const password = process.env.OTHER_HOURS_QA_PASSWORD || 'OtherFixture-' + randomUUID() + '!9';
  const passwordHash = await bcrypt.hash(password, 10);
  const team = await prisma.productionTeam.create({ data: { code: marker, name: '批量工时验收 ' + marker } });
  const accounts = [];
  for (let index = 0; index < 3; index++) {
    const employee = await prisma.employee.create({ data: { employeeNo: marker + '-' + index, name: ['验收张航', '验收曹俊南', '验收管理员'][index], team: team.name, department: '生产部', attendanceGroup: 'PRODUCTION', hireDate: new Date(today + 'T00:00:00Z') } });
    const user = await prisma.user.create({ data: { username: marker + '-' + index, displayName: employee.name, employeeId: employee.id, passwordHash, mustChangePassword: false,
      laborRole: index === 2 ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: { profile: index === 2 ? 'ADMIN_GLOBAL' : 'FIELD_REPORTER', scopeKey: index === 2 ? 'GLOBAL' : 'SELF', grantType: 'PRIMARY' } } } });
    accounts.push({ id: user.id, username: user.username, employeeId: employee.id, name: employee.name, employeeNo: employee.employeeNo });
    await prisma.attendanceRecord.create({ data: { employeeId: employee.id, workDate: new Date(today + 'T00:00:00Z'), status: 'confirmed', attendanceType: 'normal', plannedMilliseconds: 28800000, actualMilliseconds: 28800000,
      segments: [], departmentSnapshot: '生产部', teamSnapshot: team.name, attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch' } });
  }
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'auto', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  const bucket = process.env.S3_BUCKET!;
  try { await s3.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) { if (!(error instanceof Error) || !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error; }
  const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#ef6b00' } }).jpeg().toBuffer();
  const rows = [];
  for (let index = 0; index < 157; index++) {
    const objectKey = marker + '/evidence-' + index + '.jpg';
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: photo, ContentType: 'image/jpeg' }));
    const account = accounts[index === 156 ? 2 : index % 2];
    const row = await prisma.otherWorkTimeRequest.create({ data: { employeeId: account.employeeId, createdById: account.id,
      employeeNameSnapshot: account.name, employeeNoSnapshot: account.employeeNo, teamIdSnapshot: team.id, teamSnapshot: team.name,
      categoryId: 'other-sample', categoryNameSnapshot: '协助样品', workDate: new Date(today + 'T00:00:00Z'), requestedMinutes: 5, status: 'PENDING', submittedAt: new Date(),
      description: marker + ' 批量 ' + String(index).padStart(3, '0') + ' · 样品准备与工位协助', idempotencyKey: randomUUID(), requestHash: randomUUID(), attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch',
      attachments: { create: { objectKey, mimeType: 'image/jpeg', size: photo.length, originalName: '隔离验收照片.jpg', uploadedById: account.id, requestVersion: 0 } },
      reviews: { create: ['CREATE', 'UPLOAD_PHOTO', 'EDIT', 'SUBMIT'].map(action => ({ actorId: account.id, action, requestVersion: 0, detail: { description: '样品协助工作记录快照。'.repeat(30), requestedMinutes: 5, attachments: [objectKey] } })) },
    }, include: { attachments: true } });
    rows.push({ id: row.id, version: row.version, employeeId: row.employeeId, attachmentId: row.attachments[0].id });
  }
  const path = process.env.OTHER_HOURS_QA_FIXTURE || '.local/other-hours-batch-fixture.json';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ marker, search: marker + ' 批量', today, accounts, password, rows: rows.slice(0, 156), own: rows[156], count: 156 }));
  console.log('Created 156 eligible requests and one self-review exclusion in the isolated runtime: ' + marker);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
