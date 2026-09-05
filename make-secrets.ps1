# make-secrets.ps1 - generate base64 of your cert files for GitHub Secrets
# Run inside the fitness-app folder (PowerShell). It copies each base64 to clipboard.
$ErrorActionPreference = "Stop"

if (-not (Test-Path "certs\dist.p12")) { Write-Host "ERROR: certs\dist.p12 not found" -ForegroundColor Red; exit 1 }
if (-not (Test-Path "certs\profile.mobileprovision")) { Write-Host "ERROR: certs\profile.mobileprovision not found" -ForegroundColor Red; exit 1 }

$p12  = [Convert]::ToBase64String([IO.File]::ReadAllBytes("certs\dist.p12"))
$prov = [Convert]::ToBase64String([IO.File]::ReadAllBytes("certs\profile.mobileprovision"))

Set-Clipboard -Value $p12
Write-Host "1) dist.p12 的 base64 已复制到剪贴板 -> 粘贴到 GitHub 秘钥 P12_BASE64" -ForegroundColor Green
Read-Host "按回车继续，复制 profile 的 base64"

Set-Clipboard -Value $prov
Write-Host "2) profile.mobileprovision 的 base64 已复制到剪贴板 -> 粘贴到 GitHub 秘钥 MOBILEPROV_BASE64" -ForegroundColor Green
Write-Host "3) 第三个秘钥 P12_PASSWORD 直接填你的证书密码（例如 1）" -ForegroundColor Green
