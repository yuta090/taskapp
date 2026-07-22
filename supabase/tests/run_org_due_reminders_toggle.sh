#!/usr/bin/env bash
# =============================================================================
# org 単位 自動期限リマインドトグル 検証ハーネス
#   対象: supabase/migrations/20260721215120_org_due_reminders_toggle.sql
#
# 実 prior migration（rls_helpers / channel chain / 092426 org_channel_policy /
# shared_bot_access / quota trigger / on_exceed block）を verbatim 適用し、
# 「backfill 済みで policy 行が存在する」実DB状態を再現したうえで対象 migration を適用する。
#
# 主眼（★HIGH-1）: 旧設計の列 GRANT ＋ RLS ポリシー方式は PostgREST upsert
#   (on conflict do update set org_id = excluded.org_id, ...) で permission denied になり、
#   行が既に存在する org（＝ほぼ全org）でトグルが壊れていた。本ハーネスはその失敗を再現し、
#   新 RPC 経路 rpc_set_org_due_reminders_enabled では同じケースが通ることを固定する。
#
# 使い方: bash supabase/tests/run_org_due_reminders_toggle.sh
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。使い捨てクラスタで破棄。本番DBには触れない。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
TARGET="$MIG/20260721215120_org_due_reminders_toggle.sql"

WORK="$(mktemp -d /tmp/odrt.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54433
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
psql "$CONN" -q -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto' >/dev/null
apply "$TST/harness/baseline_stubs.sql"
# auth.role() スタブ（baseline_stubs は auth.uid() のみ）。本番は JWT 由来。テストは GUC test.role で切替。
psql "$CONN" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('test.role', true), ''), current_user::text);
$$;
SQL
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
apply "$MIG/20260720223422_org_shared_bot_access.sql"
apply "$TST/harness/org_billing_stub.sql"
apply "$MIG/20260720201858_org_push_quota_from_plan.sql"
apply "$MIG/20260721193407_free_quota_on_exceed_block.sql"

echo "== setup (pre-migration state: backfill 済み policy 行 + 既存 -1440 occurrence) =="
apply "$TST/harness/org_due_reminders_toggle_setup.sql"

echo "== target migration (verbatim) =="
apply "$TARGET"

echo "== checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/org_due_reminders_toggle_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR|try_as denied" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[A-Za-z0-9_]+\]" "$OUT" || true
echo "-- 拒否された操作の実エラー（期待どおりの permission denied か確認用） --"
grep -E "try_as denied" "$OUT" || true
grep -q "ORG DUE REMINDERS TOGGLE CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }

echo "== re-apply target migration (idempotency) =="
apply "$TARGET"
OUT2="$WORK/o2.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/org_due_reminders_toggle_idempotent.sql" > "$OUT2" 2>&1 \
  || { echo "IDEMPOTENT STEP FAILED"; grep -E "FAIL\[|ERROR|try_as denied" "$OUT2" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[A-Za-z0-9_]+\]" "$OUT2" || true
grep -q "ORG DUE REMINDERS TOGGLE IDEMPOTENT CHECKS PASSED" "$OUT2" || { echo "NOT PASSED"; tail -30 "$OUT2"; exit 1; }

echo ""
echo "PASS: $(( $(grep -c 'PASS\[' "$OUT") + $(grep -c 'PASS\[' "$OUT2") ))  FAIL: $(( $(grep -c 'FAIL\[' "$OUT") + $(grep -c 'FAIL\[' "$OUT2") ))"
echo "ALL ORG DUE REMINDERS TOGGLE CHECKS PASSED (on real migrations)"
