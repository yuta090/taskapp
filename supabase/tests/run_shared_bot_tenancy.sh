#!/usr/bin/env bash
# =============================================================================
# 共有bot テナンシー検証ハーネス（実 migration 適用版）
#
# 設計正本 §3「検証ハーネスの規律」に従い、実 migration（20260715092422〜092426）を
# 1行も改変せず baseline に verbatim 適用して検証する。手コピー禁止。
# 並行系(g)は2接続で実際に同時実行し、ロック待ち→23505 graceful→敗者コード未消費を確認。
#
# 使い捨てローカルクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 使い方: bash supabase/tests/run_shared_bot_tenancy.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PG14+ 想定）。
# =============================================================================
set -euo pipefail

# REPO はスクリプト位置から解決（worktree 名に依存しない＝どのブランチからでも実行可）。
TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/sbt.XXXXXX)"
PGDATA="$WORK/data"
SOCK="$WORK/s"
PORT=54415
mkdir -p "$SOCK"

cleanup() {
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply() {
  echo "-- apply $(basename "$1")"
  psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null
}

echo "== baseline stubs =="
apply "$TST/harness/baseline_stubs.sql"

echo "== real prior migrations (verbatim) =="
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260710204722_channel_plumbing.sql"
apply "$MIG/20260711073329_channel_groups_digest.sql"
apply "$MIG/20260713123924_group_pickup_mode.sql"
apply "$MIG/20260714153028_digest_due_assignee.sql"

echo "== target migrations (verbatim, unmodified) =="
apply "$MIG/20260715092422_shared_bot_accounts_owner_type.sql"
apply "$MIG/20260715092423_shared_bot_groups_tenant_source.sql"
apply "$MIG/20260715092424_shared_bot_link_codes_binding.sql"
apply "$MIG/20260715092425_shared_bot_group_claims_rpc.sql"
apply "$MIG/20260715092426_shared_bot_org_channel_policy.sql"
# L3(errcode標準化)＋code_only 償還＋dedup/検知index を含めた完全スタックで PR1 検証を回す。
# これにより既存6アサート(e/f/c1 等)が GC4xx で飛んでも assert_raises 許容集合で緑になることを担保する。
apply "$MIG/20260716111033_shared_bot_code_only_redeem.sql"
# disabled 凍結ガード（create or replace）を重ねる。PR1 のアカウントは全て active のため、この
# 上乗せで既存アサートが全て緑なら approve への account-status チェック追加の「退行なし」を担保する。
apply "$MIG/20260716122144_shared_bot_disabled_freeze_rpc.sql"

echo "== single-session data + asserts =="
# client_min_messages を notice に上げて個別 PASS を表示
DATA_OUT="$WORK/data.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/shared_bot_tenancy_data.sql" > "$DATA_OUT" 2>&1 || { echo "DATA STEP FAILED"; grep -E "FAIL\[|ERROR" "$DATA_OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$DATA_OUT" || true
echo "single-session PASS: $(grep -c 'PASS\[' "$DATA_OUT")  FAIL: $(grep -c 'FAIL\[' "$DATA_OUT")"
grep -q "SINGLE-SESSION CHECKS PASSED" "$DATA_OUT" || { echo "SINGLE-SESSION NOT PASSED"; exit 1; }

echo "== (g) TRUE concurrency: 2 sessions racing to approve same group =="
C2='00000000-0000-0000-0000-0000000000c2'
CLAIM_A='00000000-0000-0000-0000-000000000307'  # lc7 (a2)
CLAIM_B='00000000-0000-0000-0000-000000000308'  # lc8 (a2), same account+external_group_id 'GCONC'
F1="$WORK/s1.out"; F2="$WORK/s2.out"

# セッション1: BEGIN → approve(A)（active行INSERT・unique ロック保持）→ pg_sleep で保持 → COMMIT
psql "$CONN" -v ON_ERROR_STOP=1 -q -A -t > "$F1" 2>&1 <<SQL &
begin;
select 's1='||rpc_approve_group_claim('$CLAIM_A','$C2')::text;
select pg_sleep(3);
commit;
SQL
S1=$!

# セッション1が pg_sleep(3) に入る（=approve完了・ロック保持中）まで待つ。bash sleep は使わず server-side pg_sleep でポール。
tries=0
until psql "$CONN" -q -A -t -c "select 1 from pg_stat_activity where state='active' and query ilike '%pg_sleep(3)%' limit 1" | grep -q 1; do
  psql "$CONN" -q -A -t -c "select pg_sleep(0.05)" >/dev/null 2>&1 || true
  tries=$((tries+1))
  if [ "$tries" -gt 200 ]; then echo "timeout waiting for session1"; break; fi
done

# セッション2: approve(B) は session1 のコミット済み active 行と衝突しロック待ち→ 23505 → graceful false
psql "$CONN" -v ON_ERROR_STOP=1 -q -A -t -c "select 's2='||rpc_approve_group_claim('$CLAIM_B','$C2')::text" > "$F2" 2>&1 || true

wait "$S1" || true

S1RES="$(grep -o 's1=[a-z]*' "$F1" | head -1 || true)"
S2RES="$(grep -o 's2=[a-z]*' "$F2" | head -1 || true)"
echo "session1: $S1RES / session2: $S2RES"
echo "-- s1.out --"; cat "$F1"; echo "-- s2.out --"; cat "$F2"

# デッドロック検出（40P01）が起きていないこと
if grep -qi "deadlock" "$F1" "$F2"; then echo "FAIL[g_no_deadlock]: deadlock detected"; exit 1; fi

# 最終状態の検証
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -q -A -t <<SQL
create or replace function assert_eq2(label text, got anyelement, want anyelement) returns void
language plpgsql as \$\$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end \$\$;
select assert_eq2('g_winner_true', '$S1RES'::text, 's1=true'::text);
select assert_eq2('g_loser_false', '$S2RES'::text, 's2=false'::text);
select assert_eq2('g_single_active_group', (select count(*)::int from channel_groups where external_group_id='GCONC' and status='active'), 1);
select assert_eq2('g_winner_claim_approved', (select status from channel_group_claims where id='$CLAIM_A'), 'approved');
select assert_eq2('g_loser_claim_rejected',  (select status from channel_group_claims where id='$CLAIM_B'), 'rejected');
select assert_eq2('g_winner_code_consumed',  (select (consumed_at is not null) from channel_link_codes where id='00000000-0000-0000-0000-000000000107'), true);
select assert_eq2('g_loser_code_not_consumed',(select (consumed_at is null)    from channel_link_codes where id='00000000-0000-0000-0000-000000000108'), true);
SQL

echo ""
echo "ALL CHECKS PASSED (single-session + true-concurrency, on real migrations)"
