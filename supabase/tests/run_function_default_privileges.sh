#!/usr/bin/env bash
# =============================================================================
# 関数の既定の実行権（*_function_default_privileges.sql = A）と rpc_check_org_limits の実行権
# （*_rpc_check_org_limits_service_role_only.sql = A2）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（A の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/rpc_definer_authz_setup.sql        auth.uid()（request.jwt.claims）・service_role の bypassrls・表の既定の権限
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権（postgres / anon / authenticated / service_role）
# そのうえで A → A2 を2回ずつ適用し（冪等）、複製で検証する:
#   checks      function_default_privileges_assert.sql（新しく作る関数の実行権・rpc_check_org_limits の呼び出し・
#               招待の作成と受諾の人数の上限・二要素認証）
# 続けて GREEN のときだけ:
#   scope_*     A で変わるのは関数の既定（pg_default_acl）だけで、既にある関数の実行権は1本も変わらない。
#               A2 で変わるのは rpc_check_org_limits の実行権だけ（本文・SECURITY DEFINER・search_path は変わらない）
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を後ろの migration から流すと、適用前のスキーマと挙動に戻る → 戻したあと再適用できる
#   guard_*     A2 の確認が効く: 別の付与者から付いた実行権が残ると適用が止まり、何も変わらない
#
# assert の label:
#   chg_*   A・A2 で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_function_default_privileges.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_function_default_privileges.sh    # A・A2 を適用せずに流し、
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
ASSERT="$TST/function_default_privileges_assert.sql"
RED="${RED:-0}"

target_of(){
  local found
  shopt -s nullglob
  found=("$MIG"/*_"$1".sql)
  shopt -u nullglob
  if [ "${#found[@]}" -ne 1 ]; then echo "target migration not found or ambiguous: $1 (${found[*]:-none})" >&2; exit 1; fi
  echo "${found[0]}"
}
TARGET_A="$(target_of function_default_privileges)"
TARGET_A2="$(target_of rpc_check_org_limits_service_role_only)"
if [[ "$(basename "$TARGET_A")" > "$(basename "$TARGET_A2")" ]]; then
  echo "A must come before A2: $(basename "$TARGET_A") / $(basename "$TARGET_A2")"; exit 1
fi

WORK="$(mktemp -d /tmp/dfp.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54454
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
apply_targets(){ apply "$1" "$TARGET_A"; apply "$1" "$TARGET_A2"; }
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引と、postgres の既定の権限）。
#   データは含まない。権限（aclitem の並び）は並べ替えてから比べる。関数の実行権は行の最後（acl=）。
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
         || ' owner=' || p.proowner::regrole::text
         || ' md5=' || md5(p.prosrc)
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '(null)')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || convalidated::text || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'defacl ' || d.defaclrole::regrole::text || ' ' || d.defaclnamespace::regnamespace::text || ' ' || d.defaclobjtype::text
         || ' ' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(d.defaclacl) ai), '')
    from pg_default_acl d
) s order by x;
SQL
}

# 指紋の関数の行から実行権（行の最後の acl=...）を除く
strip_acl(){ sed -E 's/ acl=.*$//'; }

run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "FUNCTION DEFAULT PRIVILEGES CHECKS FAILED"; then
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
apply base "$TST/harness/rpc_definer_authz_setup.sql"
apply base "$TST/harness/supabase_function_default_acl.sql"
# 代役が本番と同じ形か（スキーマ public の既定に 4 役割・全体の既定は無い = 組み込みの既定で PUBLIC に付く）
DEF="$(q base "select coalesce((select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
                                  from pg_default_acl d, aclexplode(d.defaclacl) a
                                 where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                                   and d.defaclobjtype = 'f'), '') || ' global=' ||
                       (select count(*) from pg_default_acl d
                         where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f')")"
if [ "$DEF" != "anon,authenticated,postgres,service_role global=0" ]; then
  echo "the stand-in default privileges differ from production: $DEF"; exit 1
fi

echo "== prior migrations (verbatim, same order as verify-migrations-from-scratch.sh, up to A) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  [ "$f" = "$TARGET_A" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

if [ "$RED" = "1" ]; then
  echo "== RED mode: A and A2 are NOT applied =="
else
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== A (verbatim, applied twice = idempotent): $(basename "$TARGET_A") =="
  apply base "$TARGET_A"
  apply base "$TARGET_A"
  fingerprint base > "$WORK/fp_after_a.txt"
  echo "== A2 (verbatim, applied twice = idempotent): $(basename "$TARGET_A2") =="
  apply base "$TARGET_A2"
  apply base "$TARGET_A2"
  fingerprint base > "$WORK/fp_after.txt"
fi

newdb -T base checks

echo "== checks: function_default_privileges_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  echo "PASS: $(grep -c '^PASS\[' "$RES" || true)  FAIL: $(grep -c '^FAIL\[' "$RES" || true)"
  S="$(shape "$OUT")"
  case "$S" in
    red:*) echo ""; echo "RED CONFIRMED: $S (without A and A2)"; exit 0 ;;
    *)     echo "RED MISMATCH: $S"; exit 1 ;;
  esac
fi

echo "== scope =="
# A: 変わるのは postgres の既定の権限（defacl の行）だけ
CH_A="$(diff "$WORK/fp_before.txt" "$WORK/fp_after_a.txt" | sed -nE 's/^[<>] //p' || true)"
OUT_A="$(printf '%s\n' "$CH_A" | grep -v '^$' | grep -v '^defacl ' || true)"
N_A="$(printf '%s\n' "$CH_A" | grep -c '^defacl ' || true)"
if [ -z "$OUT_A" ] && [ "$N_A" -gt 0 ]; then
  record "PASS[scope_a_only_default_acl_changed]: $N_A default-acl lines changed, nothing else"
else
  record "FAIL[scope_a_only_default_acl_changed]: $N_A default-acl lines; other changes: $(printf '%s' "$OUT_A" | head -5 | tr '\n' ';')"
fi
# A: 既にある public の関数の実行権（と本文・属性）は1本も変わらない
NF="$(grep -c '^fn ' "$WORK/fp_before.txt" || true)"
if diff <(grep '^fn ' "$WORK/fp_before.txt") <(grep '^fn ' "$WORK/fp_after_a.txt") > "$WORK/fn_a.diff"; then
  record "PASS[scope_a_existing_function_acls_unchanged]: $NF functions, proacl unchanged"
else
  record "FAIL[scope_a_existing_function_acls_unchanged]: $(grep -c '^[<>]' "$WORK/fn_a.diff" || true) lines differ"
  head -10 "$WORK/fn_a.diff"
fi
# A2: 変わるのは rpc_check_org_limits(uuid) の実行権だけ
CH_A2="$(diff "$WORK/fp_after_a.txt" "$WORK/fp_after.txt" | sed -nE 's/^[<>] //p' || true)"
OUT_A2="$(printf '%s\n' "$CH_A2" | grep -v '^$' | grep -v '^fn rpc_check_org_limits(uuid) ' || true)"
N_A2="$(printf '%s\n' "$CH_A2" | grep -c '^fn rpc_check_org_limits(uuid) ' || true)"
if [ -z "$OUT_A2" ] && [ "$N_A2" -eq 2 ] \
   && diff <(grep '^fn rpc_check_org_limits(uuid) ' "$WORK/fp_after_a.txt" | strip_acl) \
           <(grep '^fn rpc_check_org_limits(uuid) ' "$WORK/fp_after.txt" | strip_acl) >/dev/null; then
  record "PASS[scope_a2_only_target_acl_changed]: $(grep '^fn rpc_check_org_limits(uuid) ' "$WORK/fp_after.txt" | sed -E 's/.* acl=//')"
else
  record "FAIL[scope_a2_only_target_acl_changed]: other changes: $(printf '%s' "$OUT_A2" | head -5 | tr '\n' ';')"
fi

echo "== re-apply with data present =="
if apply_targets checks; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback sections (A2 first, then A) =="
RBDIR="$WORK/rb"; mkdir -p "$RBDIR"
# 「-- ロールバック（節 X」の見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として取り出す
#   ファイル名は <migration の順番>_<節>.sql（後ろの migration・後ろの節から流すため）
extract_rollback(){
  awk -v dir="$RBDIR" -v idx="$2" '
    /^-- ロールバック（節 / { s = $0; sub(/^-- ロールバック（節 /, "", s); sub(/[^0-9A-Z].*$/, "", s); f = dir "/" idx "_" s ".sql"; next }
    /^-- ====/ { f = ""; next }
    f != "" && /^--   / { line = $0; sub(/^--   /, "", line); print line > f }
  ' "$1"
}
extract_rollback "$TARGET_A" 1
extract_rollback "$TARGET_A2" 2
RB="$WORK/rollback.sql"; : > "$RB"
NBLK=0
for f in $(ls "$RBDIR"/*.sql 2>/dev/null | sort -r); do
  cat "$f" >> "$RB"; printf '\n' >> "$RB"; NBLK=$((NBLK + 1))
done
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NBLK" -eq 2 ] && [ "$NSTMT" -eq 3 ]; then
  record "PASS[rollback_sections_found]: $NBLK sections, $NSTMT statements"
else
  record "FAIL[rollback_sections_found]: $NBLK sections, $NSTMT statements (want 2 sections, 3 statements)"
fi

# (1) データが入った状態で戻す → 適用前のスキーマと同じ → 再適用すると適用後のスキーマと同じ
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  if apply_targets checks; then
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
  record "FAIL[rollback_applies]: rollback sections failed"
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
  apply_targets rb
  newdb -T rb rb2_checks
  run_assert rb2_checks "$WORK/rb2_checks.out"
  S="$(shape "$WORK/rb2_checks.out")"
  case "$S" in
    all_pass:*) record "PASS[reapply_after_rollback_behaviour]: $S" ;;
    *)          record "FAIL[reapply_after_rollback_behaviour]: $S" ;;
  esac
else
  record "FAIL[rollback_restores_behaviour]: rollback sections failed on a fresh copy"
  head -20 "$WORK/rollback_rb.out"
fi

echo "== guards: A2 stops (and changes nothing) when an execute grant from another grantor remains =="
newdb -T pre guard_a2_other_grantor
apply guard_a2_other_grantor "$TARGET_A"
psql "$(conn guard_a2_other_grantor)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'dfp_other_grantor') then create role dfp_other_grantor nologin; end if; end $$;
grant execute on function public.rpc_check_org_limits(uuid) to dfp_other_grantor with grant option;
set role dfp_other_grantor;
grant execute on function public.rpc_check_org_limits(uuid) to anon;
reset role;
SQL
ACL_Q="select coalesce(string_agg(a::text, ',' order by a::text), '') from pg_proc p, unnest(p.proacl) a where p.oid = 'public.rpc_check_org_limits(uuid)'::regprocedure"
S0="$(q guard_a2_other_grantor "$ACL_Q")"
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_a2_other_grantor)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET_A2" > "$WORK/guard.out" 2>&1; then
  record "FAIL[guard_a2_leftover_grant_blocks]: applied although anon kept execute via another grantor"
else
  S1="$(q guard_a2_other_grantor "$ACL_Q")"
  if [ "$S0" = "$S1" ] && grep -q "service_role だけになっていません" "$WORK/guard.out"; then
    record "PASS[guard_a2_leftover_grant_blocks]: stopped, the execute privileges unchanged"
  else
    record "FAIL[guard_a2_leftover_grant_blocks]: stopped but the privileges changed or the message differs"; cat "$WORK/guard.out"
  fi
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "FUNCTION DEFAULT PRIVILEGES CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL FUNCTION DEFAULT PRIVILEGES CHECKS PASSED (on real migrations)"
