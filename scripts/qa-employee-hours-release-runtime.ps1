param(
  [ValidateSet('prepare', 'verify')][string]$Stage = 'prepare',
  [ValidateSet('primary', 'second')][string]$Instance = 'primary',
  [ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ImageDigest,
  [ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedRevision,
  [ValidatePattern('^hongmeng_employee_hours_v134142_release(?:_[a-z0-9]+)?$')][string]$DatabaseName = 'hongmeng_employee_hours_v134142_release',
  [ValidatePattern('^hm-employee-hours-v134142-release-app(?:-[a-z0-9]+)?$')][string]$AppName = 'hm-employee-hours-v134142-release-app'
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$instanceSuffix = if ($Instance -eq 'second') { '-second' } else { '' }
if ($Instance -eq 'second') {
  if (!$PSBoundParameters.ContainsKey('DatabaseName')) { $DatabaseName = 'hongmeng_employee_hours_v134142_release_second' }
  if (!$PSBoundParameters.ContainsKey('AppName')) { $AppName = 'hm-employee-hours-v134142-release-app-second' }
  if ($DatabaseName -ne 'hongmeng_employee_hours_v134142_release_second' -or $AppName -ne 'hm-employee-hours-v134142-release-app-second') {
    throw 'Second instance requires its assigned database and application container names.'
  }
} elseif ($DatabaseName -eq 'hongmeng_employee_hours_v134142_release_second' -or $AppName.EndsWith('-second')) {
  throw 'Names reserved for the second instance require -Instance second.'
}
$appPort = if ($Instance -eq 'second') { 3114 } else { 3113 }
$postgresPort = if ($Instance -eq 'second') { 55443 } else { 55442 }
$minioPort = if ($Instance -eq 'second') { 19048 } else { 19046 }
$minioConsolePort = $minioPort + 1
$networkSubnet = if ($Instance -eq 'second') { '10.249.143.0/24' } else { '10.249.142.0/24' }
$taskLabel = "employee-hours-v134142-release$instanceSuffix"
$networkName = "hm-employee-hours-v134142-release-net$instanceSuffix"
$postgresName = "hm-employee-hours-v134142-release-postgres$instanceSuffix"
$minioName = "hm-employee-hours-v134142-release-minio$instanceSuffix"
$baseUrl = "http://127.0.0.1:$appPort"
$expectedVersion = 'v1.34.143'
$hostEnvPath = Join-Path $taskRoot ".env.hours-release$instanceSuffix.local"
$containerEnvPath = Join-Path $taskRoot ".docker/employee-hours-v134142-release$instanceSuffix.env"
$fixtureFile = ".docker/employee-hours-fixture-release$instanceSuffix.json"
$smokeEvidenceFile = "artifacts/employee-hours-v134142/release-runtime-smoke$instanceSuffix.json"
$containerEvidenceFile = "release-container-verification$instanceSuffix.json"
$evidenceDirectory = Join-Path $taskRoot 'artifacts/employee-hours-v134142'

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
    $hostDatabase.Host -ne '127.0.0.1' -or $hostDatabase.Port -ne $postgresPort -or
    $containerDatabase.Host -ne $postgresName -or $containerDatabase.Port -ne 5432 -or
    $hostDatabase.AbsolutePath -ne "/$databaseName" -or $containerDatabase.AbsolutePath -ne "/$databaseName" -or
    $hostDatabase.Query -ne '?schema=public' -or $containerDatabase.Query -ne '?schema=public' -or
    $hostDatabase.UserInfo.Split(':', 2)[0] -ne 'hoursqa' -or $hostDatabase.UserInfo -ne $containerDatabase.UserInfo) {
    throw 'Dedicated release database configuration does not match DatabaseName and the assigned PostgreSQL endpoints.'
  }
  if ($HostEnvironment.HOURS_QA_BASE -ne $baseUrl -or $HostEnvironment.APP_BASE_URL -ne $baseUrl -or
    $ContainerEnvironment.HOURS_QA_BASE -ne $baseUrl -or $ContainerEnvironment.APP_BASE_URL -ne $baseUrl -or
    $HostEnvironment.S3_ENDPOINT -ne "http://127.0.0.1:$minioPort" -or
    $HostEnvironment.S3_PUBLIC_ENDPOINT -ne "http://127.0.0.1:$minioPort" -or
    $ContainerEnvironment.S3_ENDPOINT -ne "http://${minioName}:9000" -or
    $ContainerEnvironment.S3_PUBLIC_ENDPOINT -ne "http://127.0.0.1:$minioPort") {
    throw 'Dedicated release HTTP or storage endpoints do not match the selected instance.'
  }
}

function Invoke-TaskNode {
  param([Parameter(Mandatory)][string[]]$NodeArguments)
  # Override ambient process values with this task's file; never inherit another database or storage endpoint.
  $previousValues = @{}
  try {
    $taskEnvironment = Read-TaskEnvironment $hostEnvPath
    # Older primary environment files predate fixture isolation. Override only
    # non-secret task outputs so ambient dev or other-instance paths cannot leak in.
    $taskEnvironment.HOURS_QA_FIXTURE_FILE = $fixtureFile
    $taskEnvironment.HOURS_QA_EVIDENCE = $smokeEvidenceFile
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
      $_.LocalPort -in $appPort, $postgresPort, $minioPort, $minioConsolePort
    })
    if ($occupiedPorts.Count) { throw 'One of the dedicated release runtime ports is already occupied.' }
    $existingNames = @(Invoke-TaskDocker @('ps', '-a', '--format', '{{.Names}}'))
    if (@($existingNames | Where-Object { $_ -in $postgresName, $minioName, $appName }).Count) {
      throw 'A dedicated release runtime container already exists. This script will not reset or reuse its data.'
    }
    if ((Test-Path -LiteralPath $hostEnvPath) -or (Test-Path -LiteralPath $containerEnvPath) -or
      (Test-Path -LiteralPath (Join-Path $taskRoot $fixtureFile))) {
      throw 'A release environment or fixture file already exists; it will not be overwritten.'
    }
    New-Item -ItemType Directory -Path (Join-Path $taskRoot '.docker') -Force | Out-Null
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    $databasePassword = 'HomeDb-' + [guid]::NewGuid().ToString('N')
    $storageSecret = 'HomeS3-' + [guid]::NewGuid().ToString('N')
    $sessionSecret = 'HomeSession-' + [guid]::NewGuid().ToString('N')
    $bootstrapPassword = 'QaSeed-' + [guid]::NewGuid().ToString('N')
    $fixturePassword = 'HomeFixture-' + [guid]::NewGuid().ToString('N')
    $hostEnvironment = [ordered]@{
      APP_BASE_URL = $baseUrl
      HOURS_QA_BASE = $baseUrl
      DATABASE_URL = "postgresql://hoursqa:$databasePassword@127.0.0.1:${postgresPort}/${databaseName}?schema=public"
      SESSION_SECRET = $sessionSecret
      SEED_ADMIN_USERNAME = 'hoursbootstrap'
      SEED_ADMIN_PASSWORD = $bootstrapPassword
      S3_ENDPOINT = "http://127.0.0.1:$minioPort"
      S3_PUBLIC_ENDPOINT = "http://127.0.0.1:$minioPort"
      S3_REGION = 'auto'
      S3_BUCKET = 'workorder-resources'
      S3_ACCESS_KEY_ID = 'hoursqaaccess'
      S3_SECRET_ACCESS_KEY = $storageSecret
      S3_FORCE_PATH_STYLE = 'true'
      DAILY_PLAN_ENABLED = 'true'
      HOURS_QA_ALLOW = 'disposable-hours-runtime'
      HOURS_QA_CHECK_BOOTSTRAP = '1'
      HOURS_QA_PASSWORD = $fixturePassword
      HOURS_QA_FIXTURE_FILE = $fixtureFile
      EXPECTED_APP_VERSION = $expectedVersion
      HOURS_QA_EVIDENCE = $smokeEvidenceFile
    }
    Save-TaskEnvironment $hostEnvPath $hostEnvironment
    $containerEnvironment = [ordered]@{}
    foreach ($environmentKey in $hostEnvironment.Keys) { $containerEnvironment[$environmentKey] = $hostEnvironment[$environmentKey] }
    $containerEnvironment.DATABASE_URL = "postgresql://hoursqa:$databasePassword@${postgresName}:5432/${databaseName}?schema=public"
    $containerEnvironment.S3_ENDPOINT = "http://${minioName}:9000"
    Save-TaskEnvironment $containerEnvPath $containerEnvironment
    $existingNetworks = @(Invoke-TaskDocker @('network', 'ls', '--format', '{{.Name}}'))
    if ($networkName -in $existingNetworks) {
      $networkOwner = Invoke-TaskDocker @('network', 'inspect', '--format', '{{index .Labels "codex.task"}}', $networkName)
      if ($networkOwner -ne $taskLabel) { throw 'The intended network name belongs to another task.' }
    } else {
      Invoke-TaskDocker @('network', 'create', '--label', "codex.task=$taskLabel", '--subnet', $networkSubnet, $networkName) | Out-Null
    }
    Invoke-TaskDocker @('run', '-d', '--name', $postgresName, '--label', "codex.task=$taskLabel", '--network', $networkName,
      '--tmpfs', '/var/lib/postgresql/data', '-p', "127.0.0.1:${postgresPort}:5432", '-e', 'POSTGRES_USER=hoursqa',
      '-e', "POSTGRES_PASSWORD=$databasePassword", '-e', "POSTGRES_DB=$databaseName", 'postgres:16-alpine') | Out-Null
    Invoke-TaskDocker @('run', '-d', '--name', $minioName, '--label', "codex.task=$taskLabel", '--network', $networkName,
      '--tmpfs', '/data', '-p', "127.0.0.1:${minioPort}:9000", '-p', "127.0.0.1:${minioConsolePort}:9001",
      '-e', 'MINIO_ROOT_USER=hoursqaaccess', '-e', "MINIO_ROOT_PASSWORD=$storageSecret",
      'minio/minio:latest', 'server', '/data', '--address', ':9000', '--console-address', ':9001') | Out-Null
    $servicesReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        Invoke-TaskDocker @('exec', $postgresName, 'pg_isready', '-U', 'hoursqa', '-d', $databaseName) | Out-Null
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$minioPort/minio/health/ready" -TimeoutSec 2
        $servicesReady = $true
        break
      } catch { Start-Sleep -Seconds 1 }
    }
    if (!$servicesReady) { throw 'Dedicated PostgreSQL or MinIO did not become ready; containers retained for diagnosis.' }
    $bucketScript = @'
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'auto', forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
(async () => { await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET })); })().catch(e => { console.error(e.message); process.exitCode = 1; });
'@
    Invoke-TaskNode @('-e', $bucketScript)
    Invoke-TaskDocker @('exec', $postgresName, 'pg_isready', '-U', 'hoursqa', '-d', $databaseName) | Out-Null
    Write-Output 'Dedicated release PostgreSQL and MinIO are ready; the database remains empty for actual-image migration acceptance.'
    Write-Output "Reserved application: $baseUrl; PostgreSQL: $postgresPort; MinIO: $minioPort/$minioConsolePort."
    Write-Output "Private test credentials stored in $hostEnvPath"
    return
  }

  if (!$ImageDigest -or !$ExpectedRevision) { throw 'verify requires the published ImageDigest and complete ExpectedRevision.' }
  if (!(Test-Path -LiteralPath $hostEnvPath) -or !(Test-Path -LiteralPath $containerEnvPath)) { throw 'Run prepare first.' }
  if ($Instance -eq 'second') {
    $primaryEvidencePath = Join-Path $evidenceDirectory 'release-container-verification.json'
    if (!(Test-Path -LiteralPath $primaryEvidencePath)) { throw 'Second verification requires successful primary verification evidence first.' }
    $primaryEvidence = Get-Content -LiteralPath $primaryEvidencePath -Raw | ConvertFrom-Json
    if ($primaryEvidence.digest -ne $ImageDigest -or $primaryEvidence.revision -ne $ExpectedRevision -or
      $primaryEvidence.version -ne $expectedVersion -or $primaryEvidence.database -eq $databaseName -or
      $primaryEvidence.postgres -eq $postgresName -or $primaryEvidence.minio -eq $minioName) {
      throw 'Second verification must use the accepted primary digest and revision with independent database and storage services.'
    }
  }
  # Fixture creation calls repository services, so the seed must correspond to
  # the same source revision as the immutable application image under test.
  $checkoutRevision = & git rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $checkoutRevision -ne $ExpectedRevision) { throw 'Fixture checkout revision does not match the accepted image revision.' }
  & git diff --quiet HEAD -- lib prisma types scripts/qa-employee-hours-seed.ts package.json package-lock.json
  if ($LASTEXITCODE -ne 0) { throw 'Fixture service sources have local changes; commit the accepted source before image verification.' }
  Assert-TaskDatabaseTargets (Read-TaskEnvironment $hostEnvPath) (Read-TaskEnvironment $containerEnvPath)
  foreach ($containerName in @($postgresName, $minioName)) {
    $containerOwner = Invoke-TaskDocker @('inspect', '--format', '{{index .Config.Labels "codex.task"}}', $containerName)
    if ($containerOwner -ne $taskLabel) { throw 'Prepared service ownership does not match this task.' }
  }
  $databasePort = @(Invoke-TaskDocker @('port', $postgresName, '5432/tcp'))
  if ($databasePort.Count -ne 1 -or $databasePort[0] -ne "127.0.0.1:$postgresPort") {
    throw 'The host fixture port is not assigned to the dedicated PostgreSQL container.'
  }
  $storagePort = @(Invoke-TaskDocker @('port', $minioName, '9000/tcp'))
  if ($storagePort.Count -ne 1 -or $storagePort[0] -ne "127.0.0.1:$minioPort") {
    throw 'The object storage port is not assigned to the dedicated MinIO container.'
  }
  $networkData = ((Invoke-TaskDocker @('network', 'inspect', $networkName)) -join "`n" | ConvertFrom-Json)[0]
  if ($networkData.Labels.'codex.task' -ne $taskLabel -or @($networkData.IPAM.Config).Count -ne 1 -or
    $networkData.IPAM.Config[0].Subnet -ne $networkSubnet) {
    throw 'The runtime network owner or subnet does not match the selected instance.'
  }
  $publicTableCount = Invoke-TaskDocker @('exec', $postgresName, 'psql', '-U', 'hoursqa', '-d', $databaseName, '-Atc',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
  if ([int]$publicTableCount -ne 0) { throw 'The release database is no longer empty. Do not claim a fresh migration run or reset its data.' }
  $pinnedImage = "ghcr.dockerproxy.net/gy3117577403-ai/hongmeng@$ImageDigest"
  $anonymousConfig = Join-Path $taskRoot (".docker/employee-hours-anonymous$instanceSuffix-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $anonymousConfig | Out-Null
  Invoke-TaskDocker @('--config', $anonymousConfig, 'pull', $pinnedImage) | Write-Output
  $imageData = ((Invoke-TaskDocker @('image', 'inspect', $pinnedImage)) -join "`n" | ConvertFrom-Json)[0]
  if ($imageData.Os -ne 'linux' -or $imageData.Architecture -ne 'amd64' -or
    $imageData.Config.Labels.'org.opencontainers.image.version' -ne $expectedVersion -or
    $imageData.Config.Labels.'org.opencontainers.image.revision' -ne $ExpectedRevision) {
    throw 'Pulled image identity does not match the accepted release.'
  }
  foreach ($environmentPath in @($hostEnvPath, $containerEnvPath)) {
    $environmentLines = @(Get-Content -LiteralPath $environmentPath | Where-Object {
      $_ -notmatch '^(EXPECTED_APP_REVISION|HOURS_QA_FIXTURE_FILE|HOURS_QA_EVIDENCE)='
    })
    Set-Content -LiteralPath $environmentPath -Value ($environmentLines + @(
      "EXPECTED_APP_REVISION=$ExpectedRevision", "HOURS_QA_FIXTURE_FILE=$fixtureFile", "HOURS_QA_EVIDENCE=$smokeEvidenceFile"
    )) -Encoding utf8
  }
  Invoke-TaskDocker @('run', '-d', '--name', $appName, '--label', "codex.task=$taskLabel", '--network', $networkName,
    '-p', "127.0.0.1:${appPort}:3000", '--env-file', $containerEnvPath, $pinnedImage) | Out-Null
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
  Invoke-TaskNode @('--import', 'tsx', 'scripts/qa-employee-hours-seed.ts')
  Invoke-TaskNode @('scripts/smoke-employee-hours.mjs')
  $migrationCount = Invoke-TaskDocker @('exec', $postgresName, 'psql', '-U', 'hoursqa', '-d', $databaseName, '-Atc',
    'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  $runtimeEvidence = [ordered]@{
    verifiedAt = [DateTime]::UtcNow.ToString('o'); version = $expectedVersion; revision = $ExpectedRevision
    digest = $ImageDigest; imageId = $imageData.Id; platform = 'linux/amd64'; anonymousPull = $true
    instance = $Instance; baseUrl = $baseUrl; migrations = [int]$migrationCount; database = $databaseName
    fixtureFile = $fixtureFile; smokeEvidenceFile = $smokeEvidenceFile; network = $networkName; subnet = $networkSubnet
    postgres = $postgresName; minio = $minioName; app = $appName
    productionSwitched = $false
  }
  $runtimeEvidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDirectory $containerEvidenceFile) -Encoding utf8
  $runtimeEvidence | ConvertTo-Json | Write-Output
} finally {
  Pop-Location
}
