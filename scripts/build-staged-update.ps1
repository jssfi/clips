param(
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $Version) {
    $Version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
}

$source = Join-Path $projectRoot 'dist\staged\win-unpacked'
$sevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
$fileName = "jss-clips-app-$Version-x64.zip"
$archive = Join-Path $projectRoot "dist\$fileName"
$metadataPath = Join-Path $projectRoot 'dist\latest.json'

if (-not (Test-Path -LiteralPath (Join-Path $source 'jss clips.exe') -PathType Leaf)) {
    throw "Staged application was not found at: $source"
}
if (-not (Test-Path -LiteralPath $sevenZip -PathType Leaf)) {
    throw "7-Zip was not found at: $sevenZip"
}

Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
Push-Location $source
try {
    & $sevenZip a -tzip -mx=6 $archive '.\*'
    if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}

$stream = [IO.File]::OpenRead($archive)
try {
    $algorithm = [Security.Cryptography.SHA512]::Create()
    try {
        $hash = [Convert]::ToBase64String($algorithm.ComputeHash($stream))
    } finally {
        $algorithm.Dispose()
    }
} finally {
    $stream.Dispose()
}

$item = Get-Item -LiteralPath $archive
$metadata = [ordered]@{
    version = $Version
    url = $fileName
    sha512 = $hash
    size = $item.Length
    releaseDate = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
[IO.File]::WriteAllText($metadataPath, "$metadata`n", [Text.UTF8Encoding]::new($false))
& node (Join-Path $projectRoot 'scripts\sign-update-metadata.js') $metadataPath
if ($LASTEXITCODE -ne 0) { throw 'Could not sign staged update metadata.' }
Write-Host "Built staged update $fileName ($($item.Length) bytes)."
