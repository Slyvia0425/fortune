#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="${FORTUNE_DATA_DIR:-${HOME}/Documents/Codex/fortune-data}"
RUNTIME_ROOT="${FORTUNE_RUNTIME_DIR:-${ROOT_DIR}/.runtime}"
VENV_ROOT="${FORTUNE_VENV_ROOT:-${RUNTIME_ROOT}/venvs}"
LOG_DIR="${DATA_ROOT}/logs"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
ALGORITHM_PORT="${ALGORITHM_PORT:-8000}"
MODULE4_PORT="${MODULE4_PORT:-8003}"
LLM_PROVIDER_VALUE="${LLM_PROVIDER:-}"
LLM_MODEL_VALUE="${LLM_MODEL:-qwen3.8:27b-q8_0}"
LLM_BASE_URL_VALUE="${LLM_BASE_URL:-http://127.0.0.1:11434/v1}"
LLM_API_KEY_VALUE="${LLM_API_KEY:-ollama}"
LLM_TIMEOUT_SECONDS_VALUE="${LLM_TIMEOUT_SECONDS:-180}"
LLM_REASONING_EFFORT_VALUE="${LLM_REASONING_EFFORT:-none}"

if [[ -z "${LLM_PROVIDER_VALUE}" ]]; then
  if curl -fsS --max-time 2 "${LLM_BASE_URL_VALUE}/models" 2>/dev/null | grep -Fq "${LLM_MODEL_VALUE}"; then
    LLM_PROVIDER_VALUE="openai_compatible"
  else
    LLM_PROVIDER_VALUE="template"
  fi
fi

mkdir -p "${DATA_ROOT}/module4" "${LOG_DIR}"

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  (cd "${ROOT_DIR}" && npm ci --no-audit --no-fund)
fi

if [[ ! -x "${VENV_ROOT}/algorithms/bin/uvicorn" || ! -x "${VENV_ROOT}/module4/bin/uvicorn" ]]; then
  bash "${ROOT_DIR}/scripts/setup-local.sh"
fi

pids=()

cleanup() {
  local pid
  for pid in "${pids[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts >= 80 )); then
      printf '%s did not become ready. Check %s.\n' "${name}" "${LOG_DIR}" >&2
      exit 1
    fi
    sleep 0.25
  done
}

(
  cd "${ROOT_DIR}/python_algorithm"
  env PYTHONUNBUFFERED=1 "${VENV_ROOT}/algorithms/bin/uvicorn" \
    app:app --host 127.0.0.1 --port "${ALGORITHM_PORT}"
) >"${LOG_DIR}/algorithms.log" 2>&1 &
pids+=("$!")

database_path="${DATA_ROOT}/module4/module4.db"
(
  cd "${ROOT_DIR}/fortune_module4"
  env \
    PYTHONUNBUFFERED=1 \
    DATABASE_URL="sqlite:///${database_path}" \
    AUTO_CREATE_TABLES=true \
    DEV_USER_ID=dev-user \
    REQUIRE_USER_HEADER=false \
    EMBEDDING_PROVIDER=hash \
    LLM_PROVIDER="${LLM_PROVIDER_VALUE}" \
    LLM_MODEL="${LLM_MODEL_VALUE}" \
    LLM_BASE_URL="${LLM_BASE_URL_VALUE}" \
    LLM_API_KEY="${LLM_API_KEY_VALUE}" \
    LLM_TIMEOUT_SECONDS="${LLM_TIMEOUT_SECONDS_VALUE}" \
    LLM_REASONING_EFFORT="${LLM_REASONING_EFFORT_VALUE}" \
    "${VENV_ROOT}/module4/bin/uvicorn" \
    app.main:app --host 127.0.0.1 --port "${MODULE4_PORT}"
) >"${LOG_DIR}/module4.log" 2>&1 &
pids+=("$!")

wait_for_http "Algorithm service" "http://127.0.0.1:${ALGORITHM_PORT}/docs"
wait_for_http "Module 4" "http://127.0.0.1:${MODULE4_PORT}/health"

(
  cd "${ROOT_DIR}"
  env \
    PYTHON_ALGORITHM_BASE_URL="http://127.0.0.1:${ALGORITHM_PORT}" \
    MODULE4_API_BASE_URL="http://127.0.0.1:${MODULE4_PORT}" \
    LLM_BASE_URL="${LLM_BASE_URL_VALUE}" \
    LLM_API_KEY="${LLM_API_KEY_VALUE}" \
    LLM_MODEL="${LLM_MODEL_VALUE}" \
    npm run dev -- --hostname 0.0.0.0 --port "${FRONTEND_PORT}"
) >"${LOG_DIR}/frontend.log" 2>&1 &
pids+=("$!")

wait_for_http "Frontend" "http://localhost:${FRONTEND_PORT}"

printf '\nFortune is running:\n'
printf '  Frontend:  http://localhost:%s\n' "${FRONTEND_PORT}"
printf '  Algorithms:http://127.0.0.1:%s/docs\n' "${ALGORITHM_PORT}"
printf '  Module 4:  http://127.0.0.1:%s/docs\n' "${MODULE4_PORT}"
printf '  Logs:      %s\n\n' "${LOG_DIR}"

if [[ "${OPEN_BROWSER:-0}" == "1" ]]; then
  open "http://localhost:${FRONTEND_PORT}"
fi

wait "${pids[2]}"
