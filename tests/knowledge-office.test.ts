import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateKnowledgeFile, knowledgeFileInfo } from '../lib/knowledge-file-validation';
import { parseKnowledgeArticleInput } from '../lib/knowledge';
import { validateFileContent } from '../lib/validation';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';

const fixture = (type: string) => readFileSync(resolve(import.meta.dirname, 'fixtures/knowledge-office', `knowledge.${type}`));
for (const type of ['xls', 'xlsx', 'doc', 'docx']) {
  test(`knowledge accepts real ${type} content with an empty or generic browser MIME`, () => {
    const body = fixture(type);
    for (const mime of ['', 'application/octet-stream', knowledgeFileInfo(`资料.${type}`, '').mimeType]) {
      assert.equal(validateKnowledgeFile(`资料.${type}`, mime, body.length, body), null);
    }
    assert.equal(knowledgeFileInfo(`资料.${type}`, '').fileType, type);
    assert.ok(validateFileContent(`资料.${type}`, '', body.length, body), 'unrelated upload endpoints must retain their format restrictions');
  });
}
test('knowledge rejects renamed, truncated, mismatched and empty office files', () => {
  const xlsx = fixture('xlsx'), xls = fixture('xls'), doc = fixture('doc');
  assert.ok(validateKnowledgeFile('wrong.docx', '', xlsx.length, xlsx));
  assert.ok(validateKnowledgeFile('wrong.doc', '', xls.length, xls));
  assert.ok(validateKnowledgeFile('wrong.xls', '', doc.length, doc));
  assert.ok(validateKnowledgeFile('fake.xlsx', '', 4, Buffer.from('text')));
  assert.ok(validateKnowledgeFile('empty.doc', '', 0, Buffer.alloc(0)));
  assert.ok(validateKnowledgeFile('cut.xlsx', '', 12, xlsx.subarray(0, 12)));
  assert.ok(validateKnowledgeFile('mismatch.xlsx', '', xlsx.length + 1, xlsx));
});
test('file-only knowledge requires a verified attachment, not a claimed attachment id', () => {
  const input = { title: '文件知识', content: '', category: 'general', status: 'published', attachmentIds: ['claimed-id'] };
  assert.equal(parseKnowledgeArticleInput(input).errors.length, 1);
  assert.deepEqual(parseKnowledgeArticleInput(input, false, 1).errors, []);
  assert.equal(parseKnowledgeArticleInput(input, false, 1).data.content, '');
});
test('knowledge uploads use existing knowledge rights for administrators, editors and readers', () => {
  const admin = resolveAccessContext([{ profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }]);
  const configured = (level: 'READ' | 'COLLABORATE') => resolveAccessContext([
    { profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' },
    { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: `MODULE:knowledge:${level}` },
  ]);
  for (const actor of [admin, configured('COLLABORATE')]) {
    assert.equal(canAccessAppRoute(actor, '/workspace/knowledge'), true);
    for (const path of ['/api/knowledge/attachments/upload', '/api/knowledge/articles', '/api/knowledge/articles/id/attachments/upload']) assert.equal(canAccessApiRoute(actor, path, 'POST'), true);
    assert.equal(canAccessApiRoute(actor, '/api/knowledge/attachments/id', 'DELETE'), true);
  }
  assert.equal(canAccessApiRoute(configured('READ'), '/api/knowledge/attachments/upload', 'GET'), true);
  assert.equal(canAccessApiRoute(configured('READ'), '/api/knowledge/attachments/upload', 'POST'), false);
  assert.equal(canAccessApiRoute(configured('READ'), '/api/knowledge/attachments/id', 'DELETE'), false);
  assert.equal(canAccessApiRoute(configured('COLLABORATE'), '/api/users', 'POST'), false);
});
