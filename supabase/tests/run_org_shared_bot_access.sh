#!/usr/bin/env bash
# =============================================================================
# 共通LINE org単位 shared_bot_access backfill 検証ハーネス
#
# 実 prior migration(channel_plumbing〜092426) を verbatim 適用 → 痕跡 setup →
# 20260720223422_org_shared_bot_access.sql（列追加＋backfill） → org_billing stub →
# 20260720201858_org_push_quota_from_plan.sql（quota trigger・非クロバー確認用） を適用し、
# org_shared_bot_access_data.sql で backfill と非クロバーを検証する。使い捨てクラスタで破棄。
#
# 使い方: bash supabase/tests/run_org_shared_bot_access.sh
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/osba.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54426
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

echo "== baseline + prior migrations (verbatim) =="
apply "$TST/harness/baseline_stubs.sql"
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260710204722_channel_plumbing.sql"
apply "$MIG/20260711073329_channel_groups_digest.sql"
apply "$MIG/20260713123924_group_pickup_mode.sql"
apply "$MIG/20260714153028_digest_due_assignee.sql"
apply "$MIG/20260715092422_shared_bot_accounts_owner_type.sql"
apply "$MIG/20260715092423_shared_bot_groups_tenant_source.sql"
apply "$MIG/20260715092424_shared_bot_link_codes_binding.sql"
apply "$MIG/20260715092425_shared_bot_group_claims_rpc.sql"
apply "$MIG/20260715092426_shared_bot_org_channel_policy.sql"

echo "== trace setup (before backfill) =="
apply "$TST/harness/org_shared_bot_access_setup.sql"

echo "== target migration (verbatim) =="
apply "$MIG/20260720223422_org_shared_bot_access.sql"

echo "== billing stub + quota trigger (non-clobber check) =="
apply "$TST/harness/org_billing_stub.sql"
apply "$MIG/20260720201858_org_push_quota_from_plan.sql"

echo "== shared_bot_access checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/org_shared_bot_access_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$OUT" || true
echo "PASS: $(grep -c 'PASS\[' "$OUT")  FAIL: $(grep -c 'FAIL\[' "$OUT")"
grep -q "ORG SHARED BOT ACCESS CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL ORG SHARED BOT ACCESS CHECKS PASSED (on real migrations)"
