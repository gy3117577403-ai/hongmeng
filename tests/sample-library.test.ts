import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadSampleLibrary } from '../lib/sample-library-access';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute, landingRouteForAccess } from '../lib/app-route-access';
import { normalizedSampleSearch, sampleSearchTokens, preferredHistory, safeLibraryReturn, meaningfulDraft, displayPayload, type LibraryHistory } from '../lib/sample-library';
const grant=(profile:AccessGrant['profile'],scopeKey:string):AccessGrant=>({profile,scopeKey,grantType:'CONCURRENT',isActive:true});
test('mobile entitlement permits library media but no production writes or unrelated workbench',()=>{
 const access=resolveAccessContext([grant('MODULE_ACCESS','MODULES:OFF'),grant('SAMPLE_LIBRARY_READER','MOBILE:SAMPLE_LIBRARY')]);
 assert.equal(canReadSampleLibrary(access),true);assert.equal(landingRouteForAccess(access),'/sample-library');
 for(const path of ['/api/sample-library','/api/sample-library/product','/api/sample-library/photos/photo']){assert.equal(canAccessApiRoute(access,path,'GET'),true);assert.equal(canAccessApiRoute(access,path,'POST'),false);}
 assert.equal(canAccessAppRoute(access,'/sample-library?product=123'),true);
 for(const path of ['/home','/weekly-plan-center','/drawing-library','/sample-capture/123'])assert.equal(canAccessAppRoute(access,path),false);
 for(const path of ['/api/sample-tasks','/api/sample-photos','/api/warehouse','/api/material-follow-ups','/api/employees','/api/drawing-library'])assert.equal(canAccessApiRoute(access,path,'POST'),false);
});
test('legacy grants keep existing rights while independent library access can expire',()=>{
 const legacy=grant('DEPARTMENT_FULL','DEPARTMENT:HR');legacy.departmentCode='HR';
 const before=resolveAccessContext([legacy]),after=resolveAccessContext([legacy,grant('SAMPLE_LIBRARY_READER','MOBILE:SAMPLE_LIBRARY')]);
 assert.deepEqual(after.capabilities,before.capabilities);assert.equal(canReadSampleLibrary(before),false);assert.equal(canReadSampleLibrary(after),true);
 assert.equal(canReadSampleLibrary(resolveAccessContext([{...grant('SAMPLE_LIBRARY_READER','MOBILE:SAMPLE_LIBRARY'),effectiveTo:'2020-01-01'}])),false);
 assert.equal(canReadSampleLibrary(resolveAccessContext([grant('FIELD_REPORTER','EMPLOYEE:test')])),false);
 assert.equal(canReadSampleLibrary({modulePermissions:{technology:'READ'},workbenchEnabled:true}),true);
});
test('model search tolerates separators and multiple partial fragments',()=>{
 assert.equal(normalizedSampleSearch('Ｄ014503 - 8305_V01'),'d0145038305v01');assert.deepEqual(sampleSearchTokens('D014503 8305'),['d014503','8305']);
});
test('approved older source wins over new drafts, empty repeat tasks and withdrawn packages',()=>{
 const base:LibraryHistory={key:'accepted',taskId:'task',code:'OLD',revision:1,status:'CONFIRMED',date:'2020-01-01',photos:2,parameters:1,cancelled:false,unitPlannedMilliseconds:null};
 const values=[{...base,key:'draft',status:'DRAFT',date:'2026-09-24'},{...base,key:'voided',status:'VOIDED',date:'2027-01-01'},base,{...base,key:'empty',date:'2027-01-01',photos:0,parameters:0}];
 assert.equal(preferredHistory(values),'accepted');assert.equal(preferredHistory([{...base,cancelled:true}]),null);
});
test('draft placeholders and opaque ids do not masquerade as useful sample data',()=>{
 assert.equal(meaningfulDraft({rowId:'x',source:'OFFICIAL',stageGroup:'frontend'}),false);assert.equal(meaningfulDraft({model:'ABC',outerPeelMm:0}),true);
 assert.deepEqual(displayPayload({rowId:'internal',model:'ABC',outerPeelMm:0,timeBasis:'per_unit'}),[['连接器型号','ABC'],['外剥皮 mm','0'],['计时方式','按件']]);
});
test('return URL accepts original app context only',()=>{
 assert.equal(safeLibraryReturn('/sample-capture/qrcode?tab=photos'),'/sample-capture/qrcode?tab=photos');
 for(const value of ['https://evil.example','//evil.example','/\\evil','/api/sample-tasks','/home/../../admin'])assert.equal(safeLibraryReturn(value),'');
});
