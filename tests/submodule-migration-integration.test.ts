import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { BUSINESS_SUBMODULES } from '../lib/submodule-catalog';

test('upgrade preserves parent access dates, freezes children and honors existing narrower grants', {skip:process.env.RUN_DB_INTEGRATION!=='1'}, async()=>{
 const url=new URL(process.env.DATABASE_URL!); assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.ok(['/access264','/hongmeng_ci'].includes(url.pathname));
 const tag='MIGRATION-'+randomUUID();
 const users=await Promise.all([0,1].map(i=>prisma.user.create({data:{username:tag+i,displayName:tag,passwordHash:'not-a-login'}})));
 const from=new Date('2027-01-01'),to=new Date('2027-12-31');
 try {
  await prisma.userAccessGrant.createMany({data:[
   {userId:users[0].id,profile:'MODULE_ACCESS',scopeKey:'MODULES:ON',grantType:'PRIMARY'},
   {userId:users[0].id,profile:'MODULE_ACCESS',scopeKey:'MODULE:materials:COLLABORATE',grantType:'CONCURRENT',effectiveFrom:from,effectiveTo:to},
   {userId:users[1].id,profile:'MODULE_ACCESS',scopeKey:'MODULE:materials:COLLABORATE',grantType:'PRIMARY'},
   {userId:users[1].id,profile:'MODULE_ACCESS',scopeKey:'MODULE:warehouse:READ',grantType:'CONCURRENT'},
  ]});
  const sql=readFileSync(new URL('../prisma/migrations/20261009150000_submodule_approval_handoff/migration.sql',import.meta.url),'utf8').split('-- Freeze each active parent grant')[1];
  const statements=(' -- Freeze each active parent grant'+sql).split(';').map(s=>s.trim()).filter(Boolean);
  await prisma.$transaction(async tx=>{for(const statement of statements)await tx.$executeRawUnsafe(statement);});
  const grants=await prisma.userAccessGrant.findMany({where:{userId:users[0].id,isActive:true,scopeKey:{startsWith:'MODULE:'}}});
  assert.equal(grants.length,BUSINESS_SUBMODULES.filter(s=>s.group==='materials').length);
  for(const grant of grants){assert.equal(grant.effectiveFrom.toISOString(),from.toISOString());assert.equal(grant.effectiveTo?.toISOString(),to.toISOString());assert.ok(grant.scopeKey.endsWith(':COLLABORATE'));}
  const narrow=await prisma.userAccessGrant.findMany({where:{userId:users[1].id,isActive:true}});assert.deepEqual(narrow.map(g=>g.scopeKey),['MODULE:warehouse:READ']);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:users[0].id}})).sessionVersion,1);
 } finally {await prisma.userAccessGrant.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});await prisma.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});await prisma.$disconnect();}
});
