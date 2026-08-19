import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_DATA_CONTRACTS } from '../lib/access-data-contracts';
import { canAccessApiRoute } from '../lib/api-route-access';
import type { AccessContext, AccessModuleCode, CapabilityCode } from '../lib/department-access';

test('every registered module data contract is readable by its owning module', () => {
  for (const [module, contract] of Object.entries(ACCESS_DATA_CONTRACTS)) {
    if (!contract) continue;
    const moduleCode = module as AccessModuleCode;
    const access: Pick<AccessContext, 'capabilities' | 'productionScope'> = {
      capabilities: [`${moduleCode}:READ` as CapabilityCode],
      productionScope: moduleCode === 'PRODUCTION' ? 'WORKSHOP' : 'NONE',
    };
    for (const endpoint of contract.endpoints) {
      assert.equal(
        canAccessApiRoute(access, endpoint, 'GET'),
        true,
        `${moduleCode} must read ${endpoint}`,
      );
    }
  }
});
