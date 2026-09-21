#!/usr/bin/env bash
# Pull the current state and rebuild. Run this on the server instead of
# copying files over with WinSCP:
#
#   /opt/veritas/deploy/update.sh
#
# Nothing in here touches backend/.env, backend/data/permissions.json or
# veritas/config.lua - those are gitignored and stay as they are on the server.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Pulling $BRANCH"
git fetch --prune origin
# Hard reset rather than merge: the server is a copy, not a place to edit.
# Anything changed here by hand would otherwise stop the next pull dead.
git reset --hard "origin/$BRANCH"

echo "==> Backend dependencies"
npm --prefix backend ci --omit=dev

echo "==> Building the panel"
npm --prefix frontend ci
npm --prefix frontend run build

# Restarting needs root, so it only happens when this runs as root or the
# service is allowed through sudo. Otherwise the line below just says so.
if systemctl is-enabled --quiet veritas 2>/dev/null; then
    echo "==> Restarting veritas.service"
    systemctl restart veritas
else
    echo "==> veritas.service not found - restart the backend yourself"
fi

echo
echo "Done. The FiveM resource is not reloaded by this script:"
echo "  type 'ensure veritas' in the server console if the bridge changed."
