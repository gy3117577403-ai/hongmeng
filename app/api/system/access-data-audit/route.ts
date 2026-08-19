import { NextResponse } from 'next/server';
import { requireCapability, unauthorized, UnauthorizedError } from '@/lib/auth';
import { ACCESS_DATA_CONTRACTS } from '@/lib/access-data-contracts';
import { canAccessApiRoute } from '@/lib/api-route-access';
import {
  resolveAccessContext,
  type AccessGrant,
  type AccessModuleCode,
  type AccessProfileCode,
  type DepartmentCode,
} from '@/lib/department-access';
import { resolveAttendanceAccessBoundary } from '@/lib/attendance-access';
import { resolveProductionEntityScope } from '@/lib/production-access-scope';
import { productionWorkOrderScopeWhere } from '@/lib/production-execution';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function departmentCode(value: string | null | undefined): DepartmentCode | undefined {
  return value && ['PRODUCTION', 'BUSINESS', 'PROCUREMENT', 'WAREHOUSE', 'ENGINEERING', 'QUALITY', 'GM_OFFICE', 'FINANCE', 'PROCESS', 'PLANNING', 'HR'].includes(value)
    ? value as DepartmentCode
    : undefined;
}

export async function GET() {
  try {
    await requireCapability('SYSTEM_CONFIGURATION', 'READ');
    const now = new Date();
    const [users, workOrders, drawings, manuals, productTimes, attendance, employees, completions] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          displayName: true,
          isActive: true,
          accountStatus: true,
          laborRole: true,
          employee: { select: { id: true, employeeNo: true, name: true, department: true, team: true, isActive: true, departmentRef: { select: { code: true } } } },
          accessGrants: {
            select: {
              id: true,
              profile: true,
              grantType: true,
              scopeKey: true,
              isActive: true,
              effectiveFrom: true,
              effectiveTo: true,
              department: { select: { code: true } },
            },
          },
        },
        orderBy: [{ isActive: 'desc' }, { username: 'asc' }],
      }),
      prisma.workOrder.count({ where: { deletedAt: null } }),
      prisma.drawingLibraryItem.count({ where: { deletedAt: null } }),
      prisma.connectorAssemblyManual.count({ where: { deletedAt: null } }),
      prisma.productTimeProfile.count(),
      prisma.employee.count({ where: { isActive: true, attendanceEnabled: true } }),
      prisma.employee.count({ where: { isActive: true } }),
      prisma.processCompletion.count(),
    ]);
    const datasets = { workOrders, drawings, manuals, productTimes, attendance, employees, completions };

    const accounts = await Promise.all(users.map(async account => {
      const storedGrants: AccessGrant[] = account.accessGrants.map(grant => ({
        id: grant.id,
        profile: grant.profile as AccessProfileCode,
        grantType: grant.grantType,
        departmentCode: departmentCode(grant.department?.code),
        scopeKey: grant.scopeKey,
        isActive: grant.isActive,
        effectiveFrom: grant.effectiveFrom,
        effectiveTo: grant.effectiveTo,
      }));
      const compatibilityGrants = legacyFallbackGrants({
        laborRole: account.laborRole,
        employeeId: account.employee?.id || null,
        employee: account.employee ? {
          id: account.employee.id,
          departmentRef: account.employee.departmentRef,
        } : null,
      });
      const grants = storedGrants.length
        ? [...storedGrants, ...(account.laborRole === 'ADMIN' ? compatibilityGrants : [])]
        : compatibilityGrants;
      const access = resolveAccessContext(grants, {
        accountActive: account.isActive && account.accountStatus === 'ACTIVE',
        now,
      });
      const attendanceBoundary = access.modules.includes('ATTENDANCE')
        ? await resolveAttendanceAccessBoundary({
            laborRole: account.laborRole,
            employee: account.employee,
            access,
          })
        : null;
      const productionBoundary = access.modules.includes('PRODUCTION')
        ? resolveProductionEntityScope({ access })
        : null;
      const modules = await Promise.all((Object.entries(ACCESS_DATA_CONTRACTS) as Array<[AccessModuleCode, NonNullable<(typeof ACCESS_DATA_CONTRACTS)[AccessModuleCode]>]>)
        .filter(([module]) => access.modules.includes(module))
        .map(async ([module, contract]) => {
          const blockedEndpoints = contract.endpoints.filter(endpoint => canAccessApiRoute(access, endpoint, 'GET') !== true);
          const globalCount = contract.datasetKey ? datasets[contract.datasetKey] : null;
          const visibleCount = module === 'ATTENDANCE' && attendanceBoundary?.employeeIds !== null
            ? attendanceBoundary?.employeeIds.length ?? 0
            : module === 'PRODUCTION' && productionBoundary?.level === 'TEAM'
              ? await prisma.workOrder.count({
                  where: {
                    deletedAt: null,
                    ...productionWorkOrderScopeWhere(productionBoundary),
                  },
                })
              : module === 'PRODUCTION' && !productionBoundary?.canRead
                ? 0
                : globalCount;
          const status = blockedEndpoints.length
            ? 'BROKEN_ACCESS'
            : globalCount === 0
              ? 'EMPTY_SOURCE'
              : globalCount !== null && visibleCount === 0
                ? 'SCOPE_EMPTY'
                : 'CONNECTED';
          return {
            module,
            label: contract.label,
            endpoints: contract.endpoints,
            blockedEndpoints,
            scoped: Boolean(contract.scoped),
            scopeLabel: module === 'ATTENDANCE'
              ? attendanceBoundary?.scopeLabel || null
              : module === 'PRODUCTION'
                ? productionBoundary?.level || null
                : contract.scoped ? access.productionScope : null,
            globalCount,
            visibleCount,
            status,
          };
        }));
      const issues = [
        ...(!storedGrants.length ? ['账号仍使用兼容权限，建议确认并配置正式授权'] : []),
        ...modules.filter(module => module.status === 'BROKEN_ACCESS').map(module => `${module.label}菜单与接口权限不一致`),
        ...modules.filter(module => module.status === 'SCOPE_EMPTY').map(module => `${module.label}范围没有匹配员工或数据`),
      ];
      return {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        isActive: account.isActive,
        accountStatus: account.accountStatus,
        employee: account.employee ? {
          employeeNo: account.employee.employeeNo,
          name: account.employee.name,
          department: account.employee.department,
          team: account.employee.team,
        } : null,
        productionScope: access.productionScope,
        modules,
        issues,
      };
    }));

    return NextResponse.json({
      ok: true,
      generatedAt: now.toISOString(),
      datasets,
      summary: {
        accountCount: accounts.length,
        activeAccountCount: accounts.filter(account => account.isActive && account.accountStatus === 'ACTIVE').length,
        issueAccountCount: accounts.filter(account => account.issues.length > 0).length,
        brokenModuleCount: accounts.flatMap(account => account.modules).filter(module => module.status === 'BROKEN_ACCESS').length,
        scopeEmptyCount: accounts.flatMap(account => account.modules).filter(module => module.status === 'SCOPE_EMPTY').length,
      },
      accounts,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('access data audit failed', error);
    return NextResponse.json({ ok: false, error: '权限与数据联通审计失败' }, { status: 500 });
  }
}
