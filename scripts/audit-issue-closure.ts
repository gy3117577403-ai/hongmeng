import { prisma } from '../lib/prisma';
import { issueCode, issueDetailInclude, issueCollaborationBlockers, issueVerificationBasis } from '../lib/issues';

// Read-only: never repair evidence, close issues, or change audit history.
async function main() {
  const issues = await prisma.issue.findMany({
    where: { deletedAt: null, status: 'awaiting_confirmation' }, include: issueDetailInclude, orderBy: { sequence: 'asc' },
  });
  const records = issues.map(issue => {
    const verification = issueVerificationBasis(issue);
    const blockers = issueCollaborationBlockers(issue.activities);
    if (verification.kind === 'missing') blockers.push(verification.text);
    if (!issue.reporter) blockers.push('原发起人未登记，需要管理员核实后代确认');
    return { id: issue.id, code: issueCode(issue.sequence), title: issue.title, version: issue.version,
      reporter: issue.reporter?.displayName || null, verificationKind: verification.kind,
      approvalId: verification.approvalId || null, blockers, requiresHumanConfirmation: true };
  });
  console.log(JSON.stringify({ readOnly: true, checkedAt: new Date().toISOString(), count: records.length, records }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
