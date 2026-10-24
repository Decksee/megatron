# Compile l'application Android (APK) de Mégatron.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\android.ps1            # APK de test (debug)
#   powershell -ExecutionPolicy Bypass -File .\scripts\android.ps1 -Release   # APK de publication
#
# Prérequis : Android Studio (Java fourni), SDK et NDK Android, cibles Rust Android (rustup target add …).

param([switch]$Release)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# L'outil Android refuse un projet dont le chemin contient un accent (« mégatron ») : on compile
# en passant par une jonction au nom sans accent qui pointe vers le projet (le dossier ne bouge pas).
$link = Join-Path $env:USERPROFILE "megatron-android"
if (-not (Test-Path $link)) { New-Item -ItemType Junction -Path $link -Target $project | Out-Null }
Set-Location $link

# Java d'Android Studio, SDK et NDK (on prend le NDK le plus récent installé).
$studio = Get-ChildItem "C:\Program Files\Android" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "jbr\bin\java.exe") } | Select-Object -First 1
if (-not $studio) { throw "Android Studio introuvable dans C:\Program Files\Android." }
$env:JAVA_HOME = Join-Path $studio.FullName "jbr"
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$ndk = Get-ChildItem (Join-Path $env:ANDROID_HOME "ndk") -Directory | Sort-Object Name | Select-Object -Last 1
if (-not $ndk) { throw "NDK Android introuvable." }
$env:NDK_HOME = $ndk.FullName
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$cargoBin;$env:Path"
# Le lieur Android sous Windows ne sait pas ouvrir les chemins accentués (« mégatron ») :
# les fichiers de compilation Android vont dans un dossier au nom sans accent, hors du projet.
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "megatron-android-target"
# Java (Gradle) dialogue avec son processus de compilation par un fichier « socket » du dossier temporaire :
# il faut un chemin court, sans nom court (« UTILIS~1 ») ni accent, sinon « Unable to establish loopback connection ».
$tmp = Join-Path $env:USERPROFILE ".mgt"
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$tmp -Djdk.net.unixdomain.tmpdir=$tmp"

# Version publiée : signée avec la clé personnelle (créée une fois par scripts\android-key.ps1).
if ($Release -and -not (Test-Path (Join-Path $env:USERPROFILE ".megatron\keystore.properties"))) {
  throw "Clé de signature absente : lance d'abord scripts\android-key.ps1."
}

$buildArgs = @("tauri", "android", "build", "--apk", "--target", "aarch64")
if (-not $Release) { $buildArgs += "--debug" }
npx @buildArgs
if ($LASTEXITCODE -ne 0) { throw "La compilation Android a échoué." }

$apk = Get-ChildItem "src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter *.apk | Sort-Object LastWriteTime | Select-Object -Last 1
Write-Host "APK : $($apk.FullName)"

# Version publiée : copie avec un nom clair, prête à envoyer sur le téléphone.
if ($Release) {
  $version = (Get-Content (Join-Path $project "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
  $outDir = Join-Path $project "android-release"
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $final = Join-Path $outDir "Megatron-$version.apk"
  Copy-Item $apk.FullName $final -Force
  Write-Host "APK signé : $final"
}
