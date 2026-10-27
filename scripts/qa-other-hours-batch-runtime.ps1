param([ValidateSet('prepare','migrate','test','seed','build','dev','serve','smoke')][string]$Stage = 'prepare')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = Join-Path $taskRoot '.env.other-hours-batch.local'
Push-Location $taskRoot
try {
  if ($Stage -eq 'prepare') {
    if (Test-Path -LiteralPath $envPath) { throw 'Isolated runtime already prepared; no reset will be performed' }
    if (@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3187,55487,19087 }).Count) { throw 'Dedicated test port is occupied' }
    $existing = @(docker ps -a --format '{{.Names}}')
    if (@($existing | Where-Object { $_ -in 'hm-other-batch-287-db','hm-other-batch-287-s3' }).Count) { throw 'Dedicated container name is occupied' }
    $dbPassword = 'OtherDb-' + [guid]::NewGuid().ToString('N')
    $storagePassword = 'OtherS3-' + [guid]::NewGuid().ToString('N')
    $envs = [ordered]@{
      DATABASE_URL = "postgresql://postgres:${dbPassword}@127.0.0.1:55487/hongmeng_ci?schema=public"
      SESSION_SECRET = 'OtherSession-' + [guid]::NewGuid().ToString('N')
      APP_BASE_URL = 'http://127.0.0.1:3187'
      SMOKE_BASE_URL = 'http://127.0.0.1:3187'
      S3_ENDPOINT = 'http://127.0.0.1:19087'
      S3_PUBLIC_ENDPOINT = 'http://127.0.0.1:19087'
      S3_REGION = 'auto'
      S3_BUCKET = 'other-hours-batch-qa'
      S3_ACCESS_KEY_ID = 'otherbatchqa'
      S3_SECRET_ACCESS_KEY = $storagePassword
      S3_FORCE_PATH_STYLE = 'true'
      DAILY_PLAN_ENABLED = 'true'
      OTHER_HOURS_QA_PASSWORD = 'OtherFixture-' + [guid]::NewGuid().ToString('N') + '!9'
      OTHER_HOURS_QA_ALLOW = 'disposable-other-hours-batch'
      OTHER_HOURS_QA_OUTPUT = 'output/playwright/other-hours-batch-local'
      RUN_DB_INTEGRATION = '1'
      CI = 'true'
    }
    ($envs.Keys | ForEach-Object { "$_=$($envs[$_])" }) | Set-Content -Encoding utf8 -LiteralPath $envPath
    docker run -d --name hm-other-batch-287-db --label codex.task=other-hours-batch-287 --tmpfs /var/lib/postgresql/data -p 127.0.0.1:55487:5432 -e POSTGRES_USER=postgres -e "POSTGRES_PASSWORD=$dbPassword" -e POSTGRES_DB=hongmeng_ci postgres:16-alpine
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL creation failed' }
    docker run -d --name hm-other-batch-287-s3 --label codex.task=other-hours-batch-287 --tmpfs /data -p 127.0.0.1:19087:9000 -e MINIO_ROOT_USER=otherbatchqa -e "MINIO_ROOT_PASSWORD=$storagePassword" minio/minio:latest server /data
    if ($LASTEXITCODE -ne 0) { throw 'Isolated storage creation failed' }
    Write-Output 'Created only the dedicated batch-approval database and storage. Private credentials remain in the ignored environment file.'
    return
  }
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
  }
  if ($env:DATABASE_URL -notmatch '@127.0.0.1:55487/hongmeng_ci\?') { throw 'Unexpected database target' }
  if ($Stage -eq 'migrate') { & npx.cmd prisma migrate deploy }
  elseif ($Stage -eq 'test') { & npx.cmd tsx --test --test-concurrency=1 tests/other-work-hours-integration.test.ts tests/other-work-batch-integration.test.ts tests/employee-attainment-policy-integration.test.ts }
  elseif ($Stage -eq 'seed') { & npx.cmd tsx scripts/seed-other-hours-batch-qa.ts }
  elseif ($Stage -eq 'build') { $env:RUN_DB_INTEGRATION='0'; $env:NODE_OPTIONS='--max-old-space-size=8192'; & npm.cmd run build }
  elseif ($Stage -eq 'dev') { & node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3187 }
  elseif ($Stage -eq 'serve') { & node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3187 }
  elseif ($Stage -eq 'smoke') { & node scripts/smoke-other-hours-batch-browser.mjs }
  if ($LASTEXITCODE -ne 0) { throw "Stage $Stage failed" }
} finally { Pop-Location }
