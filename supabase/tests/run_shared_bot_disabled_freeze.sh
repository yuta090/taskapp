#!/usr/bin/env bash
# =============================================================================
# 共有bot disabled 凍結（Fable裁定 §6）: claim RPC の account-status ガード検証ハーネス
#
# develop の prior migration＋20260715092422〜092426＋20260716111033＋
# 20260716122144（本 migration）を1行も改変せず verbatim 適用し、
# shared_bot_disabled_freeze_data.sql で境界を検証する（手コピー禁止）。
# 使い捨てローカルクラスタを起動し終了時に破棄する。本番DBには一切触れない。
#
# 使い方: bash supabase/tests/run_shared_bot_disabled_freeze.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PG14+ 想定）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/sbdf.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54421
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
apply "$MIG/20260716111033_shared_bot_code_only_redeem.sql"

echo "== target migration (verbatim, unmodified) =="
apply "$MIG/20260716122144_shared_bot_disabled_freeze_rpc.sql"

echo "== disabled-freeze checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/shared_bot_disabled_freeze_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$OUT" || true
echo "PASS: $(grep -c 'PASS\[' "$OUT")  FAIL: $(grep -c 'FAIL\[' "$OUT")"
grep -q "DISABLED_FREEZE CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL DISABLED_FREEZE CHECKS PASSED (on real migrations)"
