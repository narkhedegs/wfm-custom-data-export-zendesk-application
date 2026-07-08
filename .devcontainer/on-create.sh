#!/usr/bin/env bash
# on-create.sh runs ONCE on first container creation. (AI CLIs are installed
# in the Dockerfile as root; doing it here as the non-root user fails EACCES.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[on-create] installing firewall script..."
sudo install -m 0755 "${HERE}/initialize-firewall.sh" /usr/local/bin/initialize-firewall.sh

# Named-volume mounts come up root-owned; hand them to our user.
echo "[on-create] fixing ownership of persisted volumes..."
for d in "${HOME}/.claude" "${HOME}/.codex" "${HOME}/.config/gh" \
         "${HOME}/.local/share/pnpm" /commandhistory; do
  sudo mkdir -p "${d}"
  sudo chown -R "$(id -u):$(id -g)" "${d}"
done

echo "[on-create] done."
