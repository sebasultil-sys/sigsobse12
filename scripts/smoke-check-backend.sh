#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://sigsobse-backend.onrender.com}"
RUNS="${2:-2}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-25}"

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "RUNS debe ser un entero >= 1"
  exit 1
fi

check_endpoint() {
  local path="$1"
  local expected="$2"
  local url="${BASE_URL%/}${path}"
  local tmp_file
  tmp_file="$(mktemp)"

  local http_code
  http_code="$(curl -sS --max-time "${TIMEOUT_SECONDS}" -o "${tmp_file}" -w "%{http_code}" "${url}")"
  local body
  body="$(cat "${tmp_file}")"
  rm -f "${tmp_file}"

  if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
    echo "FAIL ${url} -> HTTP ${http_code}"
    echo "${body}"
    exit 1
  fi

  if [[ -n "${expected}" ]] && [[ "${body}" != *"${expected}"* ]]; then
    echo "FAIL ${url} -> falta texto esperado: ${expected}"
    echo "${body}"
    exit 1
  fi

  echo "OK   ${url} -> HTTP ${http_code}"
}

echo "Smoke check backend: ${BASE_URL} (corridas=${RUNS})"
for run in $(seq 1 "${RUNS}"); do
  echo ""
  echo "Corrida ${run}/${RUNS}"
  check_endpoint "/health" "\"ok\":true"
  check_endpoint "/api/health" "\"ok\":true"
  check_endpoint "/api/layers" "\"tables\""
  check_endpoint "/api/kpis/summary?force=1" "\"totals\""
  check_endpoint "/api/kpis/audit?force=1" "\"audit\""
done

echo ""
echo "Smoke check completado correctamente."
