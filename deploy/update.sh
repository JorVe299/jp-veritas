#!/usr/bin/env bash
# Server update: pull, reinstall, rebuild, restart (run as /opt/veritas/deploy/update.sh)
# Gitignored files (backend/.env, backend/data/*.json, veritas/config.lua) stay untouched
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Pulling $BRANCH"
git fetch --prune origin
# Hard reset, not merge: the server is a copy; local edits would block the next pull
git reset --hard "origin/$BRANCH"

echo "==> Backend dependencies"
npm --prefix backend ci --omit=dev

echo "==> Building the panel"
npm --prefix frontend ci
npm --prefix frontend run build

# Restart needs root (or sudo rights for the service); otherwise say so
if systemctl is-enabled --quiet veritas 2>/dev/null; then
    echo "==> Restarting veritas.service"
    systemctl restart veritas
else
    echo "==> veritas.service not found - restart the backend yourself"
fi

echo
echo "Done. The FiveM resource is not reloaded by this script:"
echo "  type 'ensure veritas' in the server console if the bridge changed."
