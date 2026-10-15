# Publie une nouvelle version de Mégatron : construit l'installateur signé, puis le met en ligne
# dans les versions (Releases) du dépôt GitHub. Les Mégatron installés la trouvent et proposent de l'installer.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\publier.ps1 -Version 0.2.0 -Notes "Ce qui change"
#
# Prérequis : la clé de signature dans ~\.tauri\megatron-updater.key (jamais dans le dépôt),
# et la commande gh connectée à GitHub (gh auth login).

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = "",
    [string]$Repo = "Decksee/megatron"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $cargoBin })) { $env:Path += ";$cargoBin" }

$keyPath = Join-Path $env:USERPROFILE ".tauri\megatron-updater.key"
if (-not (Test-Path $keyPath)) { throw "Clé de signature introuvable : $keyPath" }

# 0. La version doit figurer dans l'historique affiché dans l'app (Réglages → Versions).
if (-not (Select-String -Path "src\changelog.ts" -Pattern "version: `"$([regex]::Escape($Version))`"" -Quiet)) {
    throw "Ajoute d'abord la version $Version à src\changelog.ts (historique affiché dans l'app)."
}

# 1. Numéro de version (tauri.conf.json fait foi pour les mises à jour)
$confPath = "src-tauri\tauri.conf.json"
# Seul le numéro change : le reste du fichier garde sa mise en forme.
$utf8 = New-Object System.Text.UTF8Encoding $false
$confFull = (Resolve-Path $confPath).Path
$confText = [System.IO.File]::ReadAllText($confFull, $utf8)
$confText = [regex]::Replace($confText, '"version":\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[System.IO.File]::WriteAllText($confFull, $confText, $utf8)
Write-Host "Version $Version"

# 2. Construction et signature
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "La construction a échoué." }

# 3. Fichiers à publier (nom sans accent pour l'adresse de téléchargement)
$bundle = "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) { throw "Installateur introuvable dans $bundle" }
$signature = (Get-Content "$($setup.FullName).sig" -Raw).Trim()
$out = "src-tauri\target\release\publication"
New-Item -ItemType Directory -Force $out | Out-Null
$assetName = "Megatron_${Version}_x64-setup.exe"
Copy-Item $setup.FullName (Join-Path $out $assetName) -Force

$latest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url       = "https://github.com/$Repo/releases/download/v$Version/$assetName"
        }
    }
}
$latestPath = Join-Path $out "latest.json"
[System.IO.File]::WriteAllText((Resolve-Path $out).Path + "\latest.json", ($latest | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))

# 4. Mise en ligne
$title = "Mégatron $Version"
gh release create "v$Version" (Join-Path $out $assetName) $latestPath --repo $Repo --title $title --notes ($(if ($Notes) { $Notes } else { $title }))
if ($LASTEXITCODE -ne 0) { throw "La publication sur GitHub a échoué." }
Write-Host "Publié : https://github.com/$Repo/releases/tag/v$Version"
