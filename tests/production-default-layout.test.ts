import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production execution opens in a focused workspace at tablet width', () => {
  const header = readFileSync('components/layout/AppWorkbenchHeader.tsx', 'utf8');
  const production = readFileSync('components/ProductionExecutionCenter.tsx', 'utf8');
  const stylesheet = readFileSync('app/production/production-workbench.css', 'utf8');

  assert.match(header, /href: '\/production'.*openModeOnEnter: false/);
  assert.match(header, /openFromSidebar\?: boolean/);
  assert.match(header, /if \(canOpenModeFromSidebar\) moduleModeSwitcher\?\.onToggle\(\)/);
  assert.match(production, /const \[navigationOpen, setNavigationOpen\] = useState\(false\)/);
  assert.match(production, /const \[insightsOpen, setInsightsOpen\] = useState\(false\)/);
  assert.doesNotMatch(production, /setInsightsOpen\(window\.matchMedia/);
  assert.match(production, /sidebarExpanded=\{navigationOpen\}/);
  assert.match(production, /onSidebarExpandedChange=\{handleNavigationExpandedChange\}/);
  assert.match(production, /openFromSidebar: false/);
  assert.match(production, /onClick=\{toggleModeDrawer\}/);
  assert.match(production, /onClick=\{toggleInsights\}/);
  assert.match(production, /modeDrawer\.close\(false\);\s*setInsightsOpen\(false\)/s);
  assert.match(production, /window\.matchMedia\('\(min-width: 1920px\)'\)/);
  assert.match(stylesheet, /@media \(max-width: 1919px\)[\s\S]*?\.production-dispatch-rail\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(stylesheet, /@media \(min-width: 1920px\)[\s\S]*?\.production-dispatch-layout\.rail-open/);
});
