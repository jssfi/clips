param([string]$Source = '')

if (-not $Source) {
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { $Source = $command.Source }
}
if (-not $Source) {
    throw 'FFmpeg was not found on PATH. Pass its location with -Source.'
}

$ErrorActionPreference = 'Stop'
$destinationDirectory = Join-Path $PSScriptRoot '..\vendor\ffmpeg'
$destination = Join-Path $destinationDirectory 'ffmpeg.exe'

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "FFmpeg was not found at: $Source"
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Copy-Item -LiteralPath $Source -Destination $destination -Force
Write-Host "FFmpeg staged at $destination"
