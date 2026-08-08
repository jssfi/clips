param([string]$Source = '')

if (-not $Source) {
    $staged = Join-Path $PSScriptRoot '..\vendor\ffmpeg\ffmpeg.exe'
    if (Test-Path -LiteralPath $staged -PathType Leaf) {
        Write-Host "FFmpeg is already staged at $staged"
        return
    }
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { $Source = $command.Source }
}
if (-not $Source) {
    throw 'FFmpeg was not found. Run npm run setup:prerequisites or pass -Source.'
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
