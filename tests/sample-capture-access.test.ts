import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';
import { canReadSampleLibrary } from '../lib/sample-library-access';
import { independentSampleCaptureRoute, sampleCaptureDraftKeys } from '../lib/sample-capture-access';

const grant = (profile: AccessGrant['profile'], scopeKey = 'GLOBAL'): AccessGrant => ({ profile, scopeKey, grantType: 'CONCURRENT', isActive: true });
const capture = grant('SAMPLE_CAPTURE_COLLABORATOR', 'MOBILE:SAMPLE_CAPTURE');
const productionRead = [grant('MODULE_ACCESS','MODULES:ON'), grant('MODULE_ACCESS','MODULE:production:READ'), grant('MODULE_ACCESS','MODULE:technology:COLLABORATE'), grant('MODULE_ACCESS','MODULE:collaboration:COLLABORATE')];
const operations = [
  ['GET', '/api/sample-tasks/code/qr'], ['GET','/api/sample-team/context?capture=1'],
  ['GET','/api/sample-tasks/task/sections'], ['GET','/api/sample-photos/photo/content'],
  ['PUT','/api/sample-tasks/task/sections/PROCESS_TIME'], ['PUT','/api/sample-tasks/task/sections/STRIPPING'],
  ['POST','/api/sample-tasks/task/entries'], ['PATCH','/api/sample-entries/entry'], ['DELETE','/api/sample-entries/entry'],
  ['POST','/api/sample-tasks/task/photos'], ['PATCH','/api/sample-photos/photo'], ['DELETE','/api/sample-photos/photo'],
  ['POST','/api/sample-tasks/task/submit'], ['POST','/api/sample-tasks/task/withdraw-submission'],
] as const;

test('0060 production-read conflict is resolved only by independent capture grant', () => {
  const before = resolveAccessContext(productionRead), after = resolveAccessContext([...productionRead,capture]);
  assert.equal(canAccessAppRoute(before,'/sample-capture/qr'),true);
  assert.equal(canAccessApiRoute(before,'/api/sample-tasks/task/photos','POST'),false);
  for (const [verb,path] of operations) assert.equal(canAccessApiRoute(after,path,verb),true,`${verb} ${path}`);
  assert.deepEqual(after.modulePermissions, before.modulePermissions);
  assert.deepEqual(after.capabilities,before.capabilities);
  for (const [verb,path] of [['POST','/api/sample-tasks'],['PATCH','/api/sample-tasks/task'],['POST','/api/sample-tasks/task/review'],['POST','/api/sample-tasks/import/commit'],['POST','/api/sample-tasks/schedule']]) assert.equal(canAccessApiRoute(after,path,verb),false,path);
});

test('capture-only with workbench off has no planning, people, publishing or library rights', () => {
  const access = resolveAccessContext([grant('MODULE_ACCESS','MODULES:OFF'),capture]);
  assert.equal(canAccessAppRoute(access,'/sample-capture/qr?tab=photos'),true);
  assert.equal(canReadSampleLibrary(access),false);
  for (const path of ['/weekly-plan-center','/drawing-library','/home','/workspace/employees']) assert.equal(canAccessAppRoute(access,path),false,path);
  for (const path of ['/api/sample-tasks/task/review','/api/sample-tasks/task/delete','/api/sample-tasks/task/documents','/api/sample-tasks/task/materials','/api/sample-team/import','/api/sample-photos/photo/display-settings','/api/users/module-access','/api/drawing-library/id/publish']) assert.equal(canAccessApiRoute(access,path,'POST'),false,path);
  for (const [verb,path] of operations) assert.equal(canAccessApiRoute(access,path,verb),true,`${verb} ${path}`);
});

test('reader and expired capture grant cannot write while legacy reporting remains unchanged', () => {
  const field = grant('FIELD_REPORTER','EMPLOYEE:0012');
  const before = resolveAccessContext([field]), after = resolveAccessContext([field,grant('SAMPLE_LIBRARY_READER')]);
  assert.equal(canReadSampleLibrary(after),true);
  assert.equal(canAccessApiRoute(before,'/api/field-report/submit','POST'),canAccessApiRoute(after,'/api/field-report/submit','POST'));
  const expired = resolveAccessContext([grant('MODULE_ACCESS','MODULES:OFF'),{...capture,effectiveTo:'2020-01-01'}]);
  assert.equal(canAccessApiRoute(expired,'/api/sample-tasks/task/photos','POST'),false);
  assert.equal(independentSampleCaptureRoute({sampleCaptureEnabled:true},'/api/sample-tasks/task/review','POST'),false);
  assert.equal(independentSampleCaptureRoute({sampleCaptureEnabled:true},'/api/sample-tasks/task/sections/UNKNOWN','PUT'),false);
});

test('local drafts are isolated by authenticated user and task with non-colliding encoded keys', () => {
  const keys = sampleCaptureDraftKeys('0060','qr');
  for (const value of Object.values(keys)) assert.ok(!Object.values(sampleCaptureDraftKeys('0012','qr')).includes(value));
  assert.notDeepEqual(keys,sampleCaptureDraftKeys('0060','other'));
  assert.notDeepEqual(sampleCaptureDraftKeys('a:task:b','c'),sampleCaptureDraftKeys('a','b:task:c'));
  assert.equal(new Set(Object.values(keys)).size,5);
});
