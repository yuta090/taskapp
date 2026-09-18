#!/usr/bin/env bash
# =============================================================================
# 「社内承認がそろったらタスクを完了にする」（*_review_auto_complete.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/space_role_boundary_setup.sql      表・関数の既定の権限・auth.uid()（request.jwt.claims）・service_role の bypassrls
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権
# 本 migration の前に review_auto_complete_seed.sql（人・タスク）を入れ、本 migration を2回適用して（冪等）、
# review_auto_complete_assert.sql で確かめる:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  変えないもの（両方で PASS）
# 続けて GREEN のときだけ:
#   scope_*     本文が変わる関数は _review_approve_impl だけ。実行権・SECURITY DEFINER・search_path・
#               ほかの関数（差し戻しの _review_block_impl を含む）・トリガー・ポリシー・列・表の権限は変わらない
#   reapply_*   データが入った状態で再適用できる
#   guard_*     今の定義が土台（20260915123012_review_result_notify.sql）と違えば適用が止まり、何も変わらない
#   rollback_*  ファイル先頭のロールバック手順（土台の _review_approve_impl の create or replace を流す）で
#               土台の本文に戻り、戻したあと再適用できる
#
# 使い方:
#   bash supabase/tests/run_review_auto_complete.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_review_auto_complete.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS することを確認する
#   PORT=<番号> TMPBASE=<フォルダ> で、使い捨てクラスタのポートと置き場所を変えられる
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
BASE_MIG="$MIG/20260915123012_review_result_notify.sql"
RED="${RED:-0}"
PORT="${PORT:-55494}"
TMPBASE="${TMPBASE:-/tmp}"

# 土台（20260915123012_review_result_notify.sql）の _review_approve_impl の本文の md5
BASE_APPROVE_MD5='dd76aa93676fd8d5312e6c5ccf86a9a7'
APPROVE_SIG='public._review_approve_impl(uuid,uuid,uuid)'

shopt -s nullglob
targets=("$MIG"/*_review_auto_complete.sql)
shopt -u nullglob
if [ "${#targets[@]}" -eq 1 ]; then
  TARGET="${targets[0]}"
elif [ "${#targets[@]}" -eq 0 ] && [ "$RED" = "1" ]; then
  TARGET=""
else
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi

mkdir -p "$TMPBASE"
WORK="$(mktemp -d "$TMPBASE/rac.XXXXXX")"
PGDATA="$WORK/data"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster (127.0.0.1:$PORT) =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -w start >/dev/null 2>&1 \
  || { echo "cluster did not start:"; tail -5 "$WORK/pg.log"; exit 1; }
conn(){ echo "host=127.0.0.1 port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h 127.0.0.1 -p "$PORT" -U postgres "$@"; }

# 本 migration・確認用の SQL は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }
md5_of(){ q "$1" "select coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('$2')), 'none')"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# 本 migration で変わってはいけないものの指紋（データは含まない）。
#   _review_approve_impl だけは本文（md5）を除き、実行権・SECURITY DEFINER・search_path は見る
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'fn ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || case when p.oid = 'public._review_approve_impl(uuid,uuid,uuid)'::regprocedure
                 then '' else ' ' || md5(p.prosrc) end as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g')
         || ' ' || regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')
    from pg_policies where schemaname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
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
  [ -n "$TARGET" ] && [ "$f" = "$TARGET" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

echo "== seed: 人とタスク（本 migration の前からあるデータ） =="
apply base "$TST/review_auto_complete_seed.sql"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  # 本 migration の前の状態を残しておく（scope_* / guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base checks

echo "== checks: review_auto_complete_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/review_auto_complete_assert.sql" > "$OUT" 2>&1
set -e
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# assert の中のエラーは test.act が文字列にして返すので、ここに出る ERROR はハーネスかテストデータの不備
if grep -q "ERROR" "$OUT"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  NPASS="$(grep -c '^PASS\[' "$RES" || true)"
  NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  FAIL_LABELS="$(grep -oE '^FAIL\[[a-z0-9_]+\]' "$RES" | sed -E 's/^FAIL\[(.*)\]$/\1/' | sort -u || true)"
  PASS_LABELS="$(grep -oE '^PASS\[[a-z0-9_]+\]' "$RES" | sed -E 's/^PASS\[(.*)\]$/\1/' | sort -u || true)"
  BAD_FAIL="$(printf '%s\n' "$FAIL_LABELS" | grep -v '^$' | grep -v '^chg_' || true)"
  BAD_PASS="$(printf '%s\n' "$PASS_LABELS" | grep '^chg_' || true)"
  if [ -n "$BAD_FAIL" ]; then
    echo "RED MISMATCH: same_* did not hold without the migration (the label should be chg_*, or the expectation is wrong):"
    printf '  %s\n' $BAD_FAIL; exit 1
  fi
  if [ -n "$BAD_PASS" ]; then
    echo "RED MISMATCH: chg_* held without the migration (the assert does not detect the change):"
    printf '  %s\n' $BAD_PASS; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: every assert held without the migration"; exit 1
  fi
  echo ""
  echo "RED CONFIRMED: without the migration, all $NFAIL chg_* assert(s) do not hold and all $NPASS same_* assert(s) hold"
  exit 0
fi

echo "== scope: 本文が変わるのは _review_approve_impl だけ（差し戻しの本体は触らない） =="
fingerprint base > "$WORK/fp_after.txt"
if diff -q "$WORK/fp_before.txt" "$WORK/fp_after.txt" >/dev/null; then
  record "PASS[scope_only_approve_body_changed]: same"
else
  record "FAIL[scope_only_approve_body_changed]: $(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | head -6 | tr '\n' ' ')"
fi
A_MD5="$(md5_of base "$APPROVE_SIG")"
if [ "$A_MD5" != "$BASE_APPROVE_MD5" ] && [ "$A_MD5" != "none" ]; then
  record "PASS[scope_approve_body_replaced]: approve=$A_MD5"
else
  record "FAIL[scope_approve_body_replaced]: approve=$A_MD5"
fi

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== guard: 今の定義が土台と違えば止まる =="
guard_case(){
  local label="$1" sig="$2" name="$3"
  newdb -T pre "guard_$label"
  # 本番だけに手直しがある場合の代役: 本文のコメントを1か所だけ変える（実行権は create or replace で保たれる）
  q "guard_$label" "do \$g\$ declare d text; begin d := pg_get_functiondef('$sig'::regprocedure); execute replace(d, '-- Create audit log', '-- Create audit log (local change)'); end \$g\$;" >/dev/null
  local a_before
  a_before="$(md5_of "guard_$label" "$APPROVE_SIG")"
  if apply "guard_$label" "$TARGET" 2>"$WORK/guard_err_$label.txt"; then
    record "FAIL[guard_stops_on_changed_${label}]: applied"
  elif grep -q "$name" "$WORK/guard_err_$label.txt"; then
    record "PASS[guard_stops_on_changed_${label}]: stopped"
  else
    record "FAIL[guard_stops_on_changed_${label}]: $(head -1 "$WORK/guard_err_$label.txt")"
  fi
  local a_after
  a_after="$(md5_of "guard_$label" "$APPROVE_SIG")"
  if [ "$a_before" = "$a_after" ]; then
    record "PASS[guard_${label}_changes_nothing]: approve=$a_after"
  else
    record "FAIL[guard_${label}_changes_nothing]: approve $a_before -> $a_after"
  fi
}
guard_case approve "$APPROVE_SIG" "_review_approve_impl"

echo "== rollback: 土台の create or replace を流すと元の本文に戻り、そのあと再適用できる =="
newdb -T base rollback
RB="$WORK/rollback.sql"
awk '/^create or replace function public\._review_approve_impl\(/{f=1} f{print} f && /^\$\$;$/{f=0}' "$BASE_MIG" > "$RB"
fingerprint rollback > "$WORK/fp_rb_before.txt"
if apply rollback "$RB"; then
  A_RB="$(md5_of rollback "$APPROVE_SIG")"
  fingerprint rollback > "$WORK/fp_rb_after.txt"
  if [ "$A_RB" = "$BASE_APPROVE_MD5" ] \
     && diff -q "$WORK/fp_rb_before.txt" "$WORK/fp_rb_after.txt" >/dev/null; then
    record "PASS[rollback_restores_base_body]: approve=$A_RB"
  else
    record "FAIL[rollback_restores_base_body]: approve=$A_RB $(diff "$WORK/fp_rb_before.txt" "$WORK/fp_rb_after.txt" | head -4 | tr '\n' ' ')"
  fi
  if apply rollback "$TARGET"; then
    record "PASS[rollback_then_reapply]: approve=$(md5_of rollback "$APPROVE_SIG")"
  else
    record "FAIL[rollback_then_reapply]: apply failed"
  fi
else
  record "FAIL[rollback_restores_base_body]: rollback sql failed"
fi

echo ""
sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ] || [ "$NPASS" -eq 0 ]; then
  echo "REVIEW AUTO COMPLETE CHECKS FAILED"; exit 1
fi
echo "REVIEW AUTO COMPLETE CHECKS PASSED"
