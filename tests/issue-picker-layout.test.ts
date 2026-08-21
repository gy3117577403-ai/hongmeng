import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { calculatePickerPopoverLayout } from '../lib/issue-picker-layout';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('employee picker flips upward and stays inside the right console boundary', () => {
  const layout = calculatePickerPopoverLayout({
    anchor: { top: 720, right: 1340, bottom: 754, left: 1150, width: 190 },
    boundary: { top: 180, right: 1354, bottom: 812, left: 1048 },
    viewportWidth: 1366,
    viewportHeight: 900,
    preferredMinWidth: 290,
  });

  assert.equal(layout.side, 'up');
  assert.equal(layout.top, null);
  assert.ok(layout.bottom !== null && layout.bottom > 0);
  assert.ok(layout.left >= 1056);
  assert.ok(layout.left + layout.width <= 1346);
  assert.ok(layout.maxHeight <= 330);
});

test('employee picker opens downward when there is enough visible room', () => {
  const layout = calculatePickerPopoverLayout({
    anchor: { top: 260, right: 1340, bottom: 294, left: 1150, width: 190 },
    boundary: { top: 180, right: 1354, bottom: 812, left: 1048 },
    viewportWidth: 1366,
    viewportHeight: 900,
    preferredMinWidth: 290,
  });

  assert.equal(layout.side, 'down');
  assert.equal(layout.top, 300);
  assert.equal(layout.bottom, null);
  assert.equal(layout.maxHeight, 330);
});

test('employee search inputs suppress browser identity and address autofill', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/issues/IssuePickers.tsx'), 'utf8');
  const styles = readFileSync(resolve(repositoryRoot, 'app/workspace/issues/issues-workbench.css'), 'utf8');
  assert.equal((source.match(/type="search"/g) || []).length >= 2, true);
  assert.equal((source.match(/autoComplete="one-time-code"/g) || []).length, 2);
  assert.equal((source.match(/data-form-type="other"/g) || []).length, 2);
  assert.equal((source.match(/data-lpignore="true"/g) || []).length, 2);
  assert.match(source, /window\.addEventListener\('scroll', updatePosition, true\)/);
  assert.match(styles, /\.issue-picker-popover\.adaptive \{ box-sizing: border-box;/);
  assert.match(styles, /\.issue-picker-popover\.employees\.adaptive \{ min-width: 0; \}/);
});
