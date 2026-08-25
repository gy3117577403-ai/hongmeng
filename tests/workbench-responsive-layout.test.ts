import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

test('planning readiness keeps four equal indicators and reflows below tablet width', () => {
  const stylesheet = source('app/weekly-plan-center/planning-center.css');

  assert.match(stylesheet, /\.planning-readiness\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(72px, 1fr\)\)/);
  assert.match(stylesheet, /@media \(max-width: 1240px\)[\s\S]*?\.planning-readiness\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
});

test('notification center fills the workbench instead of centering a fixed 1240px canvas', () => {
  const stylesheet = source('app/workspace/messages/messages-workbench.css');
  const frame = stylesheet.slice(stylesheet.indexOf('.nc-page-frame'), stylesheet.indexOf('.nc-command-bar'));

  assert.match(frame, /width:\s*100%/);
  assert.match(frame, /max-width:\s*none/);
  assert.match(frame, /margin:\s*0/);
  assert.doesNotMatch(frame, /1240px/);
});

test('drawing library keeps a persistent desktop file list and a responsive drawer trigger', () => {
  const component = source('components/DrawingLibraryShell.tsx');
  const stylesheet = source('app/drawing-library/drawing-library-workbench.css');

  assert.match(component, /selectedItem && <aside[\s\S]*?className=\{`drawing-file-panel \$\{filePanelOpen \? 'open' : ''\}`\.trim\(\)\}/);
  assert.match(component, /文件列表<\/span><b>\{activeFiles\.length\}<\/b>/);
  assert.match(stylesheet, /grid-template-columns:\s*minmax\(270px, 292px\) minmax\(0, 1fr\) minmax\(238px, 276px\)/);
  assert.match(stylesheet, /@media \(max-width: 1180px\)[\s\S]*?\.hm-drawing-file-toggle\s*\{[\s\S]*?display:\s*inline-flex/);
});

test('warehouse toolbar contains filters and refresh while related modules live in collaboration', () => {
  const component = source('components/WarehouseManagementShell.tsx');
  const toolbarStart = component.indexOf('<section className="warehouse-toolbar"');
  const toolbarEnd = component.indexOf('</section>', toolbarStart);
  const toolbar = component.slice(toolbarStart, toolbarEnd);
  const collaborationStart = component.indexOf('<aside className="warehouse-collaboration"');
  const collaboration = component.slice(collaborationStart, component.indexOf('</aside>', collaborationStart));

  assert.doesNotMatch(toolbar, /href="\/workspace\/procurement"|href="\/weekly-plan-center"/);
  assert.match(toolbar, /刷新仓库任务/);
  assert.match(collaboration, /warehouse-related-links/);
  assert.match(collaboration, /href="\/workspace\/procurement"/);
  assert.match(collaboration, /href="\/weekly-plan-center"/);
});

test('production command collapses secondary actions and keeps the side panel with view controls', () => {
  const component = source('components/ProductionExecutionCenter.tsx');
  const stylesheet = source('app/production/production-workbench.css');

  assert.match(component, /production-command-secondary/);
  assert.match(component, /production-command-more-trigger/);
  assert.match(component, /production-command-menu hm-production-menu/);
  assert.match(component, /production-toolbar-insight/);
  assert.match(stylesheet, /@media \(max-width: 1680px\)[\s\S]*?\.production-command-secondary\s*\{[\s\S]*?display:\s*none/);
  assert.match(stylesheet, /\.production-week-reconciliation\.aligned\s*\{[\s\S]*?display:\s*none/);
});
