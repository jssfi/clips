$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $projectRoot 'legal\licenses'
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$licenses = @(
    @{ Name = 'GPL-2.0.txt'; Url = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-2.0-only.txt'; Sha256 = 'aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3' },
    @{ Name = 'GPL-3.0.txt'; Url = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-only.txt'; Sha256 = 'fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0' },
    @{ Name = 'LGPL-2.1.txt'; Url = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/LGPL-2.1-only.txt'; Sha256 = '5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2' }
)

foreach ($license in $licenses) {
    $target = Join-Path $destination $license.Name
    $valid = (Test-Path -LiteralPath $target -PathType Leaf) -and
        ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $license.Sha256)
    if (-not $valid) {
        $partial = "$target.partial"
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        & curl.exe --fail --location --retry 5 --retry-all-errors --retry-delay 2 --silent --show-error --output $partial $license.Url
        if ($LASTEXITCODE -ne 0) { throw "Could not download $($license.Name)." }
        $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $license.Sha256) {
            Remove-Item -LiteralPath $partial -Force
            throw "Checksum verification failed for $($license.Name)."
        }
        Move-Item -LiteralPath $partial -Destination $target -Force
    }
}

Write-Host 'Third-party license texts are staged.'
