param(
  [ValidateSet('prepare','release-prepare','migrate','dev','start','verify')][string]$Stage = 'prepare',
  [string]$Image,
  [string]$ExpectedRevision
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskLabel = 'other-hours-v134147'
$network = 'hm-other-hours-v134147-net'
$postgres = 'hm-other-hours-v134147-postgres'
$minio = 'hm-other-hours-v134147-minio'
$app = 'hm-other-hours-v134147-app'
$database = 'hongmeng_other_hours_v134147'
$envPath = Join-Path $taskRoot '.env.other-hours.local'
$containerEnv = Join-Path $taskRoot '.docker/other-hours.env'
function Docker([string[]]$Arguments) {
  $output = & docker.exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
  return $output
}
Push-Location $taskRoot
try {
  if ($Stage -eq 'prepare') {
    if (Test-Path -LiteralPath $envPath) { throw 'The dedicated runtime already exists; no data will be reset.' }
    if (@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3118,55448,19056,19057 }).Count) { throw 'Dedicated test port is occupied' }
    $existing = @(Docker @('ps','-a','--format','{{.Names}}'))
    if (@($existing | Where-Object { $_ -in $postgres,$minio,$app }).Count) { throw 'Dedicated container name is occupied' }
    New-Item -ItemType Directory -Force .docker,artifacts/other-hours-v134147 | Out-Null
    $dbPassword = 'OtherDb-' + [guid]::NewGuid().ToString('N')
    $storagePassword = 'OtherS3-' + [guid]::NewGuid().ToString('N')
    $envs = [ordered]@{
      DATABASE_URL = "postgresql://otherqa:${dbPassword}@127.0.0.1:55448/${database}?schema=public"
      SESSION_SECRET = 'OtherSession-' + [guid]::NewGuid().ToString('N')
      APP_BASE_URL = 'http://127.0.0.1:3118'
      S3_ENDPOINT = 'http://127.0.0.1:19056'
      S3_PUBLIC_ENDPOINT = 'http://127.0.0.1:19056'
      S3_REGION = 'auto'
      S3_BUCKET = 'other-hours-qa'
      S3_ACCESS_KEY_ID = 'otherqaaccess'
      S3_SECRET_ACCESS_KEY = $storagePassword
      S3_FORCE_PATH_STYLE = 'true'
      DAILY_PLAN_ENABLED = 'true'
      SEED_ADMIN_USERNAME = 'otherqaadmin'
      SEED_ADMIN_PASSWORD = 'OtherAdmin-' + [guid]::NewGuid().ToString('N') + '!9'
      OTHER_HOURS_QA_PASSWORD = 'OtherFixture-' + [guid]::NewGuid().ToString('N') + '!9'
      RUN_DB_INTEGRATION = '1'
    }
    ($envs.Keys | ForEach-Object { "$_=$($envs[$_])" }) | Set-Content -Encoding utf8 -LiteralPath $envPath
    $remote = [ordered]@{}
    foreach ($key in $envs.Keys) { $remote[$key] = $envs[$key] }
    $remote.DATABASE_URL = "postgresql://otherqa:${dbPassword}@${postgres}:5432/${database}?schema=public"
    $remote.S3_ENDPOINT = "http://${minio}:9000"
    ($remote.Keys | ForEach-Object { "$_=$($remote[$_])" }) | Set-Content -Encoding utf8 -LiteralPath $containerEnv
    Docker @('network','create','--label',"codex.task=$taskLabel",'--subnet','10.249.148.0/24',$network) | Out-Null
    Docker @('run','-d','--name',$postgres,'--label',"codex.task=$taskLabel",'--network',$network,'--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1:55448:5432','-e','POSTGRES_USER=otherqa','-e',"POSTGRES_PASSWORD=$dbPassword",'-e',"POSTGRES_DB=$database",'postgres:16-alpine') | Out-Null
    Docker @('run','-d','--name',$minio,'--label',"codex.task=$taskLabel",'--network',$network,'--tmpfs','/data','-p','127.0.0.1:19056:9000','-p','127.0.0.1:19057:9001','-e','MINIO_ROOT_USER=otherqaaccess','-e',"MINIO_ROOT_PASSWORD=$storagePassword",'minio/minio:latest','server','/data','--console-address',':9001') | Out-Null
    Write-Output 'Created isolated PostgreSQL and MinIO for other-hours v1.34.147. Credentials remain in ignored local files.'
    return
  }
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
  }
  if ([uri]$env:DATABASE_URL -eq $null -or $env:DATABASE_URL -notmatch '@127.0.0.1:55448/hongmeng_other_hours_v134147(_release)?\?') { throw 'Unexpected database target' }
  if ($Stage -eq 'release-prepare') {
    if ($env:DATABASE_URL -match '_release\?') { throw 'Clean release database was already prepared; no reset will be performed' }
    Docker @('exec',$postgres,'createdb','-U','otherqa','hongmeng_other_hours_v134147_release') | Out-Null
    foreach ($file in @($envPath,$containerEnv)) {
      $contents = (Get-Content -LiteralPath $file -Raw).Replace('/hongmeng_other_hours_v134147?', '/hongmeng_other_hours_v134147_release?').Replace('S3_BUCKET=other-hours-qa','S3_BUCKET=other-hours-release-qa')
      Set-Content -LiteralPath $file -Value $contents -Encoding utf8
    }
    $env:S3_BUCKET = 'other-hours-release-qa'
    & node -e "const {S3Client,CreateBucketCommand}=require('@aws-sdk/client-s3'); new S3Client({endpoint:process.env.S3_ENDPOINT,region:'auto',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}}).send(new CreateBucketCommand({Bucket:process.env.S3_BUCKET})).catch(e=>{console.error(e.message);process.exitCode=1})"
    if ($LASTEXITCODE -ne 0) { throw 'Clean object storage setup failed' }
    Write-Output 'New empty release database and bucket prepared; image startup will run all migrations.'
    return
  }
  $database = ([uri]$env:DATABASE_URL).AbsolutePath.TrimStart('/')
  if ($Stage -eq 'migrate') {
    & npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
    & node prisma/seed.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap seed failed' }
    & node -e "const {S3Client,CreateBucketCommand,HeadBucketCommand}=require('@aws-sdk/client-s3'); const c=new S3Client({endpoint:process.env.S3_ENDPOINT,region:'auto',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}}); c.send(new CreateBucketCommand({Bucket:process.env.S3_BUCKET})).catch(e=>{if(e.name!=='BucketAlreadyOwnedByYou')throw e}).then(()=>c.send(new HeadBucketCommand({Bucket:process.env.S3_BUCKET}))).catch(e=>{console.error(e.message);process.exitCode=1})"
    if ($LASTEXITCODE -ne 0) { throw 'Object storage setup failed' }
  } elseif ($Stage -eq 'dev') {
    & npm run dev -- --hostname 127.0.0.1 --port 3118
  } elseif ($Stage -eq 'start') {
    if (!$Image -or $Image -notmatch '@sha256:[a-f0-9]{64}$') { throw 'An immutable image digest is required' }
    Docker @('run','-d','--name',$app,'--label',"codex.task=$taskLabel",'--network',$network,'-p','127.0.0.1:3118:3000','--env-file',$containerEnv,$Image) | Out-Null
  } elseif ($Stage -eq 'verify') {
    $health = Invoke-RestMethod 'http://127.0.0.1:3118/api/health'
    $ready = Invoke-RestMethod 'http://127.0.0.1:3118/api/ready'
    $logs = Docker @('logs',$app)
    $inspect = ((Docker @('inspect',$app)) -join "`n" | ConvertFrom-Json)[0]
    if ($inspect.Config.Image -ne $Image) { throw 'Unexpected running image' }
    if ($ExpectedRevision -and $inspect.Config.Labels.'org.opencontainers.image.revision' -ne $ExpectedRevision) { throw 'Unexpected image revision' }
    @{ image=$Image; revision=$ExpectedRevision; health=$health; ready=$ready; database=$database; verifiedAt=(Get-Date).ToString('o') } | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 artifacts/other-hours-v134147/runtime-verification.json
    Write-Output 'Exact other-hours image health, readiness and identity verified.'
  }
} finally { Pop-Location }
