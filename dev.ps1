# Lance Mégatron en mode développement (rechargement à chaud du front).
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $cargoBin })) {
    $env:Path += ";$cargoBin"
}
Set-Location $PSScriptRoot
npx tauri dev
