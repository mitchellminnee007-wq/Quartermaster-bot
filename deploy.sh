#!/bin/bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_NAME="$(basename "$DEPLOY_DIR")"

echo ""
echo "============================================"
echo "  Discord Bot — Deployment Script"
echo "============================================"
echo ""

cd "$DEPLOY_DIR"

# ── 1. Check .env exists ──────────────────────────────────────────────────────
echo "[1/6] Checking .env..."
if [ ! -f .env ]; then
  echo ""
  echo "  ERROR: .env file not found in $DEPLOY_DIR"
  echo "  Re-run deploy.ps1 from Windows — it uploads .env automatically."
  echo ""
  exit 1
fi

for key in DISCORD_TOKEN CLIENT_ID; do
  if ! grep -Eq "^${key}=.+" .env; then
    echo ""
    echo "  ERROR: Missing required ${key} value in .env"
    echo ""
    exit 1
  fi
done

echo "  .env found."

# ── 2. Install Node.js 20 LTS (if not present) ───────────────────────────────
echo "[2/6] Checking Node.js..."
install_node() {
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  else
    echo "  ERROR: No supported package manager found (apt/dnf/yum)."
    exit 1
  fi
}

if ! command -v node &>/dev/null; then
  echo "  Node.js not found. Installing via NodeSource..."
  install_node
  echo "  Node.js $(node --version) installed."
else
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  Node.js $(node --version) is too old. Upgrading to Node.js 20 LTS..."
    install_node
    echo "  Node.js $(node --version) installed."
  else
    echo "  Node.js $(node --version) already installed."
  fi
fi

if [ -f package.json ]; then
  PACKAGE_BOT_NAME="$(node -p "require('./package.json').name" 2>/dev/null || true)"
  if [ -n "$PACKAGE_BOT_NAME" ]; then
    BOT_NAME="$PACKAGE_BOT_NAME"
  fi
fi
echo "  Bot name: $BOT_NAME"

# ── 3. Install PM2 (if not present) ──────────────────────────────────────────
echo "[3/6] Checking PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "  PM2 not found. Installing..."
  npm install -g pm2
  echo "  PM2 $(pm2 --version) installed."
else
  echo "  PM2 $(pm2 --version) already installed."
fi

# ── 4. Install Node dependencies ─────────────────────────────────────────────
echo "[4/6] Installing Node dependencies..."
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

# ── 5. Register slash commands with Discord ───────────────────────────────────
echo "[5/6] Deploying slash commands..."
node deploy-commands.js

# ── 6. Start or restart bot with PM2 ─────────────────────────────────────────
echo "[6/6] Starting bot with PM2..."
if pm2 describe "$BOT_NAME" > /dev/null 2>&1; then
  BOT_NAME="$BOT_NAME" pm2 restart "$BOT_NAME" --update-env
  echo "  Bot restarted."
else
  BOT_NAME="$BOT_NAME" pm2 start ecosystem.config.js --update-env
  echo "  Bot started."
fi

# ── Persist PM2 across reboots ────────────────────────────────────────────────
pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" > /dev/null 2>&1 || true

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
echo ""
pm2 status
