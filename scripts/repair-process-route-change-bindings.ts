import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import {
  auditLegacyProcessRouteChangeBindings,
  executeLegacyProcessRouteChangeBindingRepairs,
  type LegacyBindingRepairFinding,
  type LegacyBindingRepairReport,
} from '../lib/process-route-change-binding-repair';

type CliOptions = {
  execute: boolean;
  json: boolean;
  changeId?: string;
  actorId?: string;
};

function loadLocalEnvironment() {
  if (process.env.DATABASE_URL || !existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function readValue(args: string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = args[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) {
    const value = argument.slice(prefix.length).trim();
    if (!value) throw new Error(`${name} 需要提供值`);
    return { value, nextIndex: index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要提供值`);
  return { value: value.trim(), nextIndex: index + 1 };
}

function printHelp() {
  console.log([
    '旧现场工艺新增工序错误绑定审计/修复',
    '',
    '用法：',
    '  npm run process-route-bindings:audit -- [选项]',
    '  npm run process-route-bindings:repair -- [选项]',
    '',
    '  --execute             写入可安全修复项（默认不写入）',
    '  --change-id <id>      只检查一条工艺变更',
    '  --actor-id <id>       操作日志用户（可选，必须是已有用户 ID）',
    '  --json                输出完整 JSON',
    '  --help, -h            显示帮助',
    '',
    '安全边界：不修改 archived/published 产品工艺版本；有报工、执行、人工或数量事实时阻断。',
    '对 ACTIVE 污染数据如需更正产品工艺，只生成待工艺复核发布的纠正草稿。',
  ].join('\n'));
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = { execute: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--execute') options.execute = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    } else if (argument === '--change-id' || argument.startsWith('--change-id=')) {
      const parsed = readValue(args, index, '--change-id');
      options.changeId = parsed.value;
      index = parsed.nextIndex;
    } else if (argument === '--actor-id' || argument.startsWith('--actor-id=')) {
      const parsed = readValue(args, index, '--actor-id');
      options.actorId = parsed.value;
      index = parsed.nextIndex;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  if (!options.execute && options.actorId) {
    throw new Error('--actor-id 只能和 --execute 一起使用');
  }
  return options;
}

function jsonText(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item,
    2,
  );
}

function findingLine(finding: LegacyBindingRepairFinding, index: number): string {
  const target = finding.desiredDefinitionName
    ? `${finding.desiredDefinitionName} (${finding.desiredDefinitionId})`
    : '未找到唯一目标定义';
  const blockers = finding.blockers.length ? ` | 阻断=${finding.blockers.join(',')}` : '';
  const result = finding.executed
    ? finding.pendingProductTimePublish ? '已修复，等待发布纠正草稿' : '已修复'
    : finding.mode === 'BLOCKED' ? '已阻断' : '可修复';
  return `${index + 1}. ${result} | ${finding.workOrderCode || finding.workOrderId}`
    + ` | ${finding.requestedName} <= ${finding.pollutedDefinitionName}`
    + ` | 目标=${target} | change=${finding.changeId} | diff=${finding.diffId}${blockers}`;
}

function printTextResult(result: LegacyBindingRepairReport) {
  console.log('旧现场工艺新增工序错误绑定审计/修复');
  console.log(`模式：${result.mode === 'execute' ? '执行修复' : '只读审计（dry-run）'}`);
  console.log(
    `统计：扫描新增工序 diff=${result.scannedInsertDiffs}，受影响=${result.affected}，`
    + `可修复=${result.repairable}，阻断=${result.blocked}，已修复=${result.repaired}，`
    + `待发布纠正草稿=${result.pendingProductTimePublish}`,
  );
  result.findings.forEach((finding, index) => console.log(findingLine(finding, index)));
  if (result.mode === 'dry-run') {
    console.log('只读审计已完成：没有修改数据。确认结果后再使用 --execute。');
  } else if (result.pendingProductTimePublish > 0) {
    console.log('注意：纠正草稿尚未同步到已发布二维码/工单，需由工艺复核后发布。');
  }
}

loadLocalEnvironment();
const options = parseArguments(process.argv.slice(2));
const prisma = new PrismaClient();

async function main() {
  const result = options.execute
    ? await executeLegacyProcessRouteChangeBindingRepairs(prisma, {
        changeId: options.changeId,
        actorId: options.actorId,
      })
    : await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return auditLegacyProcessRouteChangeBindings(tx, { changeId: options.changeId });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 60_000,
      });

  if (options.json) console.log(jsonText(result));
  else printTextResult(result);
  if (result.blocked > 0) process.exitCode = 2;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
