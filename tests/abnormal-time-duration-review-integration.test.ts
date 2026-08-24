import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { reviewAbnormalTimeEvent } from '../lib/abnormal-time-review-service';
import { aggregateDailyAttainment } from '../lib/employee-attainment-daily';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'same employee can approve duration-only abnormalities from different products and both protect attainment',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITABNDUR-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-EMP`,
        name: `${prefix} worker`,
        department: '生产部',
        position: '装配',
        team: `${prefix}-TEAM`,
        isActive: true,
        attendanceEnabled: true,
      },
    });
    const reviewer = await prisma.user.create({
      data: {
        username: `${prefix}-REVIEWER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} reviewer`,
        laborRole: 'ADMIN',
      },
    });
    const [firstOrder, secondOrder] = await Promise.all([
      prisma.workOrder.create({
        data: { code: `${prefix}-ORDER-A`, productName: 'product A', stage: 'frontend' },
      }),
      prisma.workOrder.create({
        data: { code: `${prefix}-ORDER-B`, productName: 'product B', stage: 'frontend' },
      }),
    ]);

    try {
      const workDate = new Date('2026-08-24T00:00:00.000Z');
      const durationMilliseconds = 20 * 60_000;
      const createEvent = (workOrderId: string, title: string) => prisma.abnormalTimeEvent.create({
        data: {
          workDate,
          category: 'process',
          title,
          startedAt: null,
          endedAt: null,
          durationMilliseconds,
          employeeExempt: false,
          workOrderId,
          source: 'FIELD_REPORT',
          createdById: reviewer.id,
          updatedById: reviewer.id,
          allocations: {
            create: {
              employeeId: employee.id,
              workDate,
              durationMilliseconds,
            },
          },
        },
      });
      const [first, second] = await Promise.all([
        createEvent(firstOrder.id, `${prefix} first product abnormality`),
        createEvent(secondOrder.id, `${prefix} second product abnormality`),
      ]);

      const canReviewEmployeeIds = async (employeeIds: readonly string[]) => {
        assert.deepEqual(employeeIds, [employee.id]);
        return true;
      };
      const approvedFirst = await reviewAbnormalTimeEvent({
        eventId: first.id,
        reviewerId: reviewer.id,
        decision: 'confirmed',
        note: null,
        expectedVersion: first.version,
        canReviewEmployeeIds,
      });
      const approvedSecond = await reviewAbnormalTimeEvent({
        eventId: second.id,
        reviewerId: reviewer.id,
        decision: 'confirmed',
        note: null,
        expectedVersion: second.version,
        canReviewEmployeeIds,
      });

      for (const approved of [approvedFirst, approvedSecond]) {
        assert.equal(approved.qualityStatus, 'confirmed');
        assert.equal(approved.employeeExempt, true);
        assert.equal(approved.approvedDurationMilliseconds, durationMilliseconds);
        assert.equal(approved.startedAt, null);
        assert.equal(approved.endedAt, null);
      }
      const approvedAllocations = await prisma.abnormalTimeAllocation.findMany({
        where: {
          employeeId: employee.id,
          workDate,
          event: { qualityStatus: 'confirmed', employeeExempt: true, deletedAt: null },
        },
        include: { event: { select: { approvedDurationMilliseconds: true } } },
      });
      const approvedTotal = approvedAllocations.reduce(
        (sum, allocation) => sum + (allocation.event.approvedDurationMilliseconds ?? allocation.durationMilliseconds),
        0,
      );
      assert.equal(approvedTotal, 40 * 60_000);

      const minute = 60_000;
      const attainment = aggregateDailyAttainment([{
        attendanceMilliseconds: 8 * 60 * minute,
        exemptAbnormalMilliseconds: approvedTotal,
        standardLaborMilliseconds: 418 * minute,
        claimedStandardLaborMilliseconds: 418 * minute,
        actualLaborMilliseconds: 7 * 60 * minute,
        attendanceConfirmed: true,
      }]);
      assert.equal(attainment.effectiveProductionMilliseconds, 440 * minute);
      assert.equal(attainment.attainmentCapacityMilliseconds, 418 * minute);
    } finally {
      await prisma.abnormalTimeEvent.deleteMany({
        where: { workOrderId: { in: [firstOrder.id, secondOrder.id] } },
      });
      await prisma.workOrder.deleteMany({ where: { id: { in: [firstOrder.id, secondOrder.id] } } });
      await prisma.user.delete({ where: { id: reviewer.id } });
      await prisma.employee.delete({ where: { id: employee.id } });
    }
  },
);
