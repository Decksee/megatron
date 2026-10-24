# Crée, une seule fois, la clé qui signe les versions Android publiées de Mégatron.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\android-key.ps1
#
# La clé et son mot de passe (aléatoire) vont dans %USERPROFILE%\.megatron, jamais dans le dépôt.
# IMPORTANT : sauvegarde ce dossier (clé USB, coffre…). Sans cette clé, impossible de publier une mise à jour
# installable par-dessus l'appli déjà sur les téléphones.

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".megatron"
$store = Join-Path $dir "megatron-release.jks"
$props = Join-Path $dir "keystore.properties"

if (Test-Path $store) {
  Write-Host "La clé existe déjà : $store (rien à faire)."
  exit 0
}

$studio = Get-ChildItem "C:\Program Files\Android" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "jbr\bin\keytool.exe") } | Select-Object -First 1
if (-not $studio) { throw "Android Studio introuvable (keytool)." }
$keytool = Join-Path $studio.FullName "jbr\bin\keytool.exe"

New-Item -ItemType Directory -Force $dir | Out-Null
# Mot de passe aléatoire de 32 caractères (lettres et chiffres), jamais affiché.
$chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

& $keytool -genkeypair -v -keystore $store -alias megatron -keyalg RSA -keysize 4096 -validity 36500 `
  -storepass $password -keypass $password -dname "CN=Megatron, O=Decksee, C=FR" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "La création de la clé a échoué." }

# Fichier lu par Gradle (chemins avec « / » : les « \ » ont un sens spécial dans ce format).
@"
storeFile=$($store -replace '\\', '/')
keyAlias=megatron
password=$password
"@ | Set-Content -Encoding ascii $props

Write-Host "Clé créée : $store"
Write-Host "Sauvegarde le dossier $dir : sans lui, plus de mise à jour possible de l'appli installée."
