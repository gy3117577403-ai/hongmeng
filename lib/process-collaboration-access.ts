import {
  hasCapability,
  type AccessActionCode,
  type AccessContext,
} from '@/lib/department-access';

export type CollaborationAccessSubject = {
  id: string;
  employeeId?: string | null;
  access: Pick<AccessContext, 'capabilities'>;
};

export type IssueCollaborationRecord = {
  type: string;
  isMajorQuality?: boolean;
  reporterId?: string | null;
  assigneeEmployeeId?: string | null;
  collaborators?: ReadonlyArray<{ employeeId?: string | null }>;
};

export type ChangeCollaborationRecord = {
  type: string;
  requesterId?: string | null;
  ownerId?: string | null;
};

export function isProcessIssueCollaborator(subject: CollaborationAccessSubject): boolean {
  return hasCapability(subject.access, 'PROCESS', 'READ')
    && hasCapability(subject.access, 'ISSUE_MANAGEMENT', 'READ')
    && !hasCapability(subject.access, 'QUALITY', 'READ');
}

export function isProcessChangeCollaborator(subject: CollaborationAccessSubject): boolean {
  return hasCapability(subject.access, 'CHANGE_MANAGEMENT', 'READ')
    && !hasCapability(subject.access, 'ENGINEERING', 'READ')
    && !hasCapability(subject.access, 'QUALITY', 'READ');
}

export function canCreateIssueForProcess(
  subject: CollaborationAccessSubject,
  input: { type?: string | null; isMajorQuality?: boolean },
): boolean {
  if (hasCapability(subject.access, 'QUALITY', 'CREATE')) return true;
  if (!hasCapability(subject.access, 'ISSUE_MANAGEMENT', 'CREATE')) return false;
  if (input.isMajorQuality === true) return false;
  return isProcessIssueCollaborator(subject) ? input.type === 'process' : true;
}

export function canMutateIssueForProcess(
  subject: CollaborationAccessSubject,
  issue: IssueCollaborationRecord,
  action: Extract<AccessActionCode, 'UPDATE' | 'EXECUTE_WORKFLOW'>,
): boolean {
  if (hasCapability(subject.access, 'QUALITY', action)) return true;
  if (!hasCapability(subject.access, 'ISSUE_MANAGEMENT', action)) return false;
  if (issue.isMajorQuality) return false;
  if (isProcessIssueCollaborator(subject) && issue.type === 'process') return true;
  if (issue.reporterId === subject.id) return true;
  const employeeId = subject.employeeId || '';
  const participates = Boolean(employeeId) && (
    issue.assigneeEmployeeId === employeeId
    || issue.collaborators?.some(item => item.employeeId === employeeId) === true
  );
  if (participates) return true;
  return !isProcessIssueCollaborator(subject)
    && hasCapability(subject.access, 'PRODUCTION', 'READ')
    && issue.type === 'production';
}

export function canCreateChangeForProcess(
  subject: CollaborationAccessSubject,
  input: { type?: string | null },
): boolean {
  if (
    hasCapability(subject.access, 'ENGINEERING', 'CREATE')
    || hasCapability(subject.access, 'QUALITY', 'CREATE')
  ) return true;
  return hasCapability(subject.access, 'CHANGE_MANAGEMENT', 'CREATE')
    && input.type === 'process';
}

export function canMutateChangeForProcess(
  subject: CollaborationAccessSubject,
  change: ChangeCollaborationRecord,
  action: Extract<AccessActionCode, 'UPDATE' | 'EXECUTE_WORKFLOW'>,
): boolean {
  if (
    hasCapability(subject.access, 'ENGINEERING', action)
    || hasCapability(subject.access, 'QUALITY', action)
  ) return true;
  if (!hasCapability(subject.access, 'CHANGE_MANAGEMENT', action)) return false;
  return change.type === 'process'
    || change.requesterId === subject.id
    || change.ownerId === subject.id;
}
