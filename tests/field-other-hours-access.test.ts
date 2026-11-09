import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';
import { canReadOtherWork, canReviewOtherWork } from '../lib/other-work-time-access';
import { UnauthorizedError } from '../lib/auth';
import { otherWorkErrorResponse } from '../lib/other-work-time-http';
test('configured field employee can submit and read self without gaining review or unrelated access', () => {
  const access = resolveAccessContext([{profile:'MODULE_ACCESS',grantType:'PRIMARY',scopeKey:'MODULES:OFF'}, {profile:'FIELD_REPORTER',grantType:'CONCURRENT',scopeKey:'EMPLOYEE:e'}]);
  const actor = {id:'u',employeeId:'e',displayName:'Employee',username:'e',laborRole:'EMPLOYEE' as const,dailyPlanningTeamIds:[],access};
  const own = {createdById:'u',employeeId:'e',teamIdSnapshot:null,teamSnapshot:null};
  const other = {...own,createdById:'v',employeeId:'f'};
  assert.equal(canAccessAppRoute(access,'/field-report/other-hours'),true);
  for(const method of ['GET','POST','PATCH']) assert.equal(canAccessApiRoute(access,'/api/other-work-times/record',method),true);
  assert.equal(canReadOtherWork(actor,own),true);
  assert.equal(canReadOtherWork(actor,other),false);
  assert.equal(canReviewOtherWork(actor,other),false);
  assert.equal(canAccessApiRoute(access,'/api/purchases','POST'),false);
  assert.equal(canAccessApiRoute(access,'/api/material-loss','POST'),false);
  assert.equal(canAccessApiRoute(resolveAccessContext([{profile:'MODULE_ACCESS',grantType:'PRIMARY',scopeKey:'MODULES:OFF'}]),'/api/other-work-times','POST'),false);
});
test('other-hours distinguishes expired login, forced password change and permission denial', async () => {
  for(const error of [new UnauthorizedError(),new UnauthorizedError('需要改密',403,'PASSWORD_CHANGE_REQUIRED'),new UnauthorizedError('没有权限',403)]) {
    const response=otherWorkErrorResponse(error), body=await response.json();
    assert.equal(response.status,error.status);assert.equal(body.code,error.code);assert.equal(body.error,error.message);
  }
});
