export class EmployeeStatusChangeError extends Error {
  readonly status = 409;
  readonly code = 'EMPLOYEE_DISABLE_CONFIRMATION_REQUIRED';

  constructor(message = '停用员工档案需要明确确认') {
    super(message);
    this.name = 'EmployeeStatusChangeError';
  }
}

export function resolveEmployeeActiveStatus(input: {
  currentIsActive: boolean;
  requestedIsActive: unknown;
  confirmDisable: unknown;
}): boolean {
  const nextIsActive = input.requestedIsActive === undefined
    ? input.currentIsActive
    : input.requestedIsActive === true;

  if (input.currentIsActive && !nextIsActive && input.confirmDisable !== true) {
    throw new EmployeeStatusChangeError(
      '确认停用后才能保存；非生产人员无需停用，系统会按所属部门自动排除生产报工',
    );
  }

  return nextIsActive;
}
