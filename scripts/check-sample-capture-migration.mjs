import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
assert.equal(process.env.SAMPLE_LIBRARY_QA_ALLOW, 'disposable-sample-library');
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Loopback disposable database required');
const db = new PrismaClient();
const sql = readFileSync('prisma/migrations/20260928101000_authorize_sample_capture_0060/migration.sql','utf8');
try {
  for (const scenario of ['exact','already-granted','name-mismatch','department-mismatch','number-mismatch','username-mismatch','disabled','field-only','admin','absent']) {
    await db.$transaction(async tx => {
      for (const statement of [
        `CREATE TEMP TABLE departments (id text,code text,is_active boolean) ON COMMIT DROP`,
        `CREATE TEMP TABLE employees (id text,employee_no text,name text,department_id text,is_active boolean) ON COMMIT DROP`,
        `CREATE TEMP TABLE users (id text,username text,employee_id text,is_active boolean,account_status text,field_password_only boolean,labor_role text,session_version integer,updated_at timestamp) ON COMMIT DROP`,
        `CREATE TEMP TABLE user_access_grants (id text,user_id text,profile_key access_profile_key,scope_key text,grant_type access_grant_type,effective_from timestamp,effective_to timestamp,is_active boolean,version integer,created_at timestamp,updated_at timestamp) ON COMMIT DROP`,
        `CREATE TEMP TABLE operation_logs (id text,user_id text,action text,target_type text,target_id text,detail jsonb,created_at timestamp) ON COMMIT DROP`,
      ]) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(`INSERT INTO departments VALUES ('dept',$1,true)`,scenario==='department-mismatch'?'PRODUCTION':'ENGINEERING');
      await tx.$executeRawUnsafe(`INSERT INTO employees VALUES ('employee',$1,$2,'dept',true)`,scenario==='number-mismatch'?'0061':'0060',scenario==='name-mismatch'?'周讯':'周迅');
      if(scenario!=='absent') await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('target',$1,'employee',$2,'ACTIVE',$3,$4,3,now())`,scenario==='username-mismatch'?'other':'0060',scenario!=='disabled',scenario==='field-only',scenario==='admin'?'ADMIN':'EMPLOYEE');
      await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('other','other',null,true,'ACTIVE',false,'EMPLOYEE',1,now())`);
      await tx.$executeRawUnsafe(`INSERT INTO user_access_grants VALUES ('original','target','MODULE_ACCESS','MODULE:production:READ','PRIMARY',now(),null,true,0,now(),now())`);
      if(scenario==='already-granted') await tx.$executeRawUnsafe(`INSERT INTO user_access_grants VALUES ('capture','target','SAMPLE_CAPTURE_COLLABORATOR','MOBILE:SAMPLE_CAPTURE','CONCURRENT',now(),null,true,0,now(),now())`);
      await tx.$executeRawUnsafe(sql);
      const grants=await tx.$queryRawUnsafe(`SELECT * FROM user_access_grants ORDER BY id`);
      const expected=['exact','already-granted'].includes(scenario);
      assert.equal(grants.filter(g=>g.profile_key==='SAMPLE_CAPTURE_COLLABORATOR').length,expected?1:0,scenario);
      assert.ok(grants.some(g=>g.id==='original'&&g.is_active&&g.scope_key==='MODULE:production:READ'),'Existing READ grant unchanged');
      assert.equal(grants.filter(g=>g.user_id==='other').length,0,'Other employee untouched');
      if(expected){
        await tx.$executeRawUnsafe(sql);
        assert.deepEqual(await tx.$queryRawUnsafe(`SELECT * FROM user_access_grants ORDER BY id`),grants,'Replay idempotent');
        assert.equal((await tx.$queryRawUnsafe(`SELECT session_version FROM users WHERE id='target'`))[0].session_version,4);
        assert.equal((await tx.$queryRawUnsafe(`SELECT count(*)::integer n FROM operation_logs`))[0].n,1);
        await tx.$executeRawUnsafe(`UPDATE user_access_grants SET is_active=false WHERE profile_key='SAMPLE_CAPTURE_COLLABORATOR'`);
        await tx.$executeRawUnsafe(sql);
        assert.equal((await tx.$queryRawUnsafe(`SELECT count(*)::integer n FROM user_access_grants WHERE profile_key='SAMPLE_CAPTURE_COLLABORATOR' AND is_active`))[0].n,0,'Later revocation respected');
      }
      console.log('Targeted sample capture migration:',scenario,'passed');
    },{timeout:30000});
  }
} finally {await db.$disconnect();}
