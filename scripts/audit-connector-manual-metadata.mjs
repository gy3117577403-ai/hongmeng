import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

const GENERIC_MANUFACTURERS = new Set([
  '组装说明', '组装说明书', '操作说明', '产品说明', '目录', '说明书', '装配说明',
].map(value => normalize(value)));
const VALID_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

loadEnvFile();
const prisma = new PrismaClient();

function loadEnvFile() {
  const file = existsSync('.env') ? '.env' : '';
  if (!file) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

function addFinding(findings, kind, manual, detail) {
  findings.push({ kind, id: manual.id, title: manual.title || '(空标题)', detail });
}

async function main() {
  const manuals = await prisma.connectorAssemblyManual.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      manufacturer: true,
      versions: {
        where: { deletedAt: null },
        select: {
          id: true,
          revision: true,
          isLatest: true,
          pageCount: true,
          assets: {
            where: { deletedAt: null },
            select: { id: true, mimeType: true, originalName: true },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const findings = [];
  const summary = {
    activeManuals: manuals.length,
    genericManufacturer: 0,
    emptyTitle: 0,
    noVersion: 0,
    noPageCount: 0,
    noAsset: 0,
    multipleLatest: 0,
    duplicateRevision: 0,
    invalidMime: 0,
  };

  for (const manual of manuals) {
    if (GENERIC_MANUFACTURERS.has(normalize(manual.manufacturer))) {
      summary.genericManufacturer += 1;
      addFinding(findings, '制造商为通用词', manual, manual.manufacturer || '');
    }
    if (!String(manual.title || '').trim()) {
      summary.emptyTitle += 1;
      addFinding(findings, '空标题', manual, 'title 为空');
    }
    if (!manual.versions.length) {
      summary.noVersion += 1;
      addFinding(findings, '无版本', manual, '没有有效版本');
      continue;
    }
    const latestCount = manual.versions.filter(version => version.isLatest).length;
    if (latestCount > 1) {
      summary.multipleLatest += 1;
      addFinding(findings, '多个 latest', manual, `${latestCount} 个有效版本标记为 latest`);
    }
    const seenRevisions = new Set();
    for (const version of manual.versions) {
      if (!version.pageCount || version.pageCount < 1) {
        summary.noPageCount += 1;
        addFinding(findings, '无页数', manual, `版本 ${version.revision || '(空版本)'}`);
      }
      if (!version.assets.length) {
        summary.noAsset += 1;
        addFinding(findings, '无资产', manual, `版本 ${version.revision || '(空版本)'}`);
      }
      const revisionKey = normalize(version.revision);
      if (seenRevisions.has(revisionKey)) {
        summary.duplicateRevision += 1;
        addFinding(findings, '版本重复', manual, `版本 ${version.revision || '(空版本)'}`);
      }
      seenRevisions.add(revisionKey);
      for (const asset of version.assets) {
        if (!VALID_MIME_TYPES.has(String(asset.mimeType || '').toLowerCase())) {
          summary.invalidMime += 1;
          addFinding(findings, '资产 MIME 异常', manual, `${asset.originalName} (${asset.mimeType || '空 MIME'})`);
        }
      }
    }
  }

  console.log('Connector assembly manual metadata audit');
  console.log('Mode: DRY RUN / READ ONLY');
  Object.entries(summary).forEach(([key, value]) => console.log(`${key}: ${value}`));
  console.log(`totalFindings: ${findings.length}`);
  console.log('First 50 findings:');
  findings.slice(0, 50).forEach((item, index) => console.log(`${index + 1}. ${item.kind} | ${item.title} | ${item.id} | ${item.detail}`));
  console.log('READ ONLY: no database rows, bindings, versions, assets or S3 objects were changed.');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
