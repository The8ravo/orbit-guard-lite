# A dependency-free Android build: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Run from any directory with PowerShell 7 or Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [string]$JavaHome = '',
    [string]$AndroidSdk = '',
    [string]$BuildToolsVersion = '35.0.0',
    [int]$CompileSdk = 35,
    [string]$OutputPath = '',
    [string]$KeyStorePath = '',
    [string]$KeyAlias = 'androiddebugkey'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$DepsRoot = Join-Path $ProjectRoot '.build-deps'

function Resolve-JavaHome {
    if ($JavaHome) { return $JavaHome }
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
        return $env:JAVA_HOME
    }
    $possible = @(Join-Path $DepsRoot 'jdk')
    if (Test-Path -LiteralPath $DepsRoot) {
        $possible += @(Get-ChildItem -LiteralPath $DepsRoot -Directory | ForEach-Object { $_.FullName })
    }
    foreach ($candidate in $possible) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'bin\javac.exe')) { return $candidate }
    }
    throw 'JDK not found. Supply -JavaHome or put a JDK in .build-deps/jdk.'
}

function Invoke-BuildTool {
    param([string]$Executable, [string[]]$ToolArguments)
    & $Executable @ToolArguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

$JavaHome = Resolve-JavaHome
if (-not $AndroidSdk) {
    if ($env:ANDROID_SDK_ROOT) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
    elseif ($env:ANDROID_HOME) { $AndroidSdk = $env:ANDROID_HOME }
    else { $AndroidSdk = Join-Path $DepsRoot 'android-sdk' }
}
$BuildTools = Join-Path $AndroidSdk "build-tools\$BuildToolsVersion"
$AndroidJar = Join-Path $AndroidSdk "platforms\android-$CompileSdk\android.jar"
$Java = Join-Path $JavaHome 'bin\java.exe'
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Jar = Join-Path $JavaHome 'bin\jar.exe'
$Keytool = Join-Path $JavaHome 'bin\keytool.exe'
$Aapt2 = Join-Path $BuildTools 'aapt2.exe'
$Aapt = Join-Path $BuildTools 'aapt.exe'
$Zipalign = Join-Path $BuildTools 'zipalign.exe'
$D8Jar = Join-Path $BuildTools 'lib\d8.jar'
$SignerJar = Join-Path $BuildTools 'lib\apksigner.jar'
foreach ($required in @($Java, $Javac, $Jar, $Keytool, $AndroidJar, $Aapt2, $Aapt, $Zipalign, $D8Jar, $SignerJar)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing build tool: $required" }
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'web\index.html'))) { throw 'web/index.html is missing.' }
if (-not $OutputPath) { $OutputPath = Join-Path $ProjectRoot 'output\orbit-guard-v1.0.0.apk' }
if (-not $KeyStorePath) { $KeyStorePath = Join-Path $ProjectRoot '.build\signing\development.jks' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$KeyStorePath = [IO.Path]::GetFullPath($KeyStorePath)
$BuildRoot = Join-Path $ProjectRoot ('.build\apk-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
$Classes = Join-Path $BuildRoot 'classes'
$Dex = Join-Path $BuildRoot 'dex'
$OutputDirectory = Split-Path -Parent $OutputPath
foreach ($directory in @($BuildRoot, $Classes, $Dex, $OutputDirectory, (Split-Path -Parent $KeyStorePath))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$CompiledResources = Join-Path $BuildRoot 'resources.zip'
$UnsignedApk = Join-Path $BuildRoot 'unsigned.apk'
$AlignedApk = Join-Path $BuildRoot 'aligned.apk'
Write-Host 'Compiling Android resources and packaging local game assets...'
Invoke-BuildTool $Aapt2 @('compile', '--dir', (Join-Path $ProjectRoot 'android\res'), '-o', $CompiledResources)
Invoke-BuildTool $Aapt2 @('link', '-o', $UnsignedApk, '-I', $AndroidJar,
    '--manifest', (Join-Path $ProjectRoot 'android\AndroidManifest.xml'),
    '-A', (Join-Path $ProjectRoot 'web'), '--min-sdk-version', '26', '--target-sdk-version', '35',
    '--version-code', '1', '--version-name', '1.0.0', $CompiledResources)

Write-Host 'Compiling the offline Android container...'
$JavaSources = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'android\src') -Recurse -Filter '*.java' |
    ForEach-Object { $_.FullName })
Invoke-BuildTool $Javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', $AndroidJar,
    '-d', $Classes) + $JavaSources)
$ClassFiles = @(Get-ChildItem -LiteralPath $Classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Invoke-BuildTool $Java (@('-cp', $D8Jar, 'com.android.tools.r8.D8', '--lib', $AndroidJar,
    '--min-api', '26', '--output', $Dex) + $ClassFiles)
Invoke-BuildTool $Jar @('uf', $UnsignedApk, '-C', $Dex, 'classes.dex')
Invoke-BuildTool $Zipalign @('-p', '-f', '4', $UnsignedApk, $AlignedApk)

# This explicitly development-signed APK is suitable for local sideloading.
# The ignored keystore is reused on later builds, so app data survives updates.
if (-not (Test-Path -LiteralPath $KeyStorePath)) {
    Write-Host 'Creating a local development signing key...'
    Invoke-BuildTool $Keytool @('-genkeypair', '-noprompt', '-keystore', $KeyStorePath,
        '-alias', $KeyAlias, '-storepass', 'android', '-keypass', 'android', '-keyalg', 'RSA',
        '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Orbit Guard Development,O=Local Development,C=US')
}
Invoke-BuildTool $Java @('-jar', $SignerJar, 'sign', '--ks', $KeyStorePath, '--ks-key-alias', $KeyAlias,
    '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false',
    '--out', $OutputPath, $AlignedApk)

Write-Host 'Verifying alignment, signature, manifest, and asset contents...'
Invoke-BuildTool $Zipalign @('-c', '-v', '4', $OutputPath)
Invoke-BuildTool $Java @('-jar', $SignerJar, 'verify', '--verbose', '--print-certs', $OutputPath)
$Badging = & $Aapt dump badging $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'APK badging verification failed.' }
$Permissions = & $Aapt dump permissions $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'APK permission inspection failed.' }
if ($Permissions -match 'uses-permission') { throw 'Unexpected permission found in this offline APK.' }
$Contents = & $Jar tf $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'APK content inspection failed.' }
foreach ($entry in @('classes.dex', 'assets/index.html', 'assets/engine.js', 'assets/app.js', 'assets/style.css')) {
    if ($Contents -notcontains $entry) { throw "APK is missing $entry" }
}
$Checksum = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
$ApkFile = Get-Item -LiteralPath $OutputPath
$Metadata = [ordered]@{
    name = 'Orbit Guard'; package = 'io.starring.guardian'; version = '1.0.0'; versionCode = 1
    minSdk = 26; targetSdk = 35; signing = 'local development RSA key; APK Signature Scheme v1/v2/v3'
    builtAtUtc = [DateTime]::UtcNow.ToString('o'); file = $ApkFile.Name
    bytes = $ApkFile.Length; sha256 = $Checksum; permissions = @(); badging = @($Badging)
}
$Metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'build-info.json') -Encoding UTF8
($Checksum + '  ' + $ApkFile.Name) | Set-Content -LiteralPath ($OutputPath + '.sha256') -Encoding ASCII
Write-Host "Built: $OutputPath"
Write-Host "SHA256: $Checksum"
Write-Host ($Badging -join [Environment]::NewLine)
