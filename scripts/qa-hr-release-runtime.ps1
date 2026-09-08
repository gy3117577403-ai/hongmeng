param(
  [ValidateSet('prepare', 'verify')][string]$Stage = 'prepare',
  [ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ImageDigest,
  [ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedRevision,
  [ValidatePattern('^hongmeng_hr_v134139_release(?:_[a-z0-9]+)?$')][string]$DatabaseName = 'hongmeng_hr_v134139_release',
  [ValidatePattern('^hm-hr-v134139-release-app(?:-[a-z0-9]+)?$')][string]$AppName = 'hm-hr-v134139-release-app'
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskLabel = 'hr-directory-v134139-release'
$networkName = 'hm-hr-v134139-release-net'
$postgresName = 'hm-hr-v134139-release-postgres'
$minioName = 'hm-hr-v134139-release-minio'
$baseUrl = 'http://127.0.0.1:3109'
$expectedVersion = 'v1.34.139'
$hostEnvPath = Join-Path $taskRoot '.env.hr-release.local'
$containerEnvPath = Join-Path $taskRoot '.docker/hr-v134139-release.env'
$evidenceDirectory = Join-Path $taskRoot 'artifacts/hr-directory-v134139'

function Invoke-TaskDocker {
  param([Parameter(Mandatory)][string[]]$DockerArguments)
  $dockerOutput = & docker @DockerArguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($dockerOutput -join "`n") }
  return $dockerOutput
}

function Save-TaskEnvironment {
  param([string]$Destination, [System.Collections.IDictionary]$Values)
  $environmentLines = foreach ($environmentKey in $Values.Keys) { "$environmentKey=$($Values[$environmentKey])" }
  Set-Content -LiteralPath $Destination -Value $environmentLines -Encoding utf8
}

function Read-TaskEnvironment {
  param([string]$Source)
  $values = @{}
  foreach ($environmentLine in (Get-Content -LiteralPath $Source)) {
    if (!$environmentLine -or $environmentLine.StartsWith('#')) { continue }
    $environmentParts = $environmentLine.Split('=', 2)
    $environmentKey = $environmentParts[0]
    if ($environmentParts.Count -ne 2 -or $environmentKey -notmatch '^[A-Z][A-Z0-9_]*$' -or $values.ContainsKey($environmentKey)) {
      throw 'Malformed or duplicate entry in private task environment file.'
    }
    $values[$environmentKey] = $environmentParts[1]
  }
  return $values
}

function Assert-TaskDatabaseTargets {
  param([System.Collections.IDictionary]$HostEnvironment, [System.Collections.IDictionary]$ContainerEnvironment)
  try {
    $hostDatabase = [Uri]$HostEnvironment.DATABASE_URL
    $containerDatabase = [Uri]$ContainerEnvironment.DATABASE_URL
  } catch {
    throw 'Invalid DATABASE_URL in private task environment; connection values are withheld.'
  }
  if (!$hostDatabase.IsAbsoluteUri -or !$containerDatabase.IsAbsoluteUri -or
    $hostDatabase.Scheme -ne 'postgresql' -or $containerDatabase.Scheme -ne 'postgresql' -or
    $hostDatabase.Host -ne '127.0.0.1' -or $hostDatabase.Port -ne 55439 -or
    $containerDatabase.Host -ne $postgresName -or $containerDatabase.Port -ne 5432 -or
    $hostDatabase.AbsolutePath -ne "/$databaseName" -or $containerDatabase.AbsolutePath -ne "/$databaseName" -or
    $hostDatabase.Query -ne '?schema=public' -or $containerDatabase.Query -ne '?schema=public' -or
    $hostDatabase.UserInfo.Split(':', 2)[0] -ne 'hrqa' -or $hostDatabase.UserInfo -ne $containerDatabase.UserInfo) {
    throw 'Dedicated release database configuration does not match DatabaseName and the assigned PostgreSQL endpoints.'
  }
}

function Invoke-TaskNode {
  param([Parameter(Mandatory)][string[]]$NodeArguments)
  # Override ambient process values with this task's file; never inherit another database or storage endpoint.
  $previousValues = @{}
  try {
    $taskEnvironment = Read-TaskEnvironment $hostEnvPath
    foreach ($environmentKey in $taskEnvironment.Keys) {
      $previousValues[$environmentKey] = [Environment]::GetEnvironmentVariable($environmentKey, 'Process')
      [Environment]::SetEnvironmentVariable($environmentKey, $taskEnvironment[$environmentKey], 'Process')
    }
    & node @NodeArguments
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated release Node verification command failed.' }
  } finally {
    foreach ($environmentKey in $previousValues.Keys) {
      [Environment]::SetEnvironmentVariable($environmentKey, $previousValues[$environmentKey], 'Process')
    }
  }
}

Push-Location $taskRoot
try {
  if ($Stage -eq 'prepare') {
    $occupiedPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
      $_.LocalPort -in 3109, 55439, 19040, 19041
    })
    if ($occupiedPorts.Count) { throw 'One of the dedicated release runtime ports is already occupied.' }
    $existingNames = @(Invoke-TaskDocker @('ps', '-a', '--format', '{{.Names}}'))
    if (@($existingNames | Where-Object { $_ -in $postgresName, $minioName, $appName }).Count) {
      throw 'A dedicated release runtime container already exists. This script will not reset or reuse its data.'
    }
    if (Test-Path -LiteralPath $hostEnvPath) { throw 'The release environment file already exists; it will not be overwritten.' }
    New-Item -ItemType Directory -Path (Join-Path $taskRoot '.docker') -Force | Out-Null
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    $databasePassword = 'HomeDb-' + [guid]::NewGuid().ToString('N')
    $storageSecret = 'HomeS3-' + [guid]::NewGuid().ToString('N')
    $sessionSecret = 'HomeSession-' + [guid]::NewGuid().ToString('N')
    $bootstrapPassword = 'QaSeed-' + [guid]::NewGuid().ToString('N')
    $fixturePassword = 'HomeFixture-' + [guid]::NewGuid().ToString('N')
    $hostEnvironment = [ordered]@{
      APP_BASE_URL = $baseUrl
      HR_QA_BASE = $baseUrl
      DATABASE_URL = "postgresql://hrqa:$databasePassword@127.0.0.1:55439/${databaseName}?schema=public"
      SESSION_SECRET = $sessionSecret
      SEED_ADMIN_USERNAME = 'hrbootstrap'
      SEED_ADMIN_PASSWORD = $bootstrapPassword
      S3_ENDPOINT = 'http://127.0.0.1:19040'
      S3_PUBLIC_ENDPOINT = 'http://127.0.0.1:19040'
      S3_REGION = 'auto'
      S3_BUCKET = 'workorder-resources'
      S3_ACCESS_KEY_ID = 'hrqaaccess'
      S3_SECRET_ACCESS_KEY = $storageSecret
      S3_FORCE_PATH_STYLE = 'true'
      DAILY_PLAN_ENABLED = 'true'
      HR_DIRECTORY_QA_ALLOW = 'disposable-hr-runtime'
      HR_DIRECTORY_QA_PASSWORD = $fixturePassword
      EXPECTED_APP_VERSION = $expectedVersion
      HR_QA_EVIDENCE = 'artifacts/hr-directory-v134139/release-runtime-smoke.json'
    }
    Save-TaskEnvironment $hostEnvPath $hostEnvironment
    $containerEnvironment = [ordered]@{}
    foreach ($environmentKey in $hostEnvironment.Keys) { $containerEnvironment[$environmentKey] = $hostEnvironment[$environmentKey] }
    $containerEnvironment.DATABASE_URL = "postgresql://hrqa:$databasePassword@${postgresName}:5432/${databaseName}?schema=public"
    $containerEnvironment.S3_ENDPOINT = "http://${minioName}:9000"
    Save-TaskEnvironment $containerEnvPath $containerEnvironment
    $existingNetworks = @(Invoke-TaskDocker @('network', 'ls', '--format', '{{.Name}}'))
    if ($networkName -in $existingNetworks) {
      $networkOwner = Invoke-TaskDocker @('network', 'inspect', '--format', '{{index .Labels "codex.task"}}', $networkName)
      if ($networkOwner -ne $taskLabel) { throw 'The intended network name belongs to another task.' }
    } else {
      Invoke-TaskDocker @('network', 'create', '--label', "codex.task=$taskLabel", '--subnet', '10.249.139.0/24', $networkName) | Out-Null
    }
    Invoke-TaskDocker @('run', '-d', '--name', $postgresName, '--label', "codex.task=$taskLabel", '--network', $networkName,
      '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1:55439:5432', '-e', 'POSTGRES_USER=hrqa',
      '-e', "POSTGRES_PASSWORD=$databasePassword", '-e', "POSTGRES_DB=$databaseName", 'postgres:16-alpine') | Out-Null
    Invoke-TaskDocker @('run', '-d', '--name', $minioName, '--label', "codex.task=$taskLabel", '--network', $networkName,
      '--tmpfs', '/data', '-p', '127.0.0.1:19040:9000', '-p', '127.0.0.1:19041:9001',
      '-e', 'MINIO_ROOT_USER=hrqaaccess', '-e', "MINIO_ROOT_PASSWORD=$storageSecret",
      'minio/minio:latest', 'server', '/data', '--address', ':9000', '--console-address', ':9001') | Out-Null
    $bucketScript = @'
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'auto', forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
(async () => { await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET })); })().catch(e => { console.error(e.message); process.exitCode = 1; });
'@
    Invoke-TaskNode @('-e', $bucketScript)
    Invoke-TaskDocker @('exec', $postgresName, 'pg_isready', '-U', 'hrqa', '-d', $databaseName) | Out-Null
    Write-Output 'Dedicated release PostgreSQL and MinIO are ready; the database remains empty for actual-image migration acceptance.'
    Write-Output "Reserved application: $baseUrl; PostgreSQL: 55439; MinIO: 19040/19041."
    Write-Output "Private test credentials stored in $hostEnvPath"
    return
  }

  if (!$ImageDigest -or !$ExpectedRevision) { throw 'verify requires the published ImageDigest and complete ExpectedRevision.' }
  if (!(Test-Path -LiteralPath $hostEnvPath) -or !(Test-Path -LiteralPath $containerEnvPath)) { throw 'Run prepare first.' }
  Assert-TaskDatabaseTargets (Read-TaskEnvironment $hostEnvPath) (Read-TaskEnvironment $containerEnvPath)
  foreach ($containerName in @($postgresName, $minioName)) {
    $containerOwner = Invoke-TaskDocker @('inspect', '--format', '{{index .Config.Labels "codex.task"}}', $containerName)
    if ($containerOwner -ne $taskLabel) { throw 'Prepared service ownership does not match this task.' }
  }
  $databasePort = @(Invoke-TaskDocker @('port', $postgresName, '5432/tcp'))
  if ($databasePort.Count -ne 1 -or $databasePort[0] -ne '127.0.0.1:55439') {
    throw 'The host fixture port is not assigned to the dedicated PostgreSQL container.'
  }
  $publicTableCount = Invoke-TaskDocker @('exec', $postgresName, 'psql', '-U', 'hrqa', '-d', $databaseName, '-Atc',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
  if ([int]$publicTableCount -ne 0) { throw 'The release database is no longer empty. Do not claim a fresh migration run or reset its data.' }
  $pinnedImage = "ghcr.dockerproxy.net/gy3117577403-ai/hongmeng@$ImageDigest"
  $anonymousConfig = Join-Path $taskRoot ('.docker/home-anonymous-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $anonymousConfig | Out-Null
  Invoke-TaskDocker @('--config', $anonymousConfig, 'pull', $pinnedImage) | Write-Output
  $imageData = ((Invoke-TaskDocker @('image', 'inspect', $pinnedImage)) -join "`n" | ConvertFrom-Json)[0]
  if ($imageData.Os -ne 'linux' -or $imageData.Architecture -ne 'amd64' -or
    $imageData.Config.Labels.'org.opencontainers.image.version' -ne $expectedVersion -or
    $imageData.Config.Labels.'org.opencontainers.image.revision' -ne $ExpectedRevision) {
    throw 'Pulled image identity does not match the accepted release.'
  }
  $hostEnvLines = @(Get-Content -LiteralPath $hostEnvPath | Where-Object { !($_.StartsWith('EXPECTED_APP_REVISION=')) })
  Set-Content -LiteralPath $hostEnvPath -Value ($hostEnvLines + "EXPECTED_APP_REVISION=$ExpectedRevision") -Encoding utf8
  Invoke-TaskDocker @('run', '-d', '--name', $appName, '--label', "codex.task=$taskLabel", '--network', $networkName,
    '-p', '127.0.0.1:3109:3000', '--env-file', $containerEnvPath, $pinnedImage) | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
      $readiness = Invoke-RestMethod -Uri "$baseUrl/api/ready" -TimeoutSec 3
      if ($readiness.ok -and $readiness.database.ok -and $readiness.storage.ok) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
  }
  if (!$ready) { throw 'Actual release image did not become ready. Containers have been retained for diagnosis.' }
  if ($readiness.app.version -ne $expectedVersion -or $readiness.app.revision -ne $ExpectedRevision) { throw 'Runtime app identity mismatch.' }
  Invoke-TaskNode @('--import', 'tsx', 'scripts/qa-hr-directory-seed.ts')
  Invoke-TaskNode @('scripts/smoke-hr-directory.mjs')
  $migrationCount = Invoke-TaskDocker @('exec', $postgresName, 'psql', '-U', 'hrqa', '-d', $databaseName, '-Atc',
    'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  $runtimeEvidence = [ordered]@{
    verifiedAt = [DateTime]::UtcNow.ToString('o'); version = $expectedVersion; revision = $ExpectedRevision
    digest = $ImageDigest; imageId = $imageData.Id; platform = 'linux/amd64'; anonymousPull = $true
    baseUrl = $baseUrl; migrations = [int]$migrationCount; database = $databaseName
    postgres = $postgresName; minio = $minioName; app = $appName
    productionSwitched = $false
  }
  $runtimeEvidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'release-container-verification.json') -Encoding utf8
  $runtimeEvidence | ConvertTo-Json | Write-Output
} finally {
  Pop-Location
}

