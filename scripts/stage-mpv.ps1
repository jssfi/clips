param(
    [string]$Source = (Join-Path $env:USERPROFILE 'Downloads\mpv-x86_64-20250912-git-d837c43\mpv.exe')
)

$ErrorActionPreference = 'Stop'
$destinationDirectory = Join-Path $PSScriptRoot '..\vendor\mpv'
$destination = Join-Path $destinationDirectory 'mpv.exe'

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "MPV was not found at: $Source. Pass -Source with the path to the mpv.exe that should ship with Clips."
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Copy-Item -LiteralPath $Source -Destination $destination -Force
Write-Host "MPV staged at $destination"
