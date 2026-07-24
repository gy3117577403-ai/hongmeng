import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  auditProductionClosure,
} from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';

type CliOptions = {
  json: boolean;
  output: string | null;
  failOnWarning: boolean;
  noFail: boolean;
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

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    output: null,
    failOnWarning: false,
    noFail: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--fail-on-warning') options.failOnWarning = true;
    else if (argument === '--no-fail') options.noFail = true;
    else if (argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output 需要提供本地文件路径');
      options.output = value;
      index += 1;
    } else if (argument.startsWith('--output=')) {
      options.output = argument.slice('--output='.length);
    } else if (argument === '--help' || argument === '-h') {
      console.log([
        '生产闭环只读审计',
        '',
        '用法：npm run audit:production-closure -- [选项]',
        '',
        '  --json              输出完整 JSON',
        '  --output <path>     同时把完整 JSON 写入本地文件',
        '  --fail-on-warning   存在警告时也返回非零退出码',
        '  --no-fail           仅报告问题，不因问题返回非零退出码',
        '',
        '审计只执行数据库读取，不会修改工单、工序、数量、分支或工时记录。',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
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

function printTextResult(result: ReturnType<typeof auditProductionClosure>) {
  console.log('Production closure audit');
  console.log('Mode: READ ONLY');
  console.log(`Result: ${result.passed ? 'PASS' : 'FAIL'}`);
  console.log(
    `Scope: workOrders=${result.counts.workOrders}, routes=${result.counts.routes}, `
    + `steps=${result.counts.steps}, completions=${result.counts.completions}, `
    + `movements=${result.counts.movements}, pools=${result.counts.laborPools}, `
    + `claims=${result.counts.laborClaims}`,
  );
  console.log(`Findings: errors=${result.counts.errors}, warnings=${result.counts.warnings}`);
  if (result.findings.length) {
    console.log('First 100 findings:');
    result.findings.slice(0, 100).forEach((finding, index) => {
      const order = finding.workOrderCode ? ` | ${finding.workOrderCode}` : '';
      console.log(
        `${index + 1}. ${finding.severity.toUpperCase()} | ${finding.code}`
        + `${order} | ${finding.entityType}:${finding.entityId} | ${finding.message}`,
      );
    });
  }
  console.log('READ ONLY: no database rows or production state were changed.');
}

loadLocalEnvironment();
const options = parseArguments(process.argv.slice(2));
const prisma = new PrismaClient();

async function main() {
  const snapshot = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return loadProductionClosureAuditSnapshot(tx);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 60_000,
  });
  const result = auditProductionClosure(snapshot);
  const serialized = jsonText(result);
  if (options.output) {
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${serialized}\n`, 'utf8');
    if (!options.json) console.log(`Audit JSON: ${outputPath}`);
  }
  if (options.json) console.log(serialized);
  else printTextResult(result);
  if (
    !options.noFail
    && (
      result.counts.errors > 0
      || (options.failOnWarning && result.counts.warnings > 0)
    )
  ) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
