/** Synthetic people for this task's explicitly disposable, local database only. */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const target = new URL(process.env.DATABASE_URL || '');
if (process.env.HR_DIRECTORY_QA_ALLOW !== 'disposable-hr-runtime'
  || target.hostname !== '127.0.0.1' || target.port !== '55439'
  || !/^\/hongmeng_hr_v134139_(dev|release(?:_[a-z0-9]+)?)$/.test(target.pathname)) {
  throw new Error('HR fixtures require the dedicated loopback database and explicit disposable-runtime marker.');
}
const password = process.env.HR_DIRECTORY_QA_PASSWORD;
if (!password || password.length < 16) throw new Error('A dedicated HR test password is required.');
const db = new PrismaClient();
async function main() {
  const actor = await db.user.upsert({ where: { username: 'hrqa' },
    create: { username: 'hrqa', displayName: '人事验收', passwordHash: await bcrypt.hash(password!, 10),
      laborRole: 'ADMIN', mustChangePassword: false, accessGrants: { create: {
        profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:HR_QA', grantType: 'PRIMARY',
      } } }, update: { passwordHash: await bcrypt.hash(password!, 10), mustChangePassword: false } });
  const names = ['李明', '陈晓', '王宇', '赵宁', '周岚', '吴桐', '林悦', '许安', '孙禾', '郑远', '方可', '秦川'];
  const departments = ['生产部', '质量部', '技术部', '采购部'];
  for (let i = 0; i < 36; i++) {
    const inactive = i >= 32;
    const department = departments[i % departments.length];
    await db.employee.upsert({ where: { employeeNo: String(i + 1).padStart(4, '0') },
      create: { employeeNo: String(i + 1).padStart(4, '0'), name: names[i % names.length] + (i >= 12 ? ['甲', '乙'][Math.floor(i / 12) - 1] : ''),
        department, position: ['装配操作员', '质量检验员', '工艺工程师', '采购专员'][i % 4],
        team: ['装配一组', '检验组', '工艺组', '采购组'][i % 4], hireDate: i % 9 === 0 ? null : new Date('2025-03-17'),
        isActive: !inactive, attendanceEnabled: !inactive, attendanceGroup: 'UNASSIGNED',
        resignedAt: inactive ? new Date('2026-08-01') : null, resignationReason: inactive ? '验收离职档案' : null,
        attainmentStream: department === '生产部' ? 'batch' : 'excluded',
        attainmentFactorBasisPoints: department === '生产部' ? 10000 : 0,
      }, update: {} });
  }
  console.log(JSON.stringify({ ok: true, username: actor.username, syntheticEmployees: 36, productionDataTouched: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
