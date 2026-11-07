#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run from a checkout or bootstrap one without changing an existing directory.
# Resolve a moving download only once: install state records the checkout SHA.
for requirement in git node npm docker; do
  if ! command -v "$requirement" >/dev/null 2>&1; then
    echo "ReviewRouter setup needs $requirement. Install the prerequisites in the self-hosted guide and run this command again." >&2
    exit 1
  fi
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (!((major===24&&minor>=21)||(major===26&&minor>=10))) { console.error("Use Node 24.21+ or 26.10+ (supported LTS majors)."); process.exit(1); }'

installer_source="${BASH_SOURCE[0]:-}"
installer_root=""
if [[ -f "$installer_source" ]]; then
  candidate="$(cd -- "$(dirname -- "$installer_source")/.." && pwd)"
  if [[ -f "$candidate/deploy/self-hosted/install.ts" && -d "$candidate/.git" ]]; then
    installer_root="$candidate"
  fi
fi
if [[ -z "$installer_root" ]]; then
  installer_root="${REVIEWROUTER_INSTALL_DIR:-$PWD/reviewrouter}"
  if [[ ! -e "$installer_root" ]]; then
    git clone --depth 1 https://github.com/777genius/review-router-ai.git "$installer_root"
  elif [[ ! -f "$installer_root/deploy/self-hosted/install.ts" || ! -d "$installer_root/.git" ]]; then
    echo "Destination already exists and is not a ReviewRouter installation: $installer_root" >&2
    exit 1
  fi
fi
cd -- "$installer_root"
package_manager="$(node -p 'const p=require("./package.json").packageManager; if (!/^pnpm@[0-9]+\.[0-9]+\.[0-9]+$/.test(p)) throw Error("Invalid pinned package manager"); p')"
# npm exec supplies this exact pnpm to the wizard and all child commands without
# replacing a globally installed package manager.
exec npm exec --yes --package "$package_manager" -- node deploy/self-hosted/install.ts "$@"
