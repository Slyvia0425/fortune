#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT_DIR}"

OPEN_BROWSER=1 exec bash "${ROOT_DIR}/scripts/start-local.sh"
