#!/usr/bin/env bash
# =============================================================================
# 見積の行を消すときの見張りが、タスク・space を消したときの連鎖削除を通す（*_task_pricing_guard_cascade.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役）を足す。
# migration は1行も変えない。space の外部キーを CASCADE にする *_task_pricing_space_cascade.sql が先に要る。
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      task_pricing_guard_assert.sql（タスク・space を消したときの連鎖・見積の行だけを消すときの見張り）
# 続けて GREEN のときだけ:
#   scope_*     本 migration で変わるのは guard_task_pricing_delete の本文だけ（SECURITY DEFINER・search_path・実行権は同じ）
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を流すと、土台の本文（適用前のスキーマ）と挙動に戻る → 戻したあと再適用できる
#   guard_*     節 1 の確認が効く: 今の定義が土台と違う／search_path が public でない、のどちらでも適用が止まり、何も変わらない
#
# assert の label:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  本 migration で変えないもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_task_pricing_guard.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_task_pricing_guard.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
#   使い捨てクラスタは1つだけ起動し、終わると必ず止めて消す。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
ASSERT="$TST/task_pricing_guard_assert.sql"
RED="${RED:-0}"
FN='guard_task_pricing_delete()'
BASE_MD5='e3de091831b5e37a2b926eb6e5fee99c'

shopt -s nullglob
targets=("$MIG"/*_task_pricing_guard_cascade.sql)
cascade=("$MIG"/*_task_pricing_space_cascade.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"
if [ "${#cascade[@]}" -ne 1 ] || [[ "$(basename "${cascade[0]}")" > "$(basename "$TARGET")" ]]; then
  echo "*_task_pricing_space_cascade.sql must exist and come before $(basename "$TARGET")"; exit 1
fi

WORK="$(mktemp -d /tmp/tpg.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54456
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

# 本 migration・確認用の SQL は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す。
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない。
#   関数は SECURITY DEFINER・search_path・実行権・本文の md5（行の最後）を見る。
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
         || ' rls=' || c.relrowsecurity::text as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'idx ' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'colacl ' || c.relname || '.' || a.attname || ' '
         || (select string_agg(ai::text, ',' order by ai::text) from unnest(a.attacl) ai)
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and a.attacl is not null and cardinality(a.attacl) > 0
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'fn ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || ' md5=' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || convalidated::text || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

# 見張りの関数の今の形（本文の md5・SECURITY DEFINER・search_path・実行権）。guard_* で「何も変わっていない」ことを見る
fnstate(){
  q "$1" "select md5(p.prosrc) || ' definer=' || p.prosecdef::text || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
                 || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
            from pg_proc p where p.oid = 'public.$FN'::regprocedure"
}

run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "TASK PRICING GUARD CHECKS FAILED"; then
    echo "HARNESS ERROR ($1):"; grep -B2 -A3 "ERROR" "$2" | head -40; exit 1
  fi
}

# assert の結果の形: all_pass（全 PASS）/ red（chg_* が全て FAIL・same_* が全て PASS）/ mixed（それ以外。理由つき）
shape(){
  local labels passes fails np nf badf badp
  labels="$(grep -oE '(PASS|FAIL)\[[a-z0-9_]+\]' "$1" || true)"
  passes="$(printf '%s\n' "$labels" | sed -nE 's/^PASS\[(.*)\]$/\1/p' | sort -u)"
  fails="$(printf '%s\n' "$labels" | sed -nE 's/^FAIL\[(.*)\]$/\1/p' | sort -u)"
  np="$(printf '%s\n' "$passes" | grep -c . || true)"
  nf="$(printf '%s\n' "$fails" | grep -c . || true)"
  if [ "$nf" -eq 0 ] && [ "$np" -gt 0 ]; then echo "all_pass: $np passed"; return; fi
  badf="$(printf '%s\n' "$fails" | grep -v '^$' | grep -v '^chg_' || true)"
  badp="$(printf '%s\n' "$passes" | grep '^chg_' || true)"
  if [ -z "$badf" ] && [ -z "$badp" ] && [ "$nf" -gt 0 ]; then
    echo "red: $nf chg_* failed, $np same_* passed"; return
  fi
  echo "mixed: same_* failed=[$(echo $badf)] chg_* passed=[$(echo $badp)]"
}

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"

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
BASE_NOW="$(q base "select md5(prosrc) from pg_proc where oid = 'public.$FN'::regprocedure")"
if [ "$BASE_NOW" != "$BASE_MD5" ]; then
  echo "the base body of $FN differs from production: $BASE_NOW (want $BASE_MD5)"; exit 1
fi

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
  fingerprint base > "$WORK/fp_after.txt"
fi

newdb -T base checks

echo "== checks: task_pricing_guard_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  echo "PASS: $(grep -c '^PASS\[' "$RES" || true)  FAIL: $(grep -c '^FAIL\[' "$RES" || true)"
  S="$(shape "$OUT")"
  case "$S" in
    red:*) echo ""; echo "RED CONFIRMED: $S (without the migration)"; exit 0 ;;
    *)     echo "RED MISMATCH: $S"; exit 1 ;;
  esac
fi

echo "== scope: only the body of $FN changes =="
CHANGED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^[<>] //p' || true)"
OUTSIDE="$(printf '%s\n' "$CHANGED" | grep -v '^$' | grep -vF "fn $FN " || true)"
NCH="$(printf '%s\n' "$CHANGED" | grep -cF "fn $FN " || true)"
if [ -z "$OUTSIDE" ] && [ "$NCH" -eq 2 ] \
   && diff <(grep -F "fn $FN " "$WORK/fp_before.txt" | sed -E 's/ md5=.*$//') \
           <(grep -F "fn $FN " "$WORK/fp_after.txt" | sed -E 's/ md5=.*$//') >/dev/null; then
  record "PASS[scope_only_guard_body_changed]: body md5 $(grep -F "fn $FN " "$WORK/fp_before.txt" | sed -E 's/.* md5=//') -> $(grep -F "fn $FN " "$WORK/fp_after.txt" | sed -E 's/.* md5=//'); definer / search_path / acl unchanged"
else
  record "FAIL[scope_only_guard_body_changed]: $NCH lines; other changes: $(printf '%s' "$OUTSIDE" | head -5 | tr '\n' ';')"
fi

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback section =="
RBDIR="$WORK/rb"; mkdir -p "$RBDIR"
awk -v dir="$RBDIR" '
  /^-- ロールバック（節 / { s = $0; sub(/^-- ロールバック（節 /, "", s); sub(/[^0-9].*$/, "", s); f = sprintf("%s/%02d.sql", dir, s + 0); next }
  /^-- ====/ { f = ""; next }
  f != "" && /^--   / { line = $0; sub(/^--   /, "", line); print line > f }
' "$TARGET"
RB="$WORK/rollback.sql"; : > "$RB"
NBLK=0
for f in $(ls "$RBDIR"/*.sql 2>/dev/null | sort -r); do
  cat "$f" >> "$RB"; printf '\n' >> "$RB"; NBLK=$((NBLK + 1))
done
if [ "$NBLK" -eq 1 ]; then record "PASS[rollback_sections_found]: $NBLK section"; else record "FAIL[rollback_sections_found]: $NBLK sections (want 1)"; fi

# (1) データが入った状態で戻す → 土台の本文（適用前のスキーマ）と同じ → 再適用すると適用後のスキーマと同じ
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects; body md5 $BASE_MD5)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  if apply checks "$TARGET"; then
    record "PASS[reapply_after_rollback]: ok"
    fingerprint checks > "$WORK/fp_after_reapply.txt"
    if diff -u "$WORK/fp_after.txt" "$WORK/fp_after_reapply.txt" > "$WORK/fp2.diff"; then
      record "PASS[reapply_after_rollback_schema]: identical to post-migration"
    else
      record "FAIL[reapply_after_rollback_schema]: schema differs from post-migration"
      head -40 "$WORK/fp2.diff"
    fi
  else
    record "FAIL[reapply_after_rollback]: apply failed"
  fi
else
  record "FAIL[rollback_applies]: rollback section failed"
  head -20 "$WORK/rollback.out"
fi

# (2) 挙動も戻る: 戻した複製で assert を流すと RED と同じ形 → 再適用した複製では全 PASS
newdb -T base rb
if PGOPTIONS='--client-min-messages=warning' psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback_rb.out" 2>&1; then
  newdb -T rb rb_checks
  run_assert rb_checks "$WORK/rb_checks.out"
  S="$(shape "$WORK/rb_checks.out")"
  case "$S" in
    red:*) record "PASS[rollback_restores_behaviour]: $S" ;;
    *)     record "FAIL[rollback_restores_behaviour]: $S" ;;
  esac
  apply rb "$TARGET"
  newdb -T rb rb2_checks
  run_assert rb2_checks "$WORK/rb2_checks.out"
  S="$(shape "$WORK/rb2_checks.out")"
  case "$S" in
    all_pass:*) record "PASS[reapply_after_rollback_behaviour]: $S" ;;
    *)          record "FAIL[reapply_after_rollback_behaviour]: $S" ;;
  esac
else
  record "FAIL[rollback_restores_behaviour]: rollback section failed on a fresh copy"
  head -20 "$WORK/rollback_rb.out"
fi

echo "== guards: the migration stops (and changes nothing) =="
guard(){
  local name="$1" setup="$2" s0 s1
  newdb -T pre "$name"
  psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 >/dev/null <<<"$setup"
  s0="$(fnstate "$name")"
  if PGOPTIONS='--client-min-messages=warning' psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/$name.out" 2>&1; then
    record "FAIL[$name]: applied although $FN differed from its base"
  else
    s1="$(fnstate "$name")"
    if [ "$s0" = "$s1" ] && grep -qF "土台にした定義と違います" "$WORK/$name.out" && grep -qF "$FN" "$WORK/$name.out"; then
      record "PASS[$name]: stopped, $FN unchanged"
    else
      record "FAIL[$name]: stopped but $FN changed or the message differs"; cat "$WORK/$name.out"
    fi
  fi
}
# (1) 本番だけの手直し（本文が土台と違う）を上書きしない
guard guard_base_drift_blocks \
  "do \$\$ begin
     execute replace(pg_get_functiondef('public.$FN'::regprocedure), 'limit 1;', 'limit 1; -- local fix');
   end \$\$;"
# (2) search_path が public でない（20260911194852 の前など）ときも止まる
guard guard_search_path_not_public_blocks \
  "alter function public.$FN reset search_path;"

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "TASK PRICING GUARD CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL TASK PRICING GUARD CHECKS PASSED (on real migrations)"
