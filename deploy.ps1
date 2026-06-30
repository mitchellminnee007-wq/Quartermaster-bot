# deploy.ps1 — Run this from your project folder on Windows
# Usage: .\deploy.ps1 [-Vps "user@host"] [-RemoteBase "/root"]
# Requires: OpenSSH + tar (both built into Windows 10/11)

param(
    [string]$Vps = "root@37.97.169.128",
    [string]$RemoteBase = "/root"
)

$VPS        = $Vps
$ProjectDir = $PSScriptRoot
$ProjectName = Split-Path $ProjectDir -Leaf
$REMOTE     = "$RemoteBase/$ProjectName"
$RemoteTar  = "/tmp/$ProjectName-deploy.tar.gz"
$TarPath    = Join-Path $env:TEMP "$ProjectName-deploy.tar.gz"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Discord Bot — Windows Deploy Script"      -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project: $ProjectName" -ForegroundColor Cyan
Write-Host "Target : $VPS:$REMOTE" -ForegroundColor Cyan
Write-Host ""

# ── Verify local .env exists ──────────────────────────────────────────────────
${EnvFile} = Join-Path $ProjectDir ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found in $ProjectDir. Aborting."
    exit 1
}

# Validate required values for a fresh production deploy
$EnvText = Get-Content $EnvFile -Raw
foreach ($RequiredKey in @("DISCORD_TOKEN", "CLIENT_ID")) {
    if ($EnvText -notmatch "(?m)^$RequiredKey\s*=\s*\S+") {
        Write-Error "Missing required $RequiredKey value in .env. Aborting."
        exit 1
    }
}

# ── Pack project into a tar (excluding node_modules and .git) ─────────────────
Write-Host "[1/4] Creating archive (excluding node_modules / .git)..." -ForegroundColor Yellow
if (Test-Path $TarPath) { Remove-Item $TarPath -Force }
tar -czf $TarPath `
    --exclude="./node_modules" `
    --exclude="./.git" `
    -C $ProjectDir .
if ($LASTEXITCODE -ne 0) { Write-Error "tar failed."; exit 1 }

# ── Upload archive to VPS ─────────────────────────────────────────────────────
Write-Host "[2/4] Uploading archive to VPS..." -ForegroundColor Yellow
scp $TarPath "${VPS}:$RemoteTar"
if ($LASTEXITCODE -ne 0) { Write-Error "SCP upload failed."; exit 1 }
Remove-Item $TarPath -Force

# ── Extract on VPS and run deploy.sh ─────────────────────────────────────────
Write-Host "[3/4] Extracting and deploying on VPS..." -ForegroundColor Yellow
$SshCommand = @"
set -e
mkdir -p '$REMOTE'
tar -xzf '$RemoteTar' -C '$REMOTE'
rm -f '$RemoteTar'
sed -i 's/\r$//' '$REMOTE/deploy.sh'
bash '$REMOTE/deploy.sh'
"@
ssh $VPS $SshCommand
if ($LASTEXITCODE -ne 0) { Write-Error "Remote deploy failed."; exit 1 }

Write-Host ""
Write-Host "[4/4] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "To deploy commands globally (all servers):" -ForegroundColor Cyan
Write-Host "  1. Remove or leave GUILD_ID empty in .env"  -ForegroundColor White
Write-Host "  2. Run: node deploy-commands.js"            -ForegroundColor White
Write-Host "  3. Ensure 'Public Bot' is ON in the Discord Developer Portal" -ForegroundColor White
Write-Host "  4. Use /invite in Discord to get the shareable invite link"   -ForegroundColor White
Write-Host ""
