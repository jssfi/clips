param([string]$Source = '')

$ErrorActionPreference = 'Stop'
$destinationDirectory = Join-Path $PSScriptRoot '..\vendor\mpv'
$destination = Join-Path $destinationDirectory 'mpv.exe'

if (-not $Source) {
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        Write-Host "MPV is already staged at $destination"
        return
    }
    $command = Get-Command mpv.exe -ErrorAction SilentlyContinue
    if ($command) { $Source = $command.Source }
}

if (-not $Source -or -not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw 'MPV was not found. Run npm run setup:prerequisites or pass -Source.'
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Copy-Item -LiteralPath $Source -Destination $destination -Force
Write-Host "MPV staged at $destination"
