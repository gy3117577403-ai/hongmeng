import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeHoursDayMetrics, aggregateEmployeeHours } from '../lib/employee-hours-metrics';
import { canReviewOtherWork, otherWorkScope } from '../lib/other-work-time-access';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import type { CurrentUserDTO } from '../types';
const h = 3600000;
const day = (a: number, c: number, l: number, o: number) => ({ attendanceMilliseconds: a*h, standardLaborMilliseconds: c*h, exemptAbnormalMilliseconds: l*h, otherWorkMilliseconds: o*h, attendanceConfirmed: true });
test('full approved hours divided by 95% attendance reserves rest exactly once', () => {
  for (const [a,c,l,o,expected] of [[8,6,0,2,10526],[8,6,1,.6,10000],[10,7,1,1.5,10000],[8,6.6,1,0,10000]]) {
    const result = employeeHoursDayMetrics(day(a,c,l,o));
    assert.equal(result.attainmentBasisPoints, expected);
    assert.equal(result.attendanceMilliseconds, a*h);
    assert.equal(result.attainmentCapacityMilliseconds, a*h*.95);
    assert.equal(result.otherWorkMilliseconds, o*h);
    assert.equal(result.creditedAbnormalMilliseconds, l*h);
  }
  assert.equal(employeeHoursDayMetrics(day(8,0,0,8)).attainmentBasisPoints,10526);
  assert.equal(employeeHoursDayMetrics(day(8,0,0,7.6)).unexplainedMilliseconds,0);
  assert.equal(employeeHoursDayMetrics(day(8,0,0,0)).restAllowanceMilliseconds,24*60000);
});
test('period aggregation uses summed targets instead of average rates', () => {
  const aggregate=aggregateEmployeeHours([day(8,6,1,.6),day(10,6,1,1)]);
  assert.equal(aggregate.attainmentNumeratorMilliseconds,15.6*h);
  assert.equal(aggregate.attainmentCapacityMilliseconds,18*h*.95);
  assert.equal(aggregate.attainmentBasisPoints,9123);
  assert.notEqual(aggregate.attainmentBasisPoints,9211);
});
test('other-only missing attendance retains work but cannot create attendance or a rate', () => {
  const result=employeeHoursDayMetrics({...day(0,0,0,2),attendanceConfirmed:false});
  assert.equal(result.otherWorkMilliseconds,2*h); assert.equal(result.attainmentBasisPoints,null);
  assert.equal(result.attainmentIncompleteDays,1);
  const excluded=employeeHoursDayMetrics({...day(8,0,0,2),attainmentStream:'sample'});
  assert.equal(excluded.otherWorkMilliseconds,2*h); assert.equal(excluded.attainmentCapacityMilliseconds,0);
  assert.equal(excluded.attainmentNumeratorMilliseconds,0);
});
const actor=(grants: AccessGrant[], extra={})=>({id:'reviewer',employeeId:'reviewer-employee',laborRole:'EMPLOYEE',dailyPlanningTeamIds:[],access:resolveAccessContext(grants),...extra} as unknown as CurrentUserDTO);
const target={createdById:'operator',employeeId:'employee',teamIdSnapshot:'team-a',teamSnapshot:'A组'};
const teamGrant: AccessGrant={profile:'WORKSHOP_TEAM_LEADER',grantType:'PRIMARY',scopeKey:'TEAM:team-a'};
test('one authorized leader, supervisor or administrator may approve; self and other teams cannot',()=>{
  assert.equal(canReviewOtherWork(actor([teamGrant]),target),true);
  assert.equal(canReviewOtherWork(actor([teamGrant]),{...target,teamIdSnapshot:'team-b',teamSnapshot:'B组'}),false);
  assert.equal(canReviewOtherWork(actor([teamGrant],{id:'operator'}),target),false);
  assert.equal(canReviewOtherWork(actor([teamGrant],{employeeId:'employee'}),target),false);
  assert.equal(canReviewOtherWork(actor([{profile:'WORKSHOP_SUPERVISOR',grantType:'PRIMARY',scopeKey:'WORKSHOP:PRODUCTION'}]),target),true);
  assert.equal(canReviewOtherWork(actor([],{laborRole:'ADMIN'}),target),true);
  assert.equal(canReviewOtherWork(actor([],{laborRole:'ADMIN',employeeId:'employee'}),target),false);
});
test('quality, HR, collaborators and concurrent global read cannot widen independent approval scope',()=>{
  for(const grant of [
    {profile:'QUALITY_REVIEWER',grantType:'PRIMARY',scopeKey:'GLOBAL'},
    {profile:'DEPARTMENT_FULL',departmentCode:'HR',grantType:'PRIMARY',scopeKey:'DEPARTMENT:HR'},
    {profile:'PRODUCTION_COLLABORATOR',grantType:'PRIMARY',scopeKey:'WORKSHOP:PRODUCTION'},
  ] as AccessGrant[]) assert.equal(otherWorkScope(actor([grant])).manage,false);
  const mixed=actor([teamGrant,{profile:'GM_OFFICE_READER_APPROVER',grantType:'CONCURRENT',scopeKey:'GLOBAL'}]);
  assert.equal(otherWorkScope(mixed).global,false);
  assert.equal(canReviewOtherWork(mixed,{...target,teamIdSnapshot:'team-b',teamSnapshot:'B组'}),false);
});
