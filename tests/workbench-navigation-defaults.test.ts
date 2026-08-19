import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('every workbench route starts with collapsed platform navigation', () => {
  const header = readFileSync('components/layout/AppWorkbenchHeader.tsx', 'utf8');

  assert.match(header, /const \[internalSidebarExpanded, setInternalSidebarExpanded\] = useState\(false\)/);
  assert.match(header, /if \(controlledSidebarExpanded === undefined\) setInternalSidebarExpanded\(false\);\s*}, \[activeHref, controlledSidebarExpanded\]\)/s);
  assert.doesNotMatch(header, /hm-platform-sidebar-expanded/);
  assert.doesNotMatch(header, /localStorage\.(?:getItem|setItem)/);
  assert.match(header, /closeSidebar\(false\)/);
});

test('planning center opens focused and keeps navigation and mode chooser mutually exclusive', () => {
  const header = readFileSync('components/layout/AppWorkbenchHeader.tsx', 'utf8');
  const planning = readFileSync('components/PlanningCenterShell.tsx', 'utf8');
  const sample = readFileSync('components/SampleTeamCenter.tsx', 'utf8');

  assert.match(header, /href: '\/weekly-plan-center'.*openModeOnEnter: false/);

  for (const component of [planning, sample]) {
    assert.match(component, /const \[navigationOpen, setNavigationOpen\] = useState\(false\)/);
    assert.match(component, /if \(expanded\) modeDrawer\.close\(false\)/);
    assert.match(component, /if \(!modeDrawer\.open\) setNavigationOpen\(false\)/);
    assert.match(component, /sidebarExpanded=\{navigationOpen\}/);
    assert.match(component, /onSidebarExpandedChange=\{handleNavigationExpandedChange\}/);
    assert.match(component, /openFromSidebar: false/);
    assert.match(component, /onClick=\{toggleModeDrawer\}/);
  }
});
