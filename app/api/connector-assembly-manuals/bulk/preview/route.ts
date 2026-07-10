import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseBulkManualCandidate } from '@/lib/connector-manual-bulk-import';
import { prisma } from '@/lib/prisma';
import type { ConnectorManualBulkAction, ConnectorManualBulkPreviewRowDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function key(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function importRevision(base: string, index: number): string {
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return `${base || '待识别'}-${suffix}-${index + 1}`.slice(0, 80);
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { files?: unknown[] };
    const inputs = Array.isArray(body.files) ? body.files.slice(0, 1000) : [];
    if (!inputs.length) return NextResponse.json({ ok: false, error: '请选择要预览的说明书文件' }, { status: 400 });
    const parsed = inputs.map(parseBulkManualCandidate);
    const assetHashes = unique(parsed.flatMap(row => row.candidate.assets.map(asset => asset.hash)).filter(Boolean));
    const modelNames = unique(parsed.flatMap(row => row.candidate.modelCandidates).map(key).filter(Boolean));
    const [existingAssets, existingManuals, parameters] = await Promise.all([
      assetHashes.length
        ? prisma.connectorAssemblyManualAsset.findMany({
          where: { fileHash: { in: assetHashes }, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } },
          select: { fileHash: true, originalName: true, version: { select: { manualId: true, revision: true, manual: { select: { title: true } } } } },
        })
        : [],
      prisma.connectorAssemblyManual.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          versions: { where: { deletedAt: null }, select: { id: true, revision: true }, orderBy: { createdAt: 'desc' } },
        },
      }),
      modelNames.length
        ? prisma.connectorParameter.findMany({ where: { deletedAt: null, model: { not: null } }, select: { id: true, model: true } })
        : [],
    ]);
    const hashes = new Map(existingAssets.map(asset => [asset.fileHash || '', asset]));
    const manualsByTitle = new Map(existingManuals.map(manual => [key(manual.title), manual]));
    const parametersByModel = new Map<string, Array<{ id: string; model: string }>>();
    for (const parameter of parameters) {
      const model = String(parameter.model || '').trim();
      if (!model || !modelNames.includes(key(model))) continue;
      const current = parametersByModel.get(key(model)) || [];
      current.push({ id: parameter.id, model });
      parametersByModel.set(key(model), current);
    }
    const selectedTitles = new Map<string, Array<{ revision: string; index: number }>>();
    const rows: ConnectorManualBulkPreviewRowDTO[] = parsed.map(({ candidate, errors }, index) => {
      const warnings = [...candidate.warnings];
      const matchingAssets = candidate.assets.map(asset => hashes.get(asset.hash)).filter(Boolean);
      const allAssetsDuplicate = candidate.assets.length > 0 && matchingAssets.length === candidate.assets.length;
      const existingManual = manualsByTitle.get(key(candidate.defaultTitle));
      const revision = candidate.revisionCandidate;
      const existingVersion = revision ? existingManual?.versions.find(version => key(version.revision) === key(revision)) : undefined;
      const selected = selectedTitles.get(key(candidate.defaultTitle)) || [];
      const selectedRevision = revision ? selected.find(item => key(item.revision) === key(revision)) : undefined;
      let action: ConnectorManualBulkAction = 'create_manual';
      let duplicateReason = '';
      let conflictReason = '';
      let matchedManualId = existingManual?.id || '';
      let suggestedVersionAction = '新建说明书和首版';
      let suggestedRevision = revision || '待识别';
      if (errors.length) {
        action = 'invalid';
        warnings.push(...errors);
        suggestedVersionAction = '修正文件后重试';
      } else if (allAssetsDuplicate) {
        action = 'duplicate';
        duplicateReason = matchingAssets.map(asset => `${asset?.version.manual.title} · ${asset?.version.revision}`).join('；');
        suggestedVersionAction = '默认跳过完全相同文件';
      } else if (existingVersion || selectedRevision) {
        action = 'conflict';
        conflictReason = `名称与版本 ${revision || '未识别'} 相同，但 SHA-256 不同`;
        suggestedRevision = importRevision(revision, index);
        suggestedVersionAction = '修改为新版本号后导入，或跳过';
      } else if (existingManual || selected.length) {
        if (revision) {
          action = 'create_version';
          suggestedVersionAction = '作为已有说明书的新版本';
        } else {
          action = 'manual_review';
          suggestedRevision = importRevision('', index);
          suggestedVersionAction = '确认版本后可作为新版本';
        }
      }
      selected.push({ revision: suggestedRevision, index });
      selectedTitles.set(key(candidate.defaultTitle), selected);
      const parameterMatches: ConnectorManualBulkPreviewRowDTO['parameterMatches'] = [];
      const uniqueParameterIds: string[] = [];
      for (const model of candidate.modelCandidates) {
        const matches = parametersByModel.get(key(model)) || [];
        if (matches.length === 1) {
          parameterMatches.push({ ...matches[0], matchType: 'unique_match' });
          uniqueParameterIds.push(matches[0].id);
        } else if (matches.length > 1) {
          parameterMatches.push(...matches.map(match => ({ ...match, matchType: 'multiple_matches' as const })));
        }
      }
      if (candidate.parseFailed) warnings.unshift('自动识别失败，但不阻塞按文件名导入');
      return {
        ...candidate,
        warnings: unique(warnings),
        action,
        matchedManualId,
        matchedManualTitle: existingManual?.title || '',
        suggestedVersionAction,
        duplicateReason,
        conflictReason,
        suggestedRevision,
        parameterMatches,
        uniqueParameterIds: unique(uniqueParameterIds),
      };
    });
    const count = (action: ConnectorManualBulkAction) => rows.filter(row => row.action === action).length;
    const summary = {
      totalFiles: rows.length,
      readyCount: count('create_manual') + count('create_version'),
      createManualCount: count('create_manual'),
      versionCandidateCount: count('create_version'),
      duplicateCount: count('duplicate'),
      conflictCount: count('conflict'),
      invalidCount: count('invalid'),
      manualReviewCount: count('manual_review'),
    };
    return NextResponse.json({ ok: true, summary, rows });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '批量说明书预览失败' }, { status: 500 });
  }
}
