import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
assert.equal(process.env.ACCOUNT_ACCESS_QA_ALLOW, 'disposable-account-access');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Disposable loopback database only');
const db = new PrismaClient();
const sql = readFileSync('prisma/migrations/20260924121000_authorize_hr_employee_0022/migration.sql', 'utf8');
const cases = ['modules', 'legacy', 'name-mismatch', 'department-mismatch', 'number-mismatch', 'disabled', 'field-only', 'admin', 'absent'];
try {
  for (const scenario of cases) await db.$transaction(async tx => {
    // Temp tables shadow production names within this transaction. No application rows are touched.
    for (const statement of [
      `CREATE TEMP TABLE departments (id text,code text,is_active boolean) ON COMMIT DROP`,
      `CREATE TEMP TABLE employees (id text,employee_no text,name text,department_id text,is_active boolean) ON COMMIT DROP`,
      `CREATE TEMP TABLE users (id text,employee_id text,is_active boolean,account_status text,field_password_only boolean,labor_role text,session_version integer,updated_at timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE user_access_grants (id text,user_id text,profile_key access_profile_key,scope_key text,department_id text,grant_type access_grant_type,effective_from timestamp,effective_to timestamp,is_active boolean,version integer,created_at timestamp,updated_at timestamp) ON COMMIT DROP`,
      `CREATE TEMP TABLE operation_logs (id text,user_id text,action text,target_type text,target_id text,detail jsonb,created_at timestamp) ON COMMIT DROP`,
    ]) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe(`INSERT INTO departments VALUES ('hr',$1,true)`, scenario === 'department-mismatch' ? 'BUSINESS' : 'HR');
    await tx.$executeRawUnsafe(`INSERT INTO employees VALUES ('employee',$1,$2,'hr',true),('other','0099','Other','hr',true)`, scenario === 'number-mismatch' ? '0023' : '0022', scenario === 'name-mismatch' ? 'Other' : '潘丹丹');
    if (scenario !== 'absent') await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('target','employee',$1,'ACTIVE',$2,$3,3,now())`, scenario !== 'disabled', scenario === 'field-only', scenario === 'admin' ? 'ADMIN' : 'EMPLOYEE');
    await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('other','other',true,'ACTIVE',false,'EMPLOYEE',1,now())`);
    await tx.$executeRawUnsafe(`INSERT INTO user_access_grants VALUES ('original','target',$1::access_profile_key,$2,'hr','PRIMARY',now(),null,true,0,now(),now())`, scenario === 'modules' ? 'MODULE_ACCESS' : 'DEPARTMENT_FULL', scenario === 'modules' ? 'MODULE:quality:READ' : 'DEPARTMENT:HR');
    await tx.$executeRawUnsafe(sql);
    const grants = await tx.$queryRawUnsafe(`SELECT * FROM user_access_grants`);
    const flags = grants.filter(g => g.profile_key === 'EMPLOYEE_ACCESS_MANAGER');
    const expected = ['modules', 'legacy'].includes(scenario);
    assert.equal(flags.length, expected ? 1 : 0, scenario);
    assert.ok(grants.some(g => g.id === 'original' && g.is_active), 'Original permission preserved');
    assert.equal(grants.filter(g => g.user_id === 'other').length, 0, 'Other employee unchanged');
    if (expected) {
      const before = JSON.stringify(grants);
      await tx.$executeRawUnsafe(sql);
      assert.equal(JSON.stringify(await tx.$queryRawUnsafe(`SELECT * FROM user_access_grants`)), before, 'Replay is idempotent');
      assert.equal((await tx.$queryRawUnsafe(`SELECT session_version FROM users WHERE id='target'`))[0].session_version, 4);
      assert.equal((await tx.$queryRawUnsafe(`SELECT count(*)::integer AS n FROM operation_logs`))[0].n, 1);
      // A later admin revocation is not reversed by replay.
      await tx.$executeRawUnsafe(`UPDATE user_access_grants SET is_active=false WHERE profile_key='EMPLOYEE_ACCESS_MANAGER'`);
      await tx.$executeRawUnsafe(sql);
      assert.equal((await tx.$queryRawUnsafe(`SELECT count(*)::integer AS n FROM user_access_grants WHERE profile_key='EMPLOYEE_ACCESS_MANAGER' AND is_active`))[0].n, 0);
      if (scenario === 'modules') assert.ok(grants.some(g => g.scope_key === 'MODULE:people:COLLABORATE') && grants.some(g => g.scope_key === 'MODULES:ON'));
    }
    console.log('Targeted HR migration:', scenario, 'passed');
  }, { timeout: 30000 });
} finally { await db.$disconnect(); }
