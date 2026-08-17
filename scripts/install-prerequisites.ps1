[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$SkipToolInstall,
    [switch]$SkipNativeBuild,
    [string]$DownloadRoot = (Join-Path ([System.IO.Path]::GetTempPath()) 'clips-prerequisites-v1')
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
    throw 'Clips development is currently supported only on Windows.'
}
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'The current Clips build requires 64-bit Windows on x64.'
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vendorRoot = Join-Path $projectRoot 'vendor'
$downloadRoot = [System.IO.Path]::GetFullPath($DownloadRoot)
$obsSdkCommit = '7778070cbd8e4689d91d90068091ced467c5fdef'

function Find-VsDevCmd {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
        $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($LASTEXITCODE -eq 0 -and $installation) {
            $candidate = Join-Path ($installation | Select-Object -First 1) 'Common7\Tools\VsDevCmd.bat'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
    }
    @(
        'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat',
        'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat'
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

$vsDevCmd = Find-VsDevCmd

$downloads = @{
    Obs = @{
        Url = 'https://github.com/obsproject/obs-studio/releases/download/31.1.2/OBS-Studio-31.1.2-Windows-x64.zip'
        File = 'OBS-Studio-31.1.2-Windows-x64.zip'
        Sha256 = '9513cd402936593a6a5500da5d2bd49e6cd04dce05509c7b7f48dd25c391d2d8'
    }
    Ffmpeg = @{
        Url = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260808/ffmpeg-x86_64-git-f944afd04.7z'
        File = 'ffmpeg-x86_64-git-f944afd04.7z'
        Sha256 = 'e1d690a062e40cd914a904eed3c32cd7f1db4372c4fa56995eb9f6b1886a37d9'
    }
    Mpv = @{
        Url = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260808/mpv-x86_64-20260808-git-dd5d17d328.7z'
        File = 'mpv-x86_64-20260808-git-dd5d17d328.7z'
        Sha256 = '790991761f84dd0e22bd6762436726a7b88d35236a26db2e74c028e65e9e58d3'
    }
    Libmpv = @{
        Url = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260808/mpv-dev-x86_64-20260808-git-dd5d17d328.7z'
        File = 'mpv-dev-x86_64-20260808-git-dd5d17d328.7z'
        Sha256 = '8d87d569fe4f18d3e490ab6d82fa7b9610c9411a270eabad107167520891f1b1'
    }
}

function Install-PackageIfMissing {
    param([string]$Command, [string]$Id, [string[]]$ExtraArguments = @())
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if ($SkipToolInstall) { throw "$Command is required. Rerun without -SkipToolInstall to install it." }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "WinGet is required to install $Command automatically. Install App Installer from Microsoft Store and retry."
    }
    Write-Host "Installing $Id..."
    & winget.exe install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements @ExtraArguments
    if ($LASTEXITCODE -ne 0) { throw "WinGet failed to install $Id (exit $LASTEXITCODE)." }
}

Install-PackageIfMissing -Command 'git.exe' -Id 'Git.Git'
Install-PackageIfMissing -Command 'node.exe' -Id 'OpenJS.NodeJS.LTS'
$git = @(
    (Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'C:\Program Files\Git\cmd\git.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $git) { throw 'Git was installed but could not be located. Open a new terminal and retry.' }
$bundledSevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
if (-not (Get-Command 7z.exe -ErrorAction SilentlyContinue) `
    -and -not (Test-Path -LiteralPath 'C:\Program Files\7-Zip\7z.exe' -PathType Leaf) `
    -and -not (Test-Path -LiteralPath $bundledSevenZip -PathType Leaf)) {
    Install-PackageIfMissing -Command '7z.exe' -Id '7zip.7zip'
}
if (-not $vsDevCmd) {
    if ($SkipToolInstall) { throw 'Visual Studio 2022 Build Tools with the C++ workload is required.' }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'WinGet is required to install Visual Studio Build Tools automatically.'
    }
    Write-Host 'Installing Visual Studio 2022 Build Tools and the C++ workload...'
    & winget.exe install --id Microsoft.VisualStudio.2022.BuildTools --exact --silent `
        --accept-package-agreements --accept-source-agreements `
        --override '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if ($LASTEXITCODE -ne 0) { throw "Visual Studio Build Tools installation failed (exit $LASTEXITCODE)." }
    $vsDevCmd = Find-VsDevCmd
    if (-not $vsDevCmd) { throw 'Visual Studio was installed but VsDevCmd.bat could not be located.' }
}

$sevenZip = @(
    (Get-Command 7z.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'C:\Program Files\7-Zip\7z.exe',
    $bundledSevenZip
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $sevenZip) { throw '7-Zip was installed but could not be located. Open a new terminal and retry.' }

New-Item -ItemType Directory -Path $vendorRoot, $downloadRoot -Force | Out-Null

function Get-VerifiedDownload {
    param([hashtable]$Artifact)
    $target = Join-Path $downloadRoot $Artifact.File
    if (-not (Test-Path -LiteralPath $target -PathType Leaf) `
        -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.Sha256) {
        Write-Host "Downloading $($Artifact.File)..."
        $partial = "$target.partial"
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source --fail --location --retry 5 --retry-all-errors --retry-delay 2 `
                --silent --show-error --output $partial $Artifact.Url
            if ($LASTEXITCODE -ne 0) { throw "Download failed for $($Artifact.File) (curl exit $LASTEXITCODE)." }
        } else {
            for ($attempt = 1; $attempt -le 3; $attempt += 1) {
                try {
                    Invoke-WebRequest -Uri $Artifact.Url -OutFile $partial -UseBasicParsing
                    break
                } catch {
                    if ($attempt -eq 3) { throw }
                    Start-Sleep -Seconds (2 * $attempt)
                }
            }
        }
        Move-Item -LiteralPath $partial -Destination $target -Force
    }
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Artifact.Sha256) {
        Remove-Item -LiteralPath $target -Force
        throw "Checksum verification failed for $($Artifact.File)."
    }
    return $target
}

function Reset-Directory {
    param([string]$Target)
    $fullTarget = [System.IO.Path]::GetFullPath($Target)
    if (-not $fullTarget.StartsWith($vendorRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace a directory outside vendor: $fullTarget"
    }
    if (Test-Path -LiteralPath $fullTarget) { Remove-Item -LiteralPath $fullTarget -Recurse -Force }
    New-Item -ItemType Directory -Path $fullTarget -Force | Out-Null
    return $fullTarget
}

$obsDestination = Join-Path $vendorRoot 'obs-studio'
if ($Force -or -not (Test-Path -LiteralPath (Join-Path $obsDestination 'bin\64bit\obs64.exe'))) {
    $archive = Get-VerifiedDownload $downloads.Obs
    $extract = Reset-Directory (Join-Path $vendorRoot '.obs-download')
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    $obsExecutable = Get-ChildItem -LiteralPath $extract -Recurse -Filter obs64.exe | Select-Object -First 1
    if (-not $obsExecutable -or $obsExecutable.Directory.Name -ne '64bit' -or $obsExecutable.Directory.Parent.Name -ne 'bin') {
        throw 'The OBS archive did not contain the expected bin\64bit\obs64.exe layout.'
    }
    $obsRoot = $obsExecutable.Directory.Parent.Parent.FullName
    Reset-Directory $obsDestination | Out-Null
    Copy-Item -Path (Join-Path $obsRoot '*') -Destination $obsDestination -Recurse -Force
    Remove-Item -LiteralPath $extract -Recurse -Force
}

function Expand-SevenZipRuntime {
    param([hashtable]$Artifact, [string]$Destination, [string]$RequiredFile)
    if (-not $Force -and (Test-Path -LiteralPath (Join-Path $Destination $RequiredFile) -PathType Leaf)) { return }
    $archive = Get-VerifiedDownload $Artifact
    Reset-Directory $Destination | Out-Null
    & $sevenZip x -y "-o$Destination" $archive | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $Destination $RequiredFile) -PathType Leaf)) {
        throw "$($Artifact.File) did not contain the expected $RequiredFile."
    }
}

Expand-SevenZipRuntime $downloads.Ffmpeg (Join-Path $vendorRoot 'ffmpeg') 'ffmpeg.exe'
Expand-SevenZipRuntime $downloads.Mpv (Join-Path $vendorRoot 'mpv') 'mpv.exe'
$libmpvRoot = Join-Path $vendorRoot 'libmpv'
$libmpvArchive = Get-VerifiedDownload $downloads.Libmpv
$libmpvDev = Join-Path $libmpvRoot 'dev'
if ($Force -or -not (Test-Path -LiteralPath (Join-Path $libmpvDev 'libmpv-2.dll') -PathType Leaf)) {
    Reset-Directory $libmpvDev | Out-Null
    & $sevenZip x -y "-o$libmpvDev" $libmpvArchive | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $libmpvDev 'include\mpv\client.h'))) {
        throw 'The libmpv archive did not contain the expected development files.'
    }
    Copy-Item -LiteralPath $libmpvArchive -Destination (Join-Path $libmpvRoot 'libmpv-dev.7z') -Force
}

$obsSdk = Join-Path $vendorRoot 'obs-sdk'
if ($Force -and (Test-Path -LiteralPath $obsSdk)) { Remove-Item -LiteralPath $obsSdk -Recurse -Force }
if (Test-Path -LiteralPath (Join-Path $obsSdk '.git') -PathType Container) {
    $actualObsCommit = (& $git -C $obsSdk rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualObsCommit -ne $obsSdkCommit) {
        throw "The OBS SDK checkout is not the pinned 31.1.2 commit $obsSdkCommit. Rerun with -Force."
    }
} elseif (Test-Path -LiteralPath $obsSdk) {
    throw "The OBS SDK directory is incomplete. Rerun with -Force: $obsSdk"
} else {
    & $git init --quiet $obsSdk
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the OBS SDK checkout.' }
    & $git -C $obsSdk remote add origin https://github.com/obsproject/obs-studio.git
    & $git -C $obsSdk fetch --depth 1 origin $obsSdkCommit
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch the pinned OBS SDK commit $obsSdkCommit." }
    & $git -C $obsSdk checkout --quiet --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not check out the pinned OBS SDK sources.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $obsSdk 'libobs\obs.h') -PathType Leaf)) {
    throw 'The pinned OBS SDK checkout does not contain libobs\obs.h.'
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stage-libobs.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not stage the private libobs runtime.' }

if (-not $SkipNativeBuild) {
    & (Join-Path $PSScriptRoot 'build-mpv-host.cmd')
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the native MPV host.' }
    & (Join-Path $PSScriptRoot 'build-capture-host.cmd')
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the native capture host.' }
}

Write-Host ''
Write-Host 'Clips prerequisites are ready.'
Write-Host 'Run npm install, then npm start.'
