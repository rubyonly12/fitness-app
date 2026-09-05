# build-capgo-ios.ps1 - Cloud iOS build via Capgo (no Mac needed)
# See the chat message for Chinese step-by-step instructions.

$APP_ID = "com.yi.fitness"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    $nodeDir = Read-Host "Enter the full path to your Node folder (e.g. D:\node)"
    if (-not $nodeDir) {
        Write-Host "Error: Node folder path is required." -ForegroundColor Red
        exit 1
    }
    $env:Path = "$nodeDir;" + $env:Path
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npx not found. Check the path." -ForegroundColor Red
        exit 1
    }
    Write-Host "npx found."
} else {
    Write-Host "npx found."
}

$token = Read-Host "Enter your Capgo API Key"
$p12pw = Read-Host "Enter your .p12 certificate password"
$env:CAPGO_TOKEN = $token

Write-Host "Step 1/3: Register app with Capgo"
npx --yes @capgo/cli@latest app add $APP_ID

Write-Host "Step 2/3: Save iOS signing credentials (auto base64 encode)"
$certBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("./certs/dist.p12"))
$provBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("./certs/profile.mobileprovision"))
npx --yes @capgo/cli@latest build credentials save `
  --appId $APP_ID --platform ios `
  --build-certificate-base64 $certBase64 `
  --p12-password $p12pw `
  --build-provision-profile-base64 $provBase64

Write-Host "Step 3/3: Build IPA on Capgo cloud Mac"
npx --yes @capgo/cli@latest build request $APP_ID --platform ios --path . --output-upload

Write-Host "Done. Download the .ipa from the link above, then install with LCSign."
