#!/usr/bin/env bash
# =============================================================================
# 社内承認の依頼の通知（*_review_request_notify.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役）を足す。
# migration は1行も変えない。
# 本 migration の前に review_request_notify_seed.sql で「通知が届いていない保留中の承認」を作り、
# 本 migration を2回適用して（冪等）、review_request_notify_assert.sql で確かめる:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  変えないもの（両方で PASS）
# 続けて GREEN のときだけ:
#   scope_*    本 migration で本文が変わる関数は rpc_review_open だけ。実行権・SECURITY DEFINER・search_path・
#              ほかの関数・トリガー（止めたプッシュを含む）・ポリシー・列は変わらない
#   reapply_*  データが入った状態で再適用できる（後から足す通知が二重にならない）
#   guard_*    rpc_review_open の今の定義が土台と違えば適用が止まり、何も変わらない
#
# 使い方:
#   bash supabase/tests/run_review_request_notify.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_review_request_notify.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#       （本 migration のファイルがまだ無いときは、今ある migrations を全部流す）
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

shopt -s nullglob
targets=("$MIG"/*_review_request_notify.sql)
shopt -u nullglob
if [ "${#targets[@]}" -eq 1 ]; then
  TARGET="${targets[0]}"
elif [ "${#targets[@]}" -eq 0 ] && [ "$RED" = "1" ]; then
  TARGET=""
else
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi

WORK="$(mktemp -d /tmp/rrn.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54453
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

# 本 migration・確認用の SQL は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# 本 migration で変わってはいけないものの指紋（データは含まない）。
#   rpc_review_open だけは本文（md5）を除き、実行権・SECURITY DEFINER・search_path は見る
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'fn ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || case when p.oid = 'public.rpc_review_open(uuid,uuid[],uuid)'::regprocedure then '' else ' ' || md5(p.prosrc) end as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
) s order by x;
SQL
}

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"

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

echo "== seed: 通知が届いていない保留中の承認（本 migration の前からあるデータ） =="
apply base "$TST/review_request_notify_seed.sql"

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

echo "== checks: review_request_notify_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/review_request_notify_assert.sql" > "$OUT" 2>&1
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

echo "== scope: 変わるのは rpc_review_open の本文と、依頼のお知らせを片付ける関数2つ・トリガー2つだけ =="
# 片付けの関数・トリガー（の行）は本 migration で増えるものなので外して比べる（中身は assert の chg_* で確かめる）
fingerprint base | grep -v -e 'app_review_approval_settle_notice' -e 'app_review_cancel_settle_notice' > "$WORK/fp_after.txt"
if diff -q "$WORK/fp_before.txt" "$WORK/fp_after.txt" >/dev/null; then
  record "PASS[scope_only_intended_objects_changed]: same"
else
  record "FAIL[scope_only_intended_objects_changed]: $(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | head -5 | tr '\n' ' ')"
fi
N_NEW_TRG="$(q base "select count(*) from pg_trigger where tgname in ('review_approvals_settle_notice', 'reviews_cancel_settle_notice')")"
if [ "$N_NEW_TRG" = "2" ]; then record "PASS[scope_settle_triggers_added]: $N_NEW_TRG"; else record "FAIL[scope_settle_triggers_added]: $N_NEW_TRG"; fi

echo "== re-apply with data present =="
N_BEFORE="$(q checks "select count(*) from public.notifications")"
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi
N_AFTER="$(q checks "select count(*) from public.notifications")"
if [ "$N_BEFORE" = "$N_AFTER" ]; then
  record "PASS[reapply_no_duplicate_notice]: $N_AFTER"
else
  record "FAIL[reapply_no_duplicate_notice]: $N_BEFORE -> $N_AFTER"
fi

echo "== guard: rpc_review_open の今の定義が土台と違えば止まる =="
newdb -T pre guard
# 本番だけに手直しがある場合の代役: 本文のコメントを1か所だけ変える
q guard "do \$g\$ declare d text; begin d := pg_get_functiondef('public.rpc_review_open(uuid,uuid[],uuid)'::regprocedure); execute replace(d, '-- Create audit log', '-- Create audit log (local change)'); end \$g\$;" >/dev/null
if apply guard "$TARGET" 2>"$WORK/guard_err.txt"; then
  record "FAIL[guard_stops_on_changed_body]: applied"
elif grep -q "rpc_review_open" "$WORK/guard_err.txt"; then
  record "PASS[guard_stops_on_changed_body]: stopped"
else
  record "FAIL[guard_stops_on_changed_body]: $(head -1 "$WORK/guard_err.txt")"
fi
N_PRE="$(q pre "select count(*) from public.notifications")"
N_GUARD="$(q guard "select count(*) from public.notifications")"
TRG_GUARD="$(q guard "select tgenabled from pg_trigger where tgname = 'notifications_push_dispatch'")"
if [ "$N_PRE" = "$N_GUARD" ] && [ "$TRG_GUARD" = "O" ]; then
  record "PASS[guard_changes_nothing]: notifications=$N_GUARD push_trigger=$TRG_GUARD"
else
  record "FAIL[guard_changes_nothing]: notifications $N_PRE -> $N_GUARD, push_trigger=$TRG_GUARD"
fi

echo ""
sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ] || [ "$NPASS" -eq 0 ]; then
  echo "REVIEW REQUEST NOTIFY CHECKS FAILED"; exit 1
fi
echo "REVIEW REQUEST NOTIFY CHECKS PASSED"
