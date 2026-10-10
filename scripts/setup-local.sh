#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="${FORTUNE_DATA_DIR:-${HOME}/Documents/Codex/fortune-data}"
RUNTIME_ROOT="${FORTUNE_RUNTIME_DIR:-${ROOT_DIR}/.runtime}"
VENV_ROOT="${FORTUNE_VENV_ROOT:-${RUNTIME_ROOT}/venvs}"

mkdir -p "${DATA_ROOT}/module4" "${DATA_ROOT}/logs" "${VENV_ROOT}"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required.\n' >&2
  exit 1
fi

ensure_venv() {
  local name="$1"
  local path="${VENV_ROOT}/${name}"
  if [[ ! -x "${path}/bin/python" ]]; then
    printf 'Creating Python environment: %s\n' "${path}"
    python3 -m venv "${path}"
  fi
  "${path}/bin/pip" install --upgrade pip
}

ensure_venv algorithms
"${VENV_ROOT}/algorithms/bin/pip" install -r "${ROOT_DIR}/python_algorithm/requirements.txt"

ensure_venv module4
"${VENV_ROOT}/module4/bin/pip" install -e "${ROOT_DIR}/fortune_module4[dev]"

printf 'Python environments are ready under %s\n' "${VENV_ROOT}"
