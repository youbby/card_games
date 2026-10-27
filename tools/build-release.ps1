param(
    [switch]$InitializeSigning,
    [string]$KeystorePath = (Join-Path $env:USERPROFILE '.android\card-games-release.jks'),
    [string]$AndroidSdk = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$signingDirectory = Join-Path $projectRoot '.signing'
$signingConfigPath = Join-Path $signingDirectory 'release.clixml'

if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
}
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'Set JAVA_HOME to a JDK installation.' }

if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (-not $AndroidSdk) {
    $localProperties = Join-Path $projectRoot 'android\local.properties'
    if (Test-Path -LiteralPath $localProperties) {
        $sdkLine = Get-Content -LiteralPath $localProperties | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
        if ($sdkLine) { $AndroidSdk = $sdkLine.Substring(8).Replace('\:', ':').Replace('\\', '\') }
    }
}
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Install Android SDK Build Tools.' }
$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'

try {
    if (-not (Test-Path -LiteralPath $signingConfigPath)) {
        if (-not $InitializeSigning) {
            throw 'No signing key configured. Run npm run android:release -- -InitializeSigning once.'
        }
        $KeystorePath = [System.IO.Path]::GetFullPath($KeystorePath)
        if (Test-Path -LiteralPath $KeystorePath) { throw 'Keystore already exists; restore its signing configuration instead of replacing it.' }
        $randomBytes = New-Object byte[] 48
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
        $env:CARD_GAMES_SIGNING_PASSWORD = [Convert]::ToBase64String($randomBytes)
        $securePassword = ConvertTo-SecureString $env:CARD_GAMES_SIGNING_PASSWORD -AsPlainText -Force
        New-Item -ItemType Directory -Path (Split-Path -Parent $KeystorePath) -Force | Out-Null
        & $keytool -genkeypair -storetype PKCS12 -keystore $KeystorePath -alias card-games -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Card Games, O=Card Games' -storepass:env CARD_GAMES_SIGNING_PASSWORD -keypass:env CARD_GAMES_SIGNING_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }
        New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
        [pscustomobject]@{
            KeystorePath = $KeystorePath
            KeyAlias = 'card-games'
            Password = $securePassword
        } | Export-Clixml -LiteralPath $signingConfigPath
        Write-Host "Created release keystore: $KeystorePath"
    }

    $signing = Import-Clixml -LiteralPath $signingConfigPath
    if (-not (Test-Path -LiteralPath $signing.KeystorePath)) { throw 'Release keystore is missing.' }
    $env:CARD_GAMES_SIGNING_PASSWORD = [System.Net.NetworkCredential]::new('', $signing.Password).Password

    Push-Location $projectRoot
    try {
        & npm.cmd run android:sync
        if ($LASTEXITCODE -ne 0) { throw 'Android web build/sync failed.' }
        & (Join-Path $projectRoot 'android\gradlew.bat') --project-dir (Join-Path $projectRoot 'android') assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
    } finally { Pop-Location }

    $package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
    $outputDirectory = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $unsigned = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
    $aligned = Join-Path $outputDirectory 'app-release-aligned.apk'
    $apk = Join-Path $outputDirectory "card-games-$($package.version).apk"
    & $zipalign -f -P 16 4 $unsigned $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & $apksigner sign --ks $signing.KeystorePath --ks-key-alias $signing.KeyAlias --ks-pass env:CARD_GAMES_SIGNING_PASSWORD --key-pass env:CARD_GAMES_SIGNING_PASSWORD --v4-signing-enabled false --out $apk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & $apksigner verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    & $zipalign -c -P 16 4 $apk
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($apk))" | Set-Content -LiteralPath "$apk.sha256" -Encoding ascii
    Remove-Item -LiteralPath $aligned
    Write-Host "Release APK: $apk"
    Write-Host "SHA256: $hash"
} finally {
    Remove-Item Env:CARD_GAMES_SIGNING_PASSWORD -ErrorAction SilentlyContinue
}
