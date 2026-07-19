#!/usr/bin/env bash
# =============================================================================
# 共有bot(共通LINE) グローバル予算層: (account_id, 月) 集計 → platform_channel_budget.state
# 検証ハーネス
#
# develop の prior migration＋20260715092422〜092426＋20260716175640/175641/183019＋
# 20260719100549_platform_channel_budget.sql＋20260719100634_platform_budget_state_cron.sql を
# 1行も改変せず verbatim 適用し、platform_channel_budget_data.sql で境界を検証する
# （手コピー禁止・run_shared_bot_metering.sh と同型）。
# 使い捨てローカルクラスタを起動し終了時に破棄する。本番DBには一切触れない。
#
# 使い方: bash supabase/tests/run_platform_channel_budget.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PG14+ 想定）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/pcb.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54422
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

echo "== real prior migrations (verbatim) =="
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
apply "$MIG/20260716175640_shared_bot_metering_billable_push.sql"
apply "$MIG/20260716175641_shared_bot_metering_state_cron.sql"
apply "$MIG/20260716183019_shared_bot_metering_sent_only.sql"

echo "== target migrations (verbatim, unmodified) =="
apply "$MIG/20260719100549_platform_channel_budget.sql"
apply "$MIG/20260719100634_platform_budget_state_cron.sql"

echo "== platform budget checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/platform_channel_budget_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$OUT" || true
echo "PASS: $(grep -c 'PASS\[' "$OUT")  FAIL: $(grep -c 'FAIL\[' "$OUT")"
grep -q "PLATFORM BUDGET CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL PLATFORM BUDGET CHECKS PASSED (on real migrations)"
