#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="${FORTUNE_DATA_DIR:-${HOME}/Documents/Codex/fortune-data}"
RUNTIME_ROOT="${FORTUNE_RUNTIME_DIR:-${ROOT_DIR}/.runtime}"
VENV_ROOT="${FORTUNE_VENV_ROOT:-${RUNTIME_ROOT}/venvs}"

mkdir -p "${DATA_ROOT}/module4" "${DATA_ROOT}/logs" "${VENV_ROOT}"

# Module 4 requires 3.12 and the algorithm service 3.10, so 3.12 is the floor
# for both. `python3` on PATH is not necessarily the newest interpreter on the
# machine (macOS ships 3.9), so pick the first interpreter that is new enough,
# newest first, rather than building a 3.9 environment and failing halfway
# through installing dependencies.
PYTHON_BIN="${FORTUNE_PYTHON:-}"
if [[ -z "${PYTHON_BIN}" ]]; then
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if ! command -v "${candidate}" >/dev/null 2>&1; then
      continue
    fi
    if "${candidate}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
      PYTHON_BIN="$(command -v "${candidate}")"
      break
    fi
  done
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  printf 'Python 3.12 or newer is required. Set FORTUNE_PYTHON to a newer interpreter.\n' >&2
  exit 1
fi

printf 'Using Python: %s (%s)\n' "${PYTHON_BIN}" "$("${PYTHON_BIN}" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"

ensure_venv() {
  local name="$1"
  local path="${VENV_ROOT}/${name}"
  if [[ ! -x "${path}/bin/python" ]]; then
    printf 'Creating Python environment: %s\n' "${path}"
    "${PYTHON_BIN}" -m venv "${path}"
  fi
  "${path}/bin/pip" install --upgrade pip
}

ensure_venv algorithms
"${VENV_ROOT}/algorithms/bin/pip" install -r "${ROOT_DIR}/python_algorithm/requirements.txt"

ensure_venv module4
"${VENV_ROOT}/module4/bin/pip" install -e "${ROOT_DIR}/fortune_module4[dev]"

printf 'Python environments are ready under %s\n' "${VENV_ROOT}"
