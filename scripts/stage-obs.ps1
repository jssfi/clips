param([string]$Source = '')

$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '..\vendor\obs-studio'

if (-not $Source) {
    $installed = 'C:\Program Files\obs-studio'
    if (Test-Path -LiteralPath (Join-Path $destination 'bin\64bit\obs64.exe')) {
        Write-Host "OBS Studio is already staged at $destination"
        return
    } elseif (Test-Path -LiteralPath (Join-Path $installed 'bin\64bit\obs64.exe')) {
        $Source = $installed
    }
}

if (-not $Source -or -not (Test-Path -LiteralPath (Join-Path $Source 'bin\64bit\obs64.exe'))) {
    throw 'OBS Studio was not found. Run npm run setup:prerequisites or pass -Source.'
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
$result = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
    "`"$Source`"",
    "`"$destination`"",
    '/E',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/R:2',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
) -Wait -PassThru -NoNewWindow

if ($result.ExitCode -ge 8) {
    throw "Failed to stage OBS Studio. Robocopy exited with code $($result.ExitCode)."
}

Write-Host "OBS Studio staged at $destination"
