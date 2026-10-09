import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessContext } from '../lib/department-access';
import { BUSINESS_SUBMODULES, expandModulePermissions, moduleFixtureActionAllowed, type ModulePermissions } from '../lib/module-permissions';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';
import { canReadReportSource } from '../lib/report-branch-access';
import { delegatedApprovalNotice, supportedHandoffApproval } from '../lib/approval-routing';
function access(permissions: ModulePermissions) {return resolveAccessContext([{profile:'MODULE_ACCESS',grantType:'PRIMARY',scopeKey:'MODULES:ON'},...Object.entries(permissions).map(([key,value])=>({profile:'MODULE_ACCESS' as const,grantType:'CONCURRENT' as const,scopeKey:`MODULE:${key}:${value}`}))]);}
for(const item of BUSINESS_SUBMODULES) test(`${item.key}: independent page grant and no administrative authority`,()=>{
 const a=access({[item.key]:'READ'});
 for(const path of item.paths)assert.equal(canAccessAppRoute(a,path),true,path);
 assert.equal(a.capabilities.includes('ACCOUNT_ADMIN:MANAGE'),false);
 assert.equal(a.capabilities.includes('SYSTEM_CONFIGURATION:MANAGE'),false);
 for(const api of item.apis){assert.equal(canAccessApiRoute(a,api.endsWith('-')?api+'example':api,'DELETE'),false,api);}
});
test('sibling writes do not inherit shared capabilities',()=>{
 const cases=[['warehouse','/api/finished-goods'],['material-follow-up','/api/purchases'],['finished-goods','/api/wip'],['connector-parameters','/api/drawing-library'],['assembly-manuals','/api/connector-parameters'],['quality-management','/api/quality-data'],['employees','/api/recruitment'],['employee-accounts','/api/employees/any'],['daily-shipment','/api/planning/orders'],['sample-planning','/api/order-pool/commands'],['major-approval','/api/other-work-times'],['workflows','/api/major-quality-approvals']];
 for(const [key,path] of cases)assert.equal(canAccessApiRoute(access({[key]:'COLLABORATE'}),path,'POST'),false,key+' '+path);
});
test('shared quality workbench enforces commands and view ownership',()=>{
 const reviewer=access({'quality-review':'COLLABORATE'}),fixtures=access({'fixture-management':'COLLABORATE'}),technical=access({'drawing-library':'COLLABORATE'});
 assert.equal(moduleFixtureActionAllowed(reviewer,'APPROVE'),true);assert.equal(moduleFixtureActionAllowed(reviewer,'STOCK'),false);
 assert.equal(moduleFixtureActionAllowed(fixtures,'SAVE_MAPPING'),true);assert.equal(moduleFixtureActionAllowed(fixtures,'APPROVE'),false);
 assert.equal(moduleFixtureActionAllowed(technical,'RESPOND_RETURN'),true);assert.equal(moduleFixtureActionAllowed(technical,'APPROVE'),false);
 assert.equal(canAccessAppRoute(reviewer,'/workspace/quality-fixtures?view=stock'),false);
});
test('pool preparation and planning rights stay separate',()=>{
 const pool=access({'order-pool':'COLLABORATE'}),warehouse=access({warehouse:'COLLABORATE'});
 assert.equal(canAccessAppRoute(pool,'/weekly-plan-center?view=pool'),true);
 assert.equal(canAccessApiRoute(pool,'/api/planning/orders/x/batches','POST'),false);
 assert.equal(canAccessApiRoute(warehouse,'/api/order-pool/x/progress','POST'),true);
 assert.equal(canAccessApiRoute(warehouse,'/api/order-pool/commands','POST'),false);
});
test('explicit children override stale parent and read reports cannot mutate',()=>{
 const a=access({materials:'COLLABORATE',warehouse:'READ'});
 assert.equal(canAccessApiRoute(a,'/api/warehouse','POST'),false);
 assert.equal(canAccessAppRoute(a,'/workspace/purchases'),false);
 assert.equal(expandModulePermissions({reports:'COLLABORATE'})['report-employee-attainment'],'READ');
});
test('report source checks reject another report and a missing branch',()=>{
 const a=access({'report-attendance-attainment':'READ'});
 assert.equal(canReadReportSource(a,'operations',new URLSearchParams('reportBranch=attendance-attainment')),true);
 assert.equal(canReadReportSource(a,'operations',new URLSearchParams('reportBranch=team-hours')),false);
 assert.equal(canReadReportSource(a,'overview',new URLSearchParams('reportBranch=attendance-attainment')),false);
 assert.equal(canReadReportSource(a,'operations',new URLSearchParams()),false);
});
test('approval outcomes are not pending approvals; excluded documents are not delegated',()=>{
 for(const eventType of ['MAJOR_QUALITY_APPROVED','MAJOR_QUALITY_FINAL_RETURNED','PROCESS_COMPLETION_WITHDRAWAL_REQUEST_REJECTED'])assert.equal(delegatedApprovalNotice({category:'APPROVAL',eventType}),false);
 assert.equal(delegatedApprovalNotice({category:'APPROVAL',sourceType:'QUALITY_FIXTURE'}),false);
 assert.equal(supportedHandoffApproval({eventType:'MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED'}),true);
 assert.equal(supportedHandoffApproval({eventType:'MAJOR_QUALITY_REVIEW_REQUESTED'}),false);
});

test('overview cannot cross sample and mass boundaries through the query string',()=>{
 const a=access({'report-completeness':'READ'});
 assert.equal(canReadReportSource(a,'overview',new URLSearchParams('reportBranch=completeness&mode=mass')),true);
 assert.equal(canReadReportSource(a,'overview',new URLSearchParams('reportBranch=completeness&mode=sample')),false);
 assert.equal(canReadReportSource(a,'overview',new URLSearchParams('reportBranch=completeness')),false);
});
