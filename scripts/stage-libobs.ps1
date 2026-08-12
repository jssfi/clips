param(
    [string]$Source = (Join-Path $PSScriptRoot '..\vendor\obs-studio')
)

$ErrorActionPreference = 'Stop'
$vendorRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\vendor'))
$destination = [System.IO.Path]::GetFullPath((Join-Path $vendorRoot 'libobs'))
if (-not $destination.StartsWith($vendorRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) `
    -or [System.IO.Path]::GetFileName($destination) -ne 'libobs') {
    throw "Refusing to replace an unexpected libobs destination: $destination"
}
$sourceRoot = [System.IO.Path]::GetFullPath($Source)
$sourceBin = Join-Path $sourceRoot 'bin\64bit'
$sourcePlugins = Join-Path $sourceRoot 'obs-plugins\64bit'
$sourceData = Join-Path $sourceRoot 'data'
if (-not (Test-Path -LiteralPath (Join-Path $sourceBin 'obs.dll'))) {
    throw "The OBS 31.1.2 libobs runtime was not found at: $sourceRoot"
}

if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
}
$bin = Join-Path $destination 'bin\64bit'
$plugins = Join-Path $destination 'obs-plugins\64bit'
$data = Join-Path $destination 'data'
New-Item -ItemType Directory -Force -Path $bin, $plugins, $data, (Join-Path $data 'obs-plugins') | Out-Null

$binFiles = @(
    'obs.dll',
    'libobs-d3d11.dll',
    'libobs-winrt.dll',
    'avcodec-61.dll',
    'avdevice-61.dll',
    'avfilter-10.dll',
    'avformat-61.dll',
    'avutil-59.dll',
    'swresample-5.dll',
    'swscale-8.dll',
    'w32-pthreads.dll',
    'zlib.dll',
    'libcurl.dll',
    'librist.dll',
    'srt.dll',
    'libx264-164.dll',
    'obs-ffmpeg-mux.exe',
    'obs-amf-test.exe',
    'obs-nvenc-test.exe',
    'obs-qsv-test.exe'
)
foreach ($name in $binFiles) {
    $source = Join-Path $sourceBin $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required libobs runtime file is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $bin $name)
}

$pluginNames = @(
    'win-capture',
    'win-wasapi',
    'obs-ffmpeg',
    'obs-x264',
    'obs-nvenc',
    'obs-qsv11',
    'coreaudio-encoder',
    'obs-filters',
    'nv-filters'
)
foreach ($name in $pluginNames) {
    $sourceDll = Join-Path $sourcePlugins "$name.dll"
    if (-not (Test-Path -LiteralPath $sourceDll -PathType Leaf)) {
        throw "Required libobs plugin is missing: $sourceDll"
    }
    Copy-Item -LiteralPath $sourceDll -Destination (Join-Path $plugins "$name.dll")
    $sourcePluginData = Join-Path $sourceData "obs-plugins\$name"
    if (Test-Path -LiteralPath $sourcePluginData -PathType Container) {
        Copy-Item -LiteralPath $sourcePluginData -Destination (Join-Path $data "obs-plugins\$name") -Recurse -Force
    }
}

Copy-Item -LiteralPath (Join-Path $sourceData 'libobs') -Destination $data -Recurse -Force
Write-Host "Staged private libobs runtime at $destination"
