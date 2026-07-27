import assert from 'node:assert/strict';
import test from 'node:test';
import {
  responsibilityCollaborationPrototype,
  responsibilityMatrix,
  responsibilityPeople,
  responsibilityWorkItems,
} from '../lib/responsibility-collaboration';

const expectedPeople = [
  '林波',
  '方荣霞',
  '赵容',
  '邓彬',
  '王著美',
  '李鸿胜',
  '张豪',
  '郭维贵',
  '王红丽',
  '高源',
  '倪金丹',
  '刘菲',
  '胡军瑞',
  '王伟红',
  '贾改真',
  '韦林',
  '销售岗位待配置',
];

test('prototype contains every confirmed person and the sales placeholder', () => {
  assert.deepEqual(
    [...responsibilityPeople.map(person => person.name)].sort((first, second) => first.localeCompare(second, 'zh-CN')),
    [...expectedPeople].sort((first, second) => first.localeCompare(second, 'zh-CN')),
  );
  assert.equal(new Set(responsibilityPeople.map(person => person.id)).size, responsibilityPeople.length);
  assert.equal(responsibilityPeople.find(person => person.id === 'sales-open')?.status, 'unconfigured');
});

test('responsibility matrix demonstrates missing owner, conflict and overdue escalation', () => {
  const warnings = new Set(responsibilityMatrix.map(item => item.warning).filter(Boolean));
  assert.equal(warnings.has('missing-owner'), true);
  assert.equal(warnings.has('responsibility-conflict'), true);
  assert.equal(warnings.has('overdue'), true);
  assert.equal(responsibilityMatrix.some(item => item.warning === 'missing-owner' && item.ownerIds.length === 0), true);
  assert.equal(responsibilityMatrix.every(item => item.flow.length >= 3), true);
});

test('all responsibility and work links stay inside existing application routes', () => {
  const routes = [...responsibilityMatrix.map(item => item.route), ...responsibilityWorkItems.map(item => item.route)];
  assert.equal(routes.every(route => route.startsWith('/') && !route.startsWith('//')), true);
});

test('all people referenced by responsibility and work records exist', () => {
  const personIds = new Set(responsibilityPeople.map(person => person.id));
  const referencedIds = new Set<string>();
  responsibilityMatrix.forEach(item => {
    [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds]
      .forEach(id => referencedIds.add(id));
    item.flow.forEach(step => step.personIds.forEach(id => referencedIds.add(id)));
  });
  responsibilityWorkItems.forEach(item => {
    referencedIds.add(item.ownerId);
    referencedIds.add(item.nextPersonId);
    item.participantIds.forEach(id => referencedIds.add(id));
  });
  assert.deepEqual([...referencedIds].filter(id => !personIds.has(id)), []);
});

test('permission suggestions are explicitly preview-only behind a stable adapter contract', () => {
  assert.equal(responsibilityCollaborationPrototype.contractVersion, 'responsibility-collaboration.v1');
  assert.equal(responsibilityCollaborationPrototype.source, 'prototype');
  assert.equal(responsibilityCollaborationPrototype.permissionPreviewOnly, true);
});
