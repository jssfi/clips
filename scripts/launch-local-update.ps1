param(
    [switch]$Production
)

$ErrorActionPreference = 'Stop'
$executable = Join-Path $env:LOCALAPPDATA 'Programs\jss clips\jss clips.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Installed Clips app was not found at: $executable"
}

if ($Production) {
    Remove-Item Env:CLIPS_UPDATE_URL -ErrorAction SilentlyContinue
} else {
    $env:CLIPS_UPDATE_URL = 'http://127.0.0.1:8787'
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $executable -PassThru
Write-Output "Started Clips process $($process.Id)"
