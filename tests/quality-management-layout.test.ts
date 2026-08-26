import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const qualityOverview = readFileSync(resolve(repositoryRoot, 'components/QualityManagementShell.tsx'), 'utf8');
const internalRisks = readFileSync(resolve(repositoryRoot, 'components/InternalQualityRiskShell.tsx'), 'utf8');
const eightDArchive = readFileSync(resolve(repositoryRoot, 'components/EightDArchiveShell.tsx'), 'utf8');

test('all quality management pages remove hidden-header spacing through the cockpit root contract', () => {
  assert.match(qualityOverview, /className="hm-workbench-root hm-cockpit-root quality-home-shell"/);
  assert.match(internalRisks, /className="hm-workbench-root hm-cockpit-root internal-risk-shell"/);
  assert.match(eightDArchive, /className="hm-workbench-root hm-cockpit-root hm-eight-d-workbench"/);

  for (const component of [qualityOverview, internalRisks, eightDArchive]) {
    assert.match(component, /<AppWorkbenchHeader[\s\S]*?hideHeader/);
    assert.match(component, /<QualityModuleTabs/);
  }
});
