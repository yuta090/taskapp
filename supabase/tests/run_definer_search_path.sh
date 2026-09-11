#!/usr/bin/env bash
# =============================================================================
# SECURITY DEFINER の関数の search_path を固定する（*_definer_search_path.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/rpc_definer_authz_setup.sql    Supabase が本番で持っている権限（既定の権限・auth.uid()・service_role の bypassrls）
#   harness/definer_search_path_setup.sql  pgcrypto を本番と同じ extensions スキーマに置く・postgres の search_path に extensions
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      definer_search_path_assert.sql（17 本の search_path・セッションの search_path を変えての呼び出し・
#               トリガーの見張り・二要素認証）
# 続けて GREEN のときだけ:
#   scope_*     本 migration で変わるのは 17 本の search_path だけ。本文の md5・SECURITY DEFINER・持ち主・実行権は変わらない
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を後ろの節から流すと、適用前のスキーマと挙動に戻る → 戻したあと再適用できる
#   guard_*     節 0 の確認が効く: 関数が無い／引数が違う／SECURITY DEFINER でない／本文が違う／search_path が想定外、
#               のどれでも適用が止まり、17 本は何も変わらない（本 migration の前の複製で）
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
#
# 関数を足すとき: migration の節 0 の一覧・節 A か節 B・ロールバック節に行を足し、下の TARGET_FNS と
#   assert の test.targets に足す。
#
# 使い方:
#   bash supabase/tests/run_definer_search_path.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_definer_search_path.sh    # 本 migration を適用せずに流し、
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
ASSERT="$TST/definer_search_path_assert.sql"
RED="${RED:-0}"

# 本 migration が search_path を固定する関数（関数を足したらここにも足す）
TARGET_FNS=(
  rpc_create_invite rpc_get_space_members rpc_should_show_owner_field rpc_validate_invite rpc_get_org_members
  rpc_is_superadmin guard_portal_visible_sections guard_agency_settings guard_task_pricing_write
  guard_task_pricing_delete encrypt_slack_token decrypt_slack_token encrypt_system_secret decrypt_system_secret
  rpc_validate_api_key mcp_dry_run_delete mcp_confirm_delete
)
FN_ARRAY="{$(IFS=,; echo "${TARGET_FNS[*]}")}"
FN_RE="$(IFS='|'; echo "${TARGET_FNS[*]}")"

shopt -s nullglob
targets=("$MIG"/*_definer_search_path.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"

WORK="$(mktemp -d /tmp/dsp.XXXXXX)"
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
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す。
# 「drop ... if exists」の NOTICE は出さない（WARNING 以上とエラーは出す）
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない。
#   権限（aclitem の並び）は付けた順で並びが変わるので、並べ替えてから比べる。
#   関数は SECURITY DEFINER・持ち主・実行権・本文の md5・search_path（config は空白を含むので行の最後）を見る。
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
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || ' md5=' || md5(p.prosrc)
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
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

# 対象の関数の今の形（SECURITY DEFINER・持ち主・実行権・本文の md5・search_path）。guard_* で「何も変わっていない」ことを見る
fnstate(){
  q "$1" "select string_agg(p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
                            || ' owner=' || p.proowner::regrole::text
                            || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
                            || ' md5=' || md5(p.prosrc)
                            || ' config=' || coalesce(array_to_string(p.proconfig, ';'), ''),
                            ' | ' order by p.oid::regprocedure::text)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = any('$FN_ARRAY'::text[])"
}

# 指紋の関数の行から search_path（行の最後の config=...）を除く（本文・属性・実行権だけを比べるため）
strip_config(){ sed -E 's/ config=.*$//'; }

# assert を流して出力を $2 に書く。集計の例外以外の ERROR はハーネスかテストデータの不備なので止める
run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "DEFINER SEARCH PATH CHECKS FAILED"; then
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

echo "== bootstrap + Supabase の権限と拡張の置き場所の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/rpc_definer_authz_setup.sql"
apply base "$TST/harness/definer_search_path_setup.sql"
EXT="$(q base "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'")"
if [ "$EXT" != "extensions" ]; then
  echo "pgcrypto is in '$EXT' (want extensions: public では関数の search_path を確かめられない)"; exit 1
fi

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

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  # 本 migration の前の状態を残しておく（guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
  fingerprint base > "$WORK/fp_after.txt"
fi

newdb -T base checks

echo "== checks: definer_search_path_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
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

echo "== scope: only the search_path of the 17 target functions changes =="
CHANGED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^[<>] //p' || true)"
OUTSIDE="$(printf '%s\n' "$CHANGED" | grep -v '^$' | grep -vE "^fn ($FN_RE)\(" || true)"
NFN="$(printf '%s\n' "$CHANGED" | sed -nE "s/^fn (($FN_RE)\([^)]*\)).*/\1/p" | sort -u | grep -c . || true)"
if [ -z "$OUTSIDE" ] && [ "$NFN" -eq "${#TARGET_FNS[@]}" ]; then
  record "PASS[scope_only_target_functions_changed]: $NFN of ${#TARGET_FNS[@]} target functions changed, nothing else"
else
  record "FAIL[scope_only_target_functions_changed]: $NFN of ${#TARGET_FNS[@]} target functions changed; other changes: $(printf '%s' "$OUTSIDE" | head -5 | tr '\n' ';')"
fi
NKEPT="$(grep -cE "^fn ($FN_RE)\(" "$WORK/fp_after.txt" || true)"
if diff <(grep -E "^fn ($FN_RE)\(" "$WORK/fp_before.txt" | strip_config) \
        <(grep -E "^fn ($FN_RE)\(" "$WORK/fp_after.txt" | strip_config) > "$WORK/kept.diff" \
   && [ "$NKEPT" -eq "${#TARGET_FNS[@]}" ]; then
  record "PASS[scope_body_definer_owner_acl_unchanged]: $NKEPT functions, body md5 / definer / owner / acl unchanged"
else
  record "FAIL[scope_body_definer_owner_acl_unchanged]: $NKEPT of ${#TARGET_FNS[@]} functions found, or body / attributes / acl changed"
  head -20 "$WORK/kept.diff"
fi

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback sections (last section first) =="
RBDIR="$WORK/rb"; mkdir -p "$RBDIR"
# 「-- ロールバック（節 X」の見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として節ごとに取り出す
awk -v dir="$RBDIR" '
  /^-- ロールバック（節 / { s = $0; sub(/^-- ロールバック（節 /, "", s); sub(/[^0-9A-Z].*$/, "", s); f = dir "/" s ".sql"; next }
  /^-- ====/ { f = ""; next }
  f != "" && /^--   / { line = $0; sub(/^--   /, "", line); print line > f }
' "$TARGET"
RB="$WORK/rollback.sql"; : > "$RB"
NBLK=0
for f in $(ls "$RBDIR"/*.sql 2>/dev/null | sort -r); do
  cat "$f" >> "$RB"; printf '\n' >> "$RB"; NBLK=$((NBLK + 1))
done
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
# ロールバックの SQL がある節は A と B（節 0・節 C は確かめるだけ）。文は 17 本ぶん
if [ "$NBLK" -eq 2 ] && [ "$NSTMT" -eq "${#TARGET_FNS[@]}" ]; then
  record "PASS[rollback_sections_found]: $NBLK sections, $NSTMT statements"
else
  record "FAIL[rollback_sections_found]: $NBLK sections, $NSTMT statements (want 2 sections, ${#TARGET_FNS[@]} statements)"
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
  record "FAIL[rollback_applies]: rollback sections failed"
  head -20 "$WORK/rollback.out"
fi

# (2) 挙動も戻る: 戻した複製で assert を流すと RED と同じ形（chg_* が全て FAIL・same_* が全て PASS）→
#     再適用した複製では全 PASS
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
  record "FAIL[rollback_restores_behaviour]: rollback sections failed on a fresh copy"
  head -20 "$WORK/rollback_rb.out"
fi

echo "== guards: the migration stops at section 0 (and changes nothing) =="
# 本 migration の前の複製に手を加え、適用が止まること・止まった関数の名前が出ること・17 本が何も変わらないことを見る
guard(){
  local name="$1" want_fn="$2" setup="$3" s0 s1
  newdb -T pre "$name"
  psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 >/dev/null <<<"$setup"
  s0="$(fnstate "$name")"
  if PGOPTIONS='--client-min-messages=warning' psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/$name.out" 2>&1; then
    record "FAIL[$name]: applied although $want_fn differed from the list"
  else
    s1="$(fnstate "$name")"
    if [ "$s0" = "$s1" ] && grep -qF "一覧の形と違います" "$WORK/$name.out" && grep -qF "$want_fn" "$WORK/$name.out"; then
      record "PASS[$name]: stopped at $want_fn, the target functions unchanged"
    else
      record "FAIL[$name]: stopped but the target functions changed or the message differs"; cat "$WORK/$name.out"
    fi
  fi
}
guard guard_missing_function_blocks 'rpc_validate_invite(text)' \
  "alter function public.rpc_validate_invite(text) rename to rpc_validate_invite_renamed;"
guard guard_other_arguments_blocks 'rpc_validate_invite(text)' \
  "alter function public.rpc_validate_invite(text) rename to rpc_validate_invite_renamed;
   create function public.rpc_validate_invite(p_token uuid) returns jsonb language sql security definer as \$\$ select '{}'::jsonb \$\$;"
guard guard_not_definer_blocks 'rpc_is_superadmin()' \
  "alter function public.rpc_is_superadmin() security invoker;"
guard guard_body_drift_blocks 'guard_agency_settings()' \
  "do \$\$ begin
     execute replace(pg_get_functiondef('public.guard_agency_settings()'::regprocedure),
                     '-- Allow service_role (server-side operations)', '-- Allow service_role (server-side operations; local fix)');
   end \$\$;"
guard guard_unexpected_search_path_blocks 'rpc_get_org_members(uuid)' \
  "alter function public.rpc_get_org_members(uuid) set search_path = public, auth;"

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "DEFINER SEARCH PATH CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL DEFINER SEARCH PATH CHECKS PASSED (on real migrations)"
