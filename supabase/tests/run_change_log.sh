#!/usr/bin/env bash
# =============================================================================
# データの変更の控え（*_change_log.sql）の検証ハーネス
#
# 起動済みの Postgres（scripts/verify-migrations-from-scratch.sh と同じ 127.0.0.1:55432）に使い捨ての DB を作り、
# _local_bootstrap.sql → 権限の代役（harness/space_role_boundary_setup.sql・supabase_function_default_acl.sql）→
# supabase/migrations を先頭から順に verbatim で流す（本 migration を含む）。本 migration はもう1回流す（冪等）。
# そのあと change_log.test.sql で挙動を確かめる（PASS[label] / FAIL[label]）。
#
# 使い方:
#   bash supabase/tests/run_change_log.sh
#   PGPORT=<番号> で接続先のポートを変えられる
# 必要: PostgreSQL 17（psql）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
PORT="${PGPORT:-55432}"
HOST="127.0.0.1"
DB="change_log_test_$$"

shopt -s nullglob
targets=("$MIG"/*_change_log.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1; fi
TARGET="${targets[0]}"

pg_isready -h "$HOST" -p "$PORT" -q || { echo "Postgres が $HOST:$PORT で起動していません"; exit 1; }

WORK="$(mktemp -d)"
cleanup(){ psql -h "$HOST" -p "$PORT" -U postgres -q -c "drop database if exists \"$DB\";" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

conn="host=$HOST port=$PORT user=postgres dbname=$DB"
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$conn" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
apply_tx(){ PGOPTIONS='--client-min-messages=warning' psql "$conn" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

psql -h "$HOST" -p "$PORT" -U postgres -q -c "create database \"$DB\";"

echo "== bootstrap + Supabase の権限の代役 =="
apply_plain "$TST/_local_bootstrap.sql"
apply_tx "$TST/harness/space_role_boundary_setup.sql"
apply_tx "$TST/harness/supabase_function_default_acl.sql"

echo "== migrations (verbatim) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  if ! apply_plain "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

echo "== target migration again (idempotent, one transaction): $(basename "$TARGET") =="
apply_tx "$TARGET"

echo "== checks: change_log.test.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$conn" -v ON_ERROR_STOP=1 -f "$TST/change_log.test.sql" > "$OUT" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ] || grep -q "ERROR" "$OUT"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

RES="$WORK/results.txt"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" > "$RES" || true
sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ] || [ "$NPASS" -eq 0 ]; then
  echo "CHANGE LOG CHECKS FAILED"; exit 1
fi
echo "CHANGE LOG CHECKS PASSED"
