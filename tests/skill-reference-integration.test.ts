import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { productionEmployeeWhere } from '../lib/production-workforce';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'reference skill catalog stays independent, production-scoped and history-safe',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-SKILL-REF-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const coreSkills = await prisma.skillDefinition.findMany({
      where: { isCore: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    assert.deepEqual(
      coreSkills.map(skill => skill.name),
      ['裁线', '压接', '焊接', '装配', '大线', '检验', '包装', '调模'],
    );
    assert.equal(coreSkills.every(skill => skill.sourceProcessDefinitionId === null), true);

    const [productionEmployee, nonProductionEmployee, customSkill] = await Promise.all([
      prisma.employee.create({
        data: {
          employeeNo: `${prefix}-P`,
          name: '生产技能回归员工',
          department: '生产部',
          position: '操作员',
          attendanceEnabled: false,
        },
      }),
      prisma.employee.create({
        data: {
          employeeNo: `${prefix}-N`,
          name: '非生产技能回归员工',
          department: '采购部',
          position: '采购员',
        },
      }),
      prisma.skillDefinition.create({
        data: {
          code: `${prefix}-CUSTOM`,
          name: `${prefix}-设备换型`,
          category: 'PROCESS',
          sourceProcessDefinitionId: null,
          isCore: false,
          isSubsidyEligible: true,
          subsidyMinimumLevel: 3,
          isActive: true,
          sortOrder: 900,
        },
      }),
    ]);

    try {
      const scopedEmployees = await prisma.employee.findMany({
        where: {
          id: { in: [productionEmployee.id, nonProductionEmployee.id] },
          ...productionEmployeeWhere({ requireAttendance: false }),
        },
      });
      assert.deepEqual(scopedEmployees.map(employee => employee.id), [productionEmployee.id]);

      const certification = await prisma.employeeSkillCertification.create({
        data: {
          employeeId: productionEmployee.id,
          skillId: customSkill.id,
          level: 3,
          source: 'LEGACY_ENTRY',
          evidenceType: 'LONG_TERM_PRACTICE',
          requiresReassessment: false,
        },
      });

      const concurrent = await Promise.all([
        prisma.skillDefinition.updateMany({
          where: { id: customSkill.id, version: customSkill.version },
          data: { isActive: false, version: { increment: 1 } },
        }),
        prisma.skillDefinition.updateMany({
          where: { id: customSkill.id, version: customSkill.version },
          data: { isActive: false, version: { increment: 1 } },
        }),
      ]);
      assert.deepEqual(concurrent.map(result => result.count).sort(), [0, 1]);

      const retained = await prisma.employeeSkillCertification.findUnique({
        where: { id: certification.id },
      });
      assert.equal(retained?.level, 3);
      assert.equal(retained?.skillId, customSkill.id);
    } finally {
      await prisma.employeeSkillCertification.deleteMany({ where: { skillId: customSkill.id } });
      await prisma.skillDefinition.deleteMany({ where: { id: customSkill.id } });
      await prisma.employee.deleteMany({
        where: { id: { in: [productionEmployee.id, nonProductionEmployee.id] } },
      });
    }
  },
);
