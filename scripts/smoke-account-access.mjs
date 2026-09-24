import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
assert.equal(process.env.ACCOUNT_ACCESS_QA_ALLOW, 'disposable-account-access');
const base = process.env.ACCOUNT_ACCESS_QA_BASE || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback only');
const tag = 'ACL-' + randomUUID().slice(0, 8), checks = [];
const initial = 'Codex-ACL-Start-2026!Z', password = 'Codex-ACL-Changed-2026!R';
let cookie = '';
async function req(label, url, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + url, { method, headers: { Cookie: cookie, Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const data = await response.json();
  assert.equal(response.status, expected, `${label}: ${JSON.stringify(data).slice(0, 600)}`);
  if (url === '/api/auth/login') cookie = response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
  checks.push({ label, status: response.status });
  return data;
}
const login = (username, pass) => req('login disposable account', '/api/auth/login', { username, password: pass });
const allModules = ['production', 'quality', 'materials', 'technology', 'people', 'collaboration', 'reports'];
const allRead = Object.fromEntries(allModules.map(key => [key, 'READ']));
await req('module settings require authentication', '/api/users/module-access', {}, 401);
if (process.env.ACCOUNT_INITIAL_PASSWORD) {
  await login(process.env.SEED_ADMIN_USERNAME, process.env.ACCOUNT_INITIAL_PASSWORD);
  await req('initialize isolated seed password', '/api/auth/change-password', { currentPassword: process.env.ACCOUNT_INITIAL_PASSWORD, newPassword: process.env.SMOKE_ADMIN_CHANGED_PASSWORD, confirmPassword: process.env.SMOKE_ADMIN_CHANGED_PASSWORD });
}
await login(process.env.SEED_ADMIN_USERNAME, process.env.SMOKE_ADMIN_CHANGED_PASSWORD);
const adminCookie = cookie;
const admin = (await req('load administrator', '/api/me')).user;
const catalog = await req('load account and department catalog', '/api/users');
const departmentId = catalog.departments.find(dept => dept.code === 'HR')?.id;
assert.ok(departmentId);
const createEmployee = async label => (await req('create isolated employee ' + label, '/api/employees', { name: tag + '-' + label, departmentId }, 201)).employee;
const createAccount = async (label, modulePermissions) => {
  const employee = await createEmployee(label);
  const result = await req('save new module account ' + label, '/api/users/module-access', { employeeId: employee.id, username: employee.employeeNo, displayName: employee.name, password: initial, accountStatus: 'ACTIVE', modulePermissions, workbenchEnabled: true, fieldReportEnabled: false });
  assert.deepEqual(result.user.moduleAccess.permissions, modulePermissions);
  return { ...result.user, employee };
};
const reader = await createAccount('只读验收', allRead);
const mixed = await createAccount('混合权限验收', { materials: 'COLLABORATE', technology: 'READ' });
const hr = await createAccount('人事协同验收', { people: 'COLLABORATE' });
const legacyEmployee = await createEmployee('旧账号验收');
const legacy = (await req('create legacy department account', '/api/users', { employeeId: legacyEmployee.id, username: legacyEmployee.employeeNo, displayName: legacyEmployee.name, password: initial, mustChangePassword: false, profileKey: 'DEPARTMENT_FULL', departmentId }, 201)).user;
assert.equal(legacy.moduleAccess, null);
const saveBody = (account, permissions) => ({ id: account.id, employeeId: account.employeeId, displayName: account.displayName, accountStatus: 'ACTIVE', modulePermissions: permissions, workbenchEnabled: true, fieldReportEnabled: false, expectedUpdatedAt: account.updatedAt });
await req('administrator cannot remove own management access', '/api/users/module-access', saveBody(admin, { people: 'READ' }), 403);
for (const account of [reader, mixed, hr]) {
  await login(account.username, initial);
  await req('first login changes independent password', '/api/auth/change-password', { currentPassword: initial, newPassword: password, confirmPassword: password });
  await login(account.username, password);
  account.cookie = cookie;
  const me = (await req('reload effective module permissions', '/api/me')).user;
  assert.deepEqual(me.access.modulePermissions, account.moduleAccess.permissions);
  assert.equal(me.access.capabilities.some(cap => cap.startsWith('ACCOUNT_ADMIN:')), false);
}
cookie = reader.cookie;
for (const url of ['/api/sample-tasks?view=ALL&summary=true', '/api/quality-fixtures?summary=1', '/api/material-follow-ups', '/api/drawing-library', '/api/employees', '/api/other-work-times?scope=manage', '/api/reports/overview', '/api/knowledge/search']) await req('read selected module ' + url, url);
for (const [url, method] of [['/api/sample-tasks', 'POST'], ['/api/quality-fixtures', 'POST'], ['/api/material-follow-ups/missing', 'PATCH'], ['/api/drawing-library/missing/files/upload', 'POST'], ['/api/employees', 'POST'], ['/api/changes', 'POST'], ['/api/knowledge/articles', 'POST'], ['/api/users/module-access', 'POST']]) await req('read-only direct mutation blocked ' + url, url, {}, 403, method);
cookie = mixed.cookie;
await req('mixed account can read technology', '/api/knowledge/search');
await req('mixed technology remains read-only', '/api/knowledge/articles', {}, 403);
await req('materials grant cannot access employee directory', '/api/employees', undefined, 403);
cookie = hr.cookie;
await req('HR collaborator maintains employee records', '/api/employees', { name: tag + '-协同新增', departmentId }, 201);
await req('HR collaborator sees ordinary account list', '/api/users');
await req('HR collaborator cannot grant modules', '/api/users/module-access', saveBody(reader, { people: 'COLLABORATE' }), 403);
await req('HR collaborator cannot elevate through legacy endpoint', '/api/users/' + reader.id, { laborRole: 'ADMIN' }, 403, 'PATCH');
cookie = adminCookie;
const freshReader = (await req('reload account version after logins', '/api/users')).users.find(user => user.id === reader.id);
const changed = (await req('atomic read-only permission update', '/api/users/module-access', saveBody(freshReader, { materials: 'READ' }))).user;
await req('stale editor is rejected without overwriting', '/api/users/module-access', saveBody(freshReader, { people: 'COLLABORATE' }), 409);
const confirmed = (await req('verify stale save changed nothing', '/api/users')).users.find(user => user.id === reader.id);
assert.deepEqual(confirmed.moduleAccess.permissions, { materials: 'READ' });
cookie = reader.cookie;
await req('permission update invalidates previous session', '/api/me', undefined, 403);
cookie = adminCookie;
await req('restore reader fixture for UI', '/api/users/module-access', saveBody(changed, allRead));
const migrated = (await req('migrate legacy account by explicit save', '/api/users/module-access', saveBody(legacy, { people: 'READ' }))).user;
assert.ok(migrated.accessGrants.filter(grant => grant.isActive).every(grant => grant.profileKey === 'MODULE_ACCESS'));
await login(legacy.username, initial);
const migratedMe = (await req('legacy write is absent after migration', '/api/me')).user;
assert.ok(!migratedMe.access.capabilities.includes('HR:UPDATE'));
await req('legacy endpoint cannot preserve former write power', '/api/employees', { name: tag + '-forbidden' }, 403);
cookie = adminCookie;


// Explicitly delegated HR management uses the same atomic endpoint, without global role grants.
cookie = adminCookie;
const delegate = await createAccount('人事授权验收', { people: 'COLLABORATE' });
const secondManager = await createAccount('受保护授权人员', { people: 'COLLABORATE' });
const enableManager = async account => (await req('administrator enables delegated HR account manager', '/api/users/module-access', { ...saveBody(account,{people:'COLLABORATE'}), employeeAccountManager:true })).user;
await enableManager(delegate); await enableManager(secondManager);
const ordinary = await createAccount('业务授权对象', { technology:'READ' });
const preserveEmployee=await createEmployee('保留旧授权');
const preserveLegacy=(await req('create actual legacy preserve fixture','/api/users',{employeeId:preserveEmployee.id,username:preserveEmployee.employeeNo,displayName:preserveEmployee.name,password:initial,mustChangePassword:false,profileKey:'DEPARTMENT_FULL',departmentId},201)).user;

await login(delegate.username,initial);
await req('delegated manager changes initial password','/api/auth/change-password',{currentPassword:initial,newPassword:password,confirmPassword:password});
await login(delegate.username,password); const delegateCookie=cookie;
const delegatedMe=(await req('delegated effective access','/api/me')).user;
assert.equal(delegatedMe.access.employeeAccountManager,true);
assert.equal(delegatedMe.access.capabilities.includes('ACCOUNT_ADMIN:MANAGE'),false);
const delegatedList=await req('delegated manager sees manageable employees','/api/users');
assert.equal(delegatedList.canManagePermissions,true);
assert.ok(!delegatedList.users.some(u=>[admin.id,delegate.id,secondManager.id].includes(u.id)));
const delegatedChange=(await req('HR grants multiple business modules and mobile access atomically','/api/users/module-access',{...saveBody(ordinary,{technology:'COLLABORATE',quality:'READ'}),sampleLibraryEnabled:true})).user;
assert.deepEqual(delegatedChange.moduleAccess.permissions,{technology:'COLLABORATE',quality:'READ'});
assert.equal(delegatedChange.accessMethods.sampleLibrary,true);
await req('HR stale save cannot overwrite','/api/users/module-access',{...saveBody(ordinary,{people:'COLLABORATE'})},409);
for(const protectedUser of [admin,delegate,secondManager]){
 await req('HR cannot change protected account modules','/api/users/module-access',saveBody(protectedUser,{people:'COLLABORATE'}),403);
 await req('HR cannot reset protected password','/api/users/'+protectedUser.id+'/reset-password',{password:initial},403);
 await req('HR cannot disable protected account','/api/users/'+protectedUser.id,{accountStatus:'DISABLED'},403,'PATCH');
 await req('HR cannot change protected mobile grants','/api/users/sample-library-access',{id:protectedUser.id,enabled:true,expectedUpdatedAt:protectedUser.updatedAt},403);
}
await req('HR cannot pass on delegation flag','/api/users/module-access',{...saveBody(delegatedChange,{people:'COLLABORATE'}),employeeAccountManager:true},403);
await req('HR cannot grant administrator through legacy API','/api/users/'+ordinary.id+'/access-grants',{profileKey:'ADMIN_GLOBAL'},403);
await req('HR cannot rebind employee identity','/api/users/module-access',{...saveBody(delegatedChange,{technology:'READ'}),employeeId:delegate.employeeId},400);
const invalid={...saveBody(delegatedChange,{technology:'READ'}),displayName:'SHOULD NOT SAVE',sampleLibraryEnabled:false,password:'weak'};
await req('invalid password rolls back whole configuration','/api/users/module-access',invalid,400);
const unchanged=(await req('rollback preserves name permissions and access','/api/users')).users.find(u=>u.id===ordinary.id);
assert.equal(unchanged.displayName,ordinary.displayName);assert.equal(unchanged.accessMethods.sampleLibrary,true);assert.deepEqual(unchanged.moduleAccess.permissions,delegatedChange.moduleAccess.permissions);
const newEmployee=await createEmployee('人事开通员工');
const byHr=(await req('HR creates employee module account','/api/users/module-access',{employeeId:newEmployee.id,displayName:newEmployee.name,username:newEmployee.employeeNo,password:initial,modulePermissions:{quality:'READ'},workbenchEnabled:true,fieldReportEnabled:false,sampleLibraryEnabled:true})).user;
assert.equal(byHr.laborRole,'EMPLOYEE');
const legacyNow=(await req('HR load current legacy account','/api/users')).users.find(u=>u.id===preserveLegacy.id);
const grantIds=legacyNow.accessGrants.filter(g=>g.isActive).map(g=>g.id).sort();
const legacySaved=(await req('legacy account settings preserve grants in single transaction','/api/users/module-access',{id:preserveLegacy.id,displayName:preserveLegacy.displayName,accountStatus:'ACTIVE',preserveBusinessGrants:true,sampleLibraryEnabled:true,password:password,expectedUpdatedAt:legacyNow.updatedAt})).user;
assert.deepEqual(legacySaved.accessGrants.filter(g=>g.isActive&&g.profileKey!=='SAMPLE_LIBRARY_READER').map(g=>g.id).sort(),grantIds);
const {PrismaClient}=await import('@prisma/client');const auditDb=new PrismaClient();
try { const log=await auditDb.operationLog.findFirst({where:{userId:delegate.id,targetId:ordinary.id,action:'ACCOUNT_MODULE_ACCESS_UPDATED'},orderBy:{createdAt:'desc'}});assert.equal(log.detail.delegated,true);assert.deepEqual(log.detail.after.permissions,{technology:'COLLABORATE',quality:'READ'});checks.push({label:'authorization audit contains actor and saved permissions'}); } finally {await auditDb.$disconnect();}
cookie=adminCookie;
const delegateNow=(await req('admin load delegate version','/api/users')).users.find(u=>u.id===delegate.id);
const disabledDelegate=(await req('administrator revokes delegated management','/api/users/module-access',{...saveBody(delegateNow,{people:'COLLABORATE'}),employeeAccountManager:false})).user;
cookie=delegateCookie;
await req('delegation revocation invalidates current session','/api/users',undefined,403);
await login(delegate.username,password);
await req('revoked HR retains lifecycle but cannot grant modules','/api/users/module-access',saveBody(byHr,{quality:'COLLABORATE'}),403);
cookie=adminCookie;
await enableManager((await req('reload delegate after login before restoring UI fixture','/api/users')).users.find(u=>u.id===delegate.id));

const output = process.env.ACCOUNT_ACCESS_QA_OUTPUT || 'artifacts/account-access/http.json';
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ ok: true, tag, base, checks }, null, 2));
const fixture = process.env.ACCOUNT_ACCESS_FIXTURE || '/tmp/account-access-fixture.json';
await fs.mkdir(path.dirname(fixture), { recursive: true });
await fs.writeFile(fixture, JSON.stringify({ marker: tag, username: process.env.SEED_ADMIN_USERNAME, password: process.env.SMOKE_ADMIN_CHANGED_PASSWORD, reader: { id: reader.id, username: reader.username, name: reader.displayName, password }, mixed: { id: mixed.id, employeeId: mixed.employeeId, name: mixed.displayName }, hr: { username: hr.username, password }, delegate: {username:delegate.username,name:delegate.displayName,password}, ordinary:{id:ordinary.id,name:ordinary.displayName} }));
console.log(`Account access HTTP acceptance: ${checks.length} checks passed`);
