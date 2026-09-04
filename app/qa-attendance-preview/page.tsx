import AttendanceManagementShell, { type AttendancePreviewData } from '@/components/AttendanceManagementShell';
import type { AttendanceGroup, AttendanceRecordDTO, CurrentUserDTO, EmployeeDTO } from '@/types';
import '../workspace/attendance/attendance-workbench.css';

export const dynamic = 'force-dynamic';

const now = '2026-09-04T01:00:00.000Z';

function employee(index: number, name: string, attendanceGroup: AttendanceGroup, position: string, team: string): EmployeeDTO {
  return {
    id: `qa-employee-${index}`,
    employeeNo: String(index).padStart(4, '0'),
    name,
    department: '生产部',
    departmentId: null,
    position,
    team,
    hireDate: '2025-01-01',
    mobile: null,
    wecomUserId: null,
    notificationEnabled: true,
    isActive: true,
    attendanceEnabled: true,
    attendanceGroup,
    attainmentEligible: true,
    attainmentFactorBasisPoints: 10000,
    attainmentStream: attendanceGroup === 'SAMPLE' ? 'sample' : 'batch',
    resignedAt: null,
    resignationReason: null,
    resignationNote: null,
    createdAt: now,
    updatedAt: now,
  };
}

const employees = [
  employee(1, '张俊利', 'PRODUCTION_FRONT', '裁线操作员', '前端一组'),
  employee(2, '沈静', 'SAMPLE', '样品装配', '样品组'),
  employee(3, '任秋艳', 'SAMPLE', '样品组长', '样品组'),
  employee(4, '胡军瑞', 'SAMPLE', '返修技师', '样品组'),
  employee(5, '曹俊南', 'SAMPLE', '压接操作员', '样品组'),
  employee(6, '肖明好', 'SAMPLE', '装配操作员', '样品组'),
  employee(7, '赵容', 'PRODUCTION_FRONT', '前端组长', '前端一组'),
  employee(8, '杨菊', 'PRODUCTION_FRONT', '压接操作员', '前端二组'),
  employee(9, '方荣霞', 'PRODUCTION_BACK', '后端组长', '后端装配'),
  employee(10, '王丽', 'PRODUCTION_BACK', '插入操作员', '后端装配'),
  employee(11, '周敏', 'PRODUCTION_BACK', '总装操作员', '后端装配'),
  employee(12, '新入职待确认', 'UNASSIGNED', '操作员', '班组待定'),
];

function record(employeeItem: EmployeeDTO, attendanceType: AttendanceRecordDTO['attendanceType'], status: AttendanceRecordDTO['status'], actual = 28_800_000): AttendanceRecordDTO {
  return {
    id: `qa-record-${employeeItem.id}`,
    employeeId: employeeItem.id,
    employee: employeeItem,
    departmentSnapshot: employeeItem.department,
    attendanceGroupSnapshot: employeeItem.attendanceGroup,
    workDate: '2026-09-04',
    status,
    attendanceType,
    attainmentFactorBasisPoints: 10000,
    attainmentStream: employeeItem.attainmentStream,
    plannedMilliseconds: 28_800_000,
    leaveMilliseconds: attendanceType === 'leave' ? 28_800_000 : 0,
    actualMilliseconds: attendanceType === 'leave' || attendanceType === 'absent' || attendanceType === 'rest' ? 0 : actual,
    overtimeMilliseconds: employeeItem.id.endsWith('-4') ? 7_200_000 : 0,
    segments: attendanceType === 'normal' ? [
      { type: 'regular', startedAt: '2026-09-04T00:00:00.000Z', endedAt: '2026-09-04T04:00:00.000Z', durationMilliseconds: 14_400_000 },
      { type: 'regular', startedAt: '2026-09-04T05:00:00.000Z', endedAt: '2026-09-04T09:00:00.000Z', durationMilliseconds: 14_400_000 },
    ] : [],
    source: 'qa_preview',
    remark: null,
    confirmedBy: status === 'confirmed' ? { id: 'qa-user', username: 'admin', displayName: '管理员' } : null,
    confirmedAt: status === 'confirmed' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

const records = [
  record(employees[0], 'normal', 'confirmed'),
  record(employees[1], 'normal', 'draft'),
  record(employees[2], 'normal', 'draft'),
  record(employees[3], 'normal', 'confirmed'),
  record(employees[4], 'leave', 'draft'),
  record(employees[6], 'normal', 'confirmed'),
  record(employees[7], 'normal', 'draft'),
  record(employees[8], 'normal', 'confirmed'),
  record(employees[9], 'normal', 'draft'),
];

const previewData: AttendancePreviewData = {
  employees,
  records,
  summary: {
    enabledEmployeeCount: employees.length,
    recordCount: records.length,
    confirmedCount: records.filter(item => item.status === 'confirmed').length,
    draftCount: records.filter(item => item.status === 'draft').length,
    actualMilliseconds: records.filter(item => item.status === 'confirmed').reduce((sum, item) => sum + item.actualMilliseconds, 0),
    overtimeMilliseconds: records.reduce((sum, item) => sum + item.overtimeMilliseconds, 0),
    leaveMilliseconds: records.reduce((sum, item) => sum + item.leaveMilliseconds, 0),
  },
  scopeCounts: { production: employees.length, other: 0, all: employees.length },
  groupCounts: {
    PRODUCTION_FRONT: 3,
    PRODUCTION_BACK: 3,
    SAMPLE: 5,
    OTHER: 0,
    UNASSIGNED: 1,
  },
  selectedGroup: 'SAMPLE',
};

const previewUser: CurrentUserDTO = {
  id: 'qa-user',
  username: 'admin',
  displayName: '管理员',
  accountStatus: 'ACTIVE',
  mustChangePassword: false,
  lastLoginAt: now,
  laborRole: 'ADMIN',
  employeeId: null,
  employee: null,
  access: {
    accountActive: true,
    effectiveGrants: [],
    capabilities: ['HR:UPDATE', 'QUALITY:EXECUTE_WORKFLOW', 'PRODUCTION:EXECUTE_WORKFLOW'],
    modules: ['HR', 'ATTENDANCE', 'PRODUCTION', 'QUALITY'],
    scopeHints: [],
    productionScope: 'GLOBAL',
  },
  dailyPlanningRoles: ['WORKSHOP_SUPERVISOR'],
  dailyPlanningTeamIds: [],
  canAccessDailyPlans: true,
  canAccessWeeklyProcesses: true,
  canManageDailyPlanningOrganization: true,
};

export default function AttendancePreviewPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return <AttendanceManagementShell user={previewUser} previewData={previewData} />;
}

