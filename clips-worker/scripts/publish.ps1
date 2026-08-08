param(
    [string]$Version,
    [string]$Bucket,
    [ValidateSet('nightly', 'stable', 'both')]
    [string]$Channel = 'nightly'
)

$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $workerRoot -Parent
$dist = Join-Path $projectRoot 'dist'
$wrangler = Join-Path $workerRoot 'node_modules\.bin\wrangler.cmd'
$envFile = Join-Path $projectRoot '.env'
if (-not $Bucket -and (Test-Path -LiteralPath $envFile)) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*CLIPS_UPDATE_BUCKET\s*=\s*(.+?)\s*$') {
            $Bucket = $Matches[1].Trim('"', "'")
            break
        }
    }
}
if (-not $Bucket) { throw 'CLIPS_UPDATE_BUCKET is missing. Copy .env.example to .env and configure it.' }

& node (Join-Path $projectRoot 'scripts\write-worker-config.js') clips-worker
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the update Worker configuration.' }

if (-not $Version) {
    $Version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
}

$installerName = "jss-clips-update-$Version-x64.exe"
$appPackageName = "jss-clips-app-$Version-x64.zip"
$currentArtifacts = @($installerName, "$installerName.blockmap", $appPackageName)
$files = @(
    @{ Name = $installerName; Type = 'application/octet-stream'; Cache = 'public, max-age=31536000, immutable' },
    @{ Name = "$installerName.blockmap"; Type = 'application/octet-stream'; Cache = 'public, max-age=31536000, immutable' },
    @{ Name = $appPackageName; Type = 'application/zip'; Cache = 'public, max-age=31536000, immutable' },
    @{ Name = 'latest.yml'; Type = 'text/yaml; charset=utf-8'; Cache = 'no-store, max-age=0' },
    @{ Name = 'latest.json'; Type = 'application/json; charset=utf-8'; Cache = 'no-store, max-age=0' }
)

$latest = Get-Content (Join-Path $dist 'latest.yml') -Raw
if ($latest -notmatch "(?m)^version:\s+$([regex]::Escape($Version))\s*$" -or $latest -notmatch [regex]::Escape($installerName)) {
    throw "dist\latest.yml does not describe update $Version."
}
$stagedLatest = Get-Content (Join-Path $dist 'latest.json') -Raw | ConvertFrom-Json
if ($stagedLatest.version -ne $Version -or $stagedLatest.url -ne $appPackageName) {
    throw "dist\latest.json does not describe staged update $Version."
}

Push-Location $workerRoot
try {
  $channels = if ($Channel -eq 'both') { @('nightly', 'stable') } else { @($Channel) }
  foreach ($releaseChannel in $channels) {
    $releasePrefix = if ($releaseChannel -eq 'stable') { 'releases/stable' } else { 'releases' }
    $previousLatest = [System.IO.Path]::GetTempFileName()
    $oldArtifacts = @()
    try {
        & $wrangler r2 object get "$Bucket/$releasePrefix/latest.yml" --file $previousLatest --remote
        if ($LASTEXITCODE -eq 0) {
            $previous = Get-Content -LiteralPath $previousLatest -Raw
            $oldInstallerNames = [regex]::Matches($previous, '(?m)^\s*(?:-\s+url:|path:)\s+([^\s]+)\s*$') |
                ForEach-Object { [System.IO.Path]::GetFileName($_.Groups[1].Value) } |
                Where-Object { $_ -match '^jss-clips-(?:update|setup)-[0-9A-Za-z.-]+-(?:x64|arm64)\.exe$' } |
                Select-Object -Unique
            $oldArtifacts = @($oldInstallerNames | ForEach-Object { $_; "$_.blockmap" })
        }
    } finally {
        Remove-Item -LiteralPath $previousLatest -Force -ErrorAction SilentlyContinue
    }
    $previousStagedLatest = [System.IO.Path]::GetTempFileName()
    try {
        & $wrangler r2 object get "$Bucket/$releasePrefix/latest.json" --file $previousStagedLatest --remote
        if ($LASTEXITCODE -eq 0) {
            $previousStaged = Get-Content -LiteralPath $previousStagedLatest -Raw | ConvertFrom-Json
            if ($previousStaged.url -match '^jss-clips-app-[0-9A-Za-z.-]+-x64\.zip$') {
                $oldArtifacts += [System.IO.Path]::GetFileName($previousStaged.url)
            }
        }
    } finally {
        Remove-Item -LiteralPath $previousStagedLatest -Force -ErrorAction SilentlyContinue
    }

    foreach ($file in $files) {
        $source = Join-Path $dist $file.Name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Missing release artifact: $source"
        }
        Write-Host "Uploading $($file.Name)"
        & $wrangler r2 object put "$Bucket/$releasePrefix/$($file.Name)" `
            --file $source `
            --content-type $file.Type `
            --cache-control $file.Cache `
            --remote
        if ($LASTEXITCODE -ne 0) { throw "Upload failed: $($file.Name)" }
    }

    foreach ($oldArtifact in ($oldArtifacts | Select-Object -Unique)) {
        if ($currentArtifacts -contains $oldArtifact) { continue }
        Write-Host "Removing superseded artifact $oldArtifact"
        & $wrangler r2 object delete "$Bucket/$releasePrefix/$oldArtifact" --remote
        if ($LASTEXITCODE -ne 0) { throw "Cleanup failed: $oldArtifact" }
    }
  }
} finally {
    Pop-Location
}

Write-Host "Published Clips $Version to $Channel channel(s) in R2."
