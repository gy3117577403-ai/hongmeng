import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveAttendanceCalendarDay } from '../lib/attendance-calendar';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'attendance calendar changes reporting eligibility without deleting historical attendance facts',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-ATT-CAL-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const workDate = new Date('2031-06-15T00:00:00.000Z');
    const user = await prisma.user.create({
      data: { username: `${prefix}-ADMIN`, passwordHash: 'integration-test', displayName: '出勤日历测试', laborRole: 'ADMIN' },
    });
    const employee = await prisma.employee.create({
      data: { employeeNo: `${prefix}-E1`, name: '出勤日历员工', department: '生产部', team: '测试班', position: '操作员' },
    });
    const record = await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        departmentSnapshot: '生产部',
        teamSnapshot: '测试班',
        positionSnapshot: '操作员',
        workDate,
        status: 'confirmed',
        attendanceType: 'normal',
        plannedMilliseconds: 28_800_000,
        actualMilliseconds: 28_800_000,
        overtimeMilliseconds: 0,
        leaveMilliseconds: 0,
        segments: [],
        source: 'integration_test',
        createdById: user.id,
        updatedById: user.id,
        confirmedById: user.id,
        confirmedAt: workDate,
      },
    });
    try {
      const holiday = await prisma.attendanceCalendarDay.create({
        data: { workDate, dayType: 'holiday', label: '集成测试假日', updatedById: user.id },
      });
      assert.equal(resolveAttendanceCalendarDay('2031-06-15', {
        dayType: 'holiday', label: holiday.label, remark: holiday.remark,
      }).isWorkday, false);
      assert.equal(await prisma.attendanceRecord.count({ where: { id: record.id } }), 1);

      const temporary = await prisma.attendanceCalendarDay.update({
        where: { workDate },
        data: { dayType: 'temporary_workday', label: '临时加班', updatedById: user.id },
      });
      const resolved = resolveAttendanceCalendarDay('2031-06-15', {
        dayType: 'temporary_workday', label: temporary.label, remark: temporary.remark,
      });
      assert.equal(resolved.effectiveDayType, 'temporary_workday');
      assert.equal(resolved.isWorkday, true);
      assert.equal(await prisma.attendanceRecord.count({ where: { id: record.id, status: 'confirmed' } }), 1);
    } finally {
      await prisma.attendanceCalendarDay.deleteMany({ where: { workDate } });
      await prisma.attendanceRecord.deleteMany({ where: { employeeId: employee.id } });
      await prisma.employee.delete({ where: { id: employee.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  },
);
