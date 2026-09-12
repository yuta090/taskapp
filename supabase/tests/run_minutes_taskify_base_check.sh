#!/usr/bin/env bash
# =============================================================================
# 議事録のタスク化が、隙間に入った他の人の書き込みを消さないか
#   （*_minutes_taskify_base_check.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の
# 上に supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証用の
# データベースを作る。migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/space_role_boundary_setup.sql      表・関数の既定の権限・auth.uid()・service_role の bypassrls
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権
# そのうえで本 migration を2回適用し（冪等）、複製で minutes_taskify_base_check_assert.sql を流す。
# GREEN のときはさらに:
#   scope_*   増減するのは rpc_parse_meeting_minutes の本体と説明だけ（表・権限・ポリシーは動かない）
#   acl_*     関数の実行権は create or replace で変わらない（authenticated と service_role のまま）
#
# 使い方:
#   bash supabase/tests/run_minutes_taskify_base_check.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_minutes_taskify_base_check.sh    # 本 migration を流さずに同じ assert を回し、
#       chg_* が全て FAIL・same_* が全て PASS すること（＝テストが変化を捉えていること）を確かめる
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
ASSERT="$TST/minutes_taskify_base_check_assert.sql"
RED="${RED:-0}"

shopt -s nullglob
targets=("$MIG"/*_minutes_taskify_base_check.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"

WORK="$(mktemp -d /tmp/mtbc.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54471
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

# 本 migration は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じくトランザクションで包まない。
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# 関数の姿（本体の md5・definer・search_path・実行権）と、表・ポリシー・権限の姿
fn_shape(){ q "$1" "select md5(prosrc) || ' definer=' || prosecdef::text || ' config=' || coalesce(array_to_string(proconfig, ';'), '') from pg_proc where oid = 'public.rpc_parse_meeting_minutes(uuid,text)'::regprocedure"; }
fn_acl(){ q "$1" "select coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(proacl) ai), '<null>') from pg_proc where oid = 'public.rpc_parse_meeting_minutes(uuid,text)'::regprocedure"; }
rel_shape(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'rel ' || c.relname || ' ' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
         || ' rls=' || c.relrowsecurity::text as x
    from pg_class c where c.relnamespace = 'public'::regnamespace
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public'
) s order by x;
SQL
}

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"
apply base "$TST/harness/supabase_function_default_acl.sql"

echo "== prior migrations (verbatim, same order as verify-migrations-from-scratch.sh, up to the target) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  [ "$f" = "$TARGET" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

FN_BEFORE="$(fn_shape base)"
ACL_BEFORE="$(fn_acl base)"
rel_shape base > "$WORK/rel_before.txt"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base checks

echo "== checks: minutes_taskify_base_check_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$OUT" 2>&1
set -e
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true
if grep "ERROR" "$OUT" | grep -qv "MINUTES TASKIFY BASE CHECK FAILED"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  BAD_FAIL="$(grep -oE '^FAIL\[[a-z0-9_]+\]' "$RES" | sed -E 's/^FAIL\[(.*)\]$/\1/' | grep -v '^chg_' || true)"
  BAD_PASS="$(grep -oE '^PASS\[[a-z0-9_]+\]' "$RES" | sed -E 's/^PASS\[(.*)\]$/\1/' | grep '^chg_' || true)"
  if [ -n "$BAD_FAIL" ]; then
    echo "RED MISMATCH: same_* did not hold without the migration:"; printf '  %s\n' $BAD_FAIL; exit 1
  fi
  if [ -n "$BAD_PASS" ]; then
    echo "RED MISMATCH: chg_* held without the migration (the assert does not detect the rule):"; printf '  %s\n' $BAD_PASS; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: every assert held without the migration"; exit 1
  fi
  echo ""
  echo "RED CONFIRMED: without the migration, all $NFAIL chg_* assert(s) do not hold and all $NPASS same_* assert(s) hold"
  exit 0
fi

echo "== scope: 変わるのは関数の本体だけ（表・列・ポリシー・表の権限は動かない） =="
rel_shape base > "$WORK/rel_after.txt"
if diff -q "$WORK/rel_before.txt" "$WORK/rel_after.txt" >/dev/null; then
  record "PASS[scope_no_table_or_policy_change]: $(wc -l < "$WORK/rel_before.txt" | tr -d ' ') objects unchanged"
else
  record "FAIL[scope_no_table_or_policy_change]: 表・列・ポリシー・権限が動いた"
  diff -u "$WORK/rel_before.txt" "$WORK/rel_after.txt" | head -20
fi

FN_AFTER="$(fn_shape base)"
if [ "$FN_AFTER" != "$FN_BEFORE" ] && [ "${FN_AFTER#*definer=}" = "${FN_BEFORE#*definer=}" ]; then
  record "PASS[scope_only_function_body_changed]: definer と search_path は同じまま、本体だけ変わった"
else
  record "FAIL[scope_only_function_body_changed]: before=$FN_BEFORE after=$FN_AFTER"
fi

echo "== acl: 実行権は create or replace で変わらない =="
ACL_AFTER="$(fn_acl base)"
if [ "$ACL_AFTER" = "$ACL_BEFORE" ] && [ -n "$ACL_AFTER" ] && [ "$ACL_AFTER" != "<null>" ]; then
  record "PASS[acl_execute_unchanged]: $ACL_AFTER"
else
  record "FAIL[acl_execute_unchanged]: before=$ACL_BEFORE after=$ACL_AFTER"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "MINUTES TASKIFY BASE CHECK PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL MINUTES TASKIFY BASE CHECKS PASSED (on real migrations)"
