#!/usr/bin/env bash
# =============================================================================
# 共通LINE org別クォータ同期(トリガー＋backfill) 検証ハーネス
#
# baseline_stubs → rls_helpers → org_channel_policy migration → org_billing スタブ(＋既存行) →
# 20260720201858_org_push_quota_from_plan.sql を verbatim 適用し、org_push_quota_sync_data.sql で
# backfill / トリガー(insert・upgrade・downgrade・canceled・past_due猶予・不明plan)・非破壊を検証する。
# 使い捨てクラスタを起動し終了時に破棄する。本番DBには一切触れない。
#
# 使い方: bash supabase/tests/run_org_push_quota_sync.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PG14+ 想定）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/opq.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54424
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

echo "== baseline stubs =="
apply "$TST/harness/baseline_stubs.sql"

echo "== prerequisite migrations (verbatim) =="
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260715092426_shared_bot_org_channel_policy.sql"

echo "== org_billing stub + pre-existing rows (for backfill) =="
apply "$TST/harness/org_billing_stub.sql"

echo "== target migration (verbatim, unmodified) =="
apply "$MIG/20260720201858_org_push_quota_from_plan.sql"

echo "== quota sync checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/org_push_quota_sync_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$OUT" || true
echo "PASS: $(grep -c 'PASS\[' "$OUT")  FAIL: $(grep -c 'FAIL\[' "$OUT")"
grep -q "ORG PUSH QUOTA SYNC CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL ORG PUSH QUOTA SYNC CHECKS PASSED (on real migration)"
