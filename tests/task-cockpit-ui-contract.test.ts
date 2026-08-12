import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

const cockpitShells = [
  'components/MajorQualityApprovalShell.tsx',
  'components/IssueManagementShell.tsx',
  'components/AttendanceManagementShell.tsx',
  'components/KnowledgeBaseShell.tsx',
  'components/EmployeeAttainmentReportShell.tsx',
];

test('five operating workbenches use the shared task cockpit without the duplicate page header', () => {
  for (const file of cockpitShells) {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    assert.match(source, /WorkbenchCockpitCommand/);
    assert.match(source, /hm-cockpit-root/);
    assert.match(source, /hideHeader/);
    assert.match(source, /sidebarTriggerTargetId=/);
    assert.doesNotMatch(source, /<WorkbenchPageHeader/);
  }
});

test('shared cockpit keeps one navigation target and dedicated command regions', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/layout/WorkbenchCockpitCommand.tsx'), 'utf8');
  assert.match(source, /hm-cockpit-navigation-trigger/);
  assert.match(source, /hm-cockpit-title/);
  assert.match(source, /hm-cockpit-context/);
  assert.match(source, /hm-cockpit-search/);
  assert.match(source, /hm-cockpit-actions/);
});

test('shared cockpit stylesheet preserves the compact command bar and stage rail', () => {
  const source = readFileSync(resolve(repositoryRoot, 'app/styles/hm-workbench-foundation.css'), 'utf8');
  assert.match(source, /\.hm-cockpit-command\s*\{/);
  assert.match(source, /min-height:\s*58px/);
  assert.match(source, /\.hm-cockpit-stage-rail\s*\{/);
  assert.doesNotMatch(source, /\.hm-cockpit-command[\s\S]*?linear-gradient\(/);
});
