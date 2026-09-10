#!/bin/sh
set -e

DATA_DIR="${PICTORIUM_DATA_DIR:-${POSTERIUM_DATA_DIR:-/data}}"
HF_STORAGE="${HF_STORAGE_DIR:-}"

echo "[entrypoint] ============================================"
echo "[entrypoint] Pictorium storage diagnostics"
echo "[entrypoint] ============================================"
echo "[entrypoint] DATA_DIR          = $DATA_DIR"
echo "[entrypoint] HF_STORAGE_DIR    = ${HF_STORAGE_DIR:-<not set>}"
echo "[entrypoint] CWD               = $(pwd)"
echo "[entrypoint] User              = $(id)"

if [ -n "$HF_STORAGE" ] && [ "$HF_STORAGE" != "$DATA_DIR" ]; then
  echo "[entrypoint] WARNING: HF_STORAGE_DIR ($HF_STORAGE) ≠ DATA_DIR ($DATA_DIR)"
fi

if [ -d "$DATA_DIR" ]; then
  if mount 2>/dev/null | grep -q " on $DATA_DIR "; then
    echo "[entrypoint] Mount info: $(mount 2>/dev/null | grep " on $DATA_DIR ")"
  elif command -v stat >/dev/null 2>&1; then
    FS_TYPE=$(stat -f -c '%T' "$DATA_DIR" 2>/dev/null || echo "unknown")
    echo "[entrypoint] Filesystem type: $FS_TYPE"
  fi

  STAT_INFO=$(ls -ld "$DATA_DIR" 2>/dev/null || echo "cannot stat")
  echo "[entrypoint] Dir permissions: $STAT_INFO"
else
  echo "[entrypoint] Creating $DATA_DIR"
  mkdir -p "$DATA_DIR"
fi

# Test write come utente processuale (nextjs, uid 1000 — il container gira non-root).
WRITE_TEST=$(touch "$DATA_DIR/.write_test" && rm -f "$DATA_DIR/.write_test" && echo ok 2>&1 || true)
if [ "$WRITE_TEST" = "ok" ]; then
  echo "[entrypoint] Storage: WRITABLE (process user)"
else
  echo "[entrypoint] Storage: NOT WRITABLE by process user (uid 1000)"
  echo "[entrypoint]"
  echo "[entrypoint] ========================================================"
  echo "[entrypoint] DATA WILL NOT PERSIST ACROSS REBUILDS!"
  echo "[entrypoint]"
  echo "[entrypoint] To fix:"
  echo "[entrypoint]   1. Ensure /data is owned by uid 1000 (Dockerfile chowns it)"
  echo "[entrypoint]   2. For HF: create bucket: https://huggingface.co/new-storage"
  echo "[entrypoint]   3. Link to Space: Settings → Storage → Link bucket"
  echo "[entrypoint]   4. Factory rebuild"
  echo "[entrypoint] ========================================================"
fi

echo "[entrypoint] ============================================"

# ---------------------------------------------------------------------------
# Self-warmup post-deploy (P4): la cache dei poster è in-memory, quindi ogni
# restart parte a freddo. Dopo il boot riscalda in background i poster più visti
# (trending + JustWatch + mappings) così le griglie Stremio non soffrono il primo
# burst a freddo. Disattivabile con PICTORIUM_SELF_WARMUP=0.
# Auth: se un ADMIN_TOKEN è configurato la route warmup lo richiede; altrimenti
# nessun header (istanza pubblica / dev: la route è fail-open). Il fallimento
# del warmup non deve mai bloccare il boot.
# ---------------------------------------------------------------------------
WARMUP_ENABLED="${PICTORIUM_SELF_WARMUP:-${POSTERIUM_SELF_WARMUP:-1}}"
if [ "$WARMUP_ENABLED" = "1" ]; then
  (
    HEALTH_URL="http://127.0.0.1:${PORT:-8080}/api/health?probe=1"
    # D2: warmup gentile al boot (seriale, niente JustWatch): su 512M il
    # default pieno (~110 target a concurrency 3) competeva con il traffico
    # reale per i 4 slot → OOM al boot. I poster dell'utente prima di tutto.
    WARMUP_URL="http://127.0.0.1:${PORT:-8080}/api/warmup?lang=it&trending=10&justwatch=0&mappings=20&concurrency=1"
    # Attende il server (poll su /api/health, max ~60s) prima di lanciare il
    # warmup: un boot lento non deve far partire i fetch contro un server spento.
    UP=0
    for _ in $(seq 1 60); do
      if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then UP=1; break; fi
      sleep 1
    done
    if [ "$UP" = "1" ]; then
      WARMUP_TOKEN="${PICTORIUM_WARMUP_TOKEN:-${POSTERIUM_WARMUP_TOKEN:-}}"
      ADMIN_TOKEN_VAL="${PICTORIUM_ADMIN_TOKEN:-${POSTERIUM_ADMIN_TOKEN:-$ADMIN_TOKEN}}"
      if [ -n "$WARMUP_TOKEN" ]; then
        curl -sS -m 300 -X POST -H "x-warmup-token: $WARMUP_TOKEN" "$WARMUP_URL" >/dev/null 2>&1 || true
      elif [ -n "$ADMIN_TOKEN_VAL" ]; then
        curl -sS -m 300 -X POST -H "x-admin-token: $ADMIN_TOKEN_VAL" "$WARMUP_URL" >/dev/null 2>&1 || true
      else
        curl -sS -m 300 -X POST "$WARMUP_URL" >/dev/null 2>&1 || true
      fi
      echo "[entrypoint] Self-warmup completed"
    else
      echo "[entrypoint] Server not up in time — self-warmup skipped"
    fi
  ) &
fi

exec env PICTORIUM_DATA_DIR="$DATA_DIR" POSTERIUM_DATA_DIR="$DATA_DIR" node server.js
