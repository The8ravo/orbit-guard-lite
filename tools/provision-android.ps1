param([string]$Destination = (Join-Path $PSScriptRoot '..\.build-deps'))
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$downloads = @(
    @{Name='jdk17.zip'; Url='https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip'; Folder='jdk17'; Final='jdk'; Marker='bin\javac.exe'},
    @{Name='build-tools35.zip'; Url='https://dl.google.com/android/repository/build-tools_r35_windows.zip'; Folder='build-tools35'; Final='android-sdk\build-tools\35.0.0'; Marker='aapt2.exe'},
    @{Name='platform35.zip'; Url='https://dl.google.com/android/repository/platform-35_r02.zip'; Folder='platform35'; Final='android-sdk\platforms\android-35'; Marker='android.jar'}
)
foreach ($item in $downloads) {
    $final = Join-Path $Destination $item.Final
    if (Test-Path -LiteralPath (Join-Path $final $item.Marker)) {
        Write-Output "Ready: $($item.Final)"
        continue
    }
    $archive = Join-Path $Destination $item.Name
    if (-not (Test-Path -LiteralPath $archive)) {
        $partial = $archive + '.partial'
        & curl.exe -fL --retry 2 --connect-timeout 30 --max-time 600 -o $partial $item.Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $($item.Name)" }
        [IO.File]::Move($partial, $archive)
    }
    $staging = Join-Path $Destination $item.Folder
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    $source = Get-ChildItem -LiteralPath $staging -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $item.Marker) } |
        Select-Object -First 1
    if (-not $source) { throw "Expected tool folder not found in $archive" }
    # Only move verified directories inside this tool-cache root.
    $prefix = $Destination.TrimEnd('\') + '\'
    foreach ($path in @($source.FullName, $final)) {
        if (-not ([IO.Path]::GetFullPath($path)).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Unsafe tool-cache path'
        }
    }
    if (Test-Path -LiteralPath $final) { throw "Incomplete destination exists: $final. Choose a fresh Destination." }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $final) | Out-Null
    Move-Item -LiteralPath $source.FullName -Destination $final
    Write-Output "Ready: $($item.Final)"
}
