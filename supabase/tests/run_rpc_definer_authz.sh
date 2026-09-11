#!/usr/bin/env bash
# =============================================================================
# 関数の実行権と呼んだ人の確認（*_rpc_definer_authz.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/rpc_definer_authz_setup.sql（Supabase が本番で持っている権限の代役:
# 既定の権限・auth.uid()・service_role の bypassrls）を足す。migration は1行も変えない。
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      rpc_definer_authz_assert.sql（関数ごとの実行権・人物ごとの呼び出し・DEFINER 関数からの呼び出し・
#               節 B の本文・二要素認証）
# 続けて GREEN のときだけ:
#   scope_*     本 migration で変わるのは対象の関数（下の TARGET_FNS）だけ。節 A・節 C の関数は実行権だけが変わり、
#               本文・SECURITY DEFINER・search_path は変わらない
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  各節の末尾のロールバック節を後ろの節から流すと、適用前のスキーマ（表・列・列の権限・ポリシー・
#               関数の本文と実行権・トリガー・制約・表の権限・索引）と挙動に戻る → 戻したあと再適用できる
#   guard_*     本 migration の確認が効く: 節 B の関数の今の定義が土台と違う／別の付与者から付いた実行権が残る、
#               のどちらでも適用が止まり、何も変わらない（本 migration の前の複製で）
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
#
# 関数を足すとき: migration の節 A・節 C に行を足すか、節 B と同じ形の節を足し、下の TARGET_FNS
#   （本文を作り直す関数は REDEFINED_FNS にも）と assert の「実行権の表」に足す。
#
# 使い方:
#   bash supabase/tests/run_rpc_definer_authz.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_rpc_definer_authz.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
ASSERT="$TST/rpc_definer_authz_assert.sql"
RED="${RED:-0}"

# 本 migration が変える関数（関数を足したらここにも足す）
TARGET_FNS=(
  mcp_dry_run_delete mcp_confirm_delete _create_task_notification mcp_authorize mcp_log_usage
  rpc_validate_api_key mfa_enforcement_status decrypt_slack_token encrypt_slack_token
  decrypt_system_secret encrypt_system_secret process_scheduling_expirations process_scheduling_reminders
  rpc_create_space_with_preset
  rpc_should_show_owner_field
)
# このうち本文を作り直す関数（節 B と同じ形）。残りは実行権だけを変える（節 A・節 C）
REDEFINED_FNS=(rpc_create_space_with_preset)
ACL_ONLY_FNS=()
for fn in "${TARGET_FNS[@]}"; do
  case " ${REDEFINED_FNS[*]} " in *" $fn "*) ;; *) ACL_ONLY_FNS+=("$fn") ;; esac
done
FN_ARRAY="{$(IFS=,; echo "${TARGET_FNS[*]}")}"
FN_RE="$(IFS='|'; echo "${TARGET_FNS[*]}")"
ACL_ONLY_RE="$(IFS='|'; echo "${ACL_ONLY_FNS[*]}")"

shopt -s nullglob
targets=("$MIG"/*_rpc_definer_authz.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"

WORK="$(mktemp -d /tmp/rda.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54452
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
#   権限（aclitem の並び）は付けた順で並びが変わるので、並べ替えてから比べる。関数は SECURITY DEFINER・search_path・本体の md5 も見る。
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
         || ' ' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

# 対象の関数の本文の md5 と実行権（並べ替えたもの）。guard_* で「何も変わっていない」ことを見る
fnstate(){
  q "$1" "select string_agg(p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' '
                            || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), ''),
                            ' | ' order by p.oid::regprocedure::text)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = any('$FN_ARRAY'::text[])"
}

# 指紋の関数の行から実行権（acl=...）を除く（本文・属性だけを比べるため）
strip_acl(){ sed -E 's/ acl=[^ ]* / /'; }

# assert を流して出力を $2 に書く。集計の例外以外の ERROR はハーネスかテストデータの不備なので止める
run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "RPC DEFINER AUTHZ CHECKS FAILED"; then
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

echo "== checks: rpc_definer_authz_assert.sql =="
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

echo "== scope: only the target functions change; sections A / C change privileges only =="
CHANGED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^[<>] //p' || true)"
OUTSIDE="$(printf '%s\n' "$CHANGED" | grep -v '^$' | grep -vE "^fn ($FN_RE)\(" || true)"
NFN="$(printf '%s\n' "$CHANGED" | sed -nE "s/^fn (($FN_RE)\([^)]*\)).*/\1/p" | sort -u | grep -c . || true)"
if [ -z "$OUTSIDE" ] && [ "$NFN" -gt 0 ]; then
  record "PASS[scope_only_target_functions_changed]: $NFN of ${#TARGET_FNS[@]} target functions changed, nothing else"
else
  record "FAIL[scope_only_target_functions_changed]: $NFN target functions changed; other changes: $(printf '%s' "$OUTSIDE" | head -5 | tr '\n' ';')"
fi
NACL="$(grep -cE "^fn ($ACL_ONLY_RE)\(" "$WORK/fp_after.txt" || true)"
if diff <(grep -E "^fn ($ACL_ONLY_RE)\(" "$WORK/fp_before.txt" | strip_acl) \
        <(grep -E "^fn ($ACL_ONLY_RE)\(" "$WORK/fp_after.txt" | strip_acl) > "$WORK/body.diff" \
   && [ "$NACL" -eq "${#ACL_ONLY_FNS[@]}" ]; then
  record "PASS[scope_acl_only_functions_keep_body]: $NACL functions, body / definer / search_path unchanged"
else
  record "FAIL[scope_acl_only_functions_keep_body]: $NACL of ${#ACL_ONLY_FNS[@]} functions found, or body / attributes changed"
  head -20 "$WORK/body.diff"
fi

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback sections (last section first) =="
RBDIR="$WORK/rb"; mkdir -p "$RBDIR"
# 「-- ロールバック（節 X」の見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として節ごとに取り出す
awk -v dir="$RBDIR" '
  /^-- ロールバック（節 / { s = $0; sub(/^-- ロールバック（節 /, "", s); sub(/[^A-Z].*$/, "", s); f = dir "/" s ".sql"; next }
  /^-- ====/ { f = ""; next }
  f != "" && /^--   / { line = $0; sub(/^--   /, "", line); print line > f }
' "$TARGET"
RB="$WORK/rollback.sql"; : > "$RB"
NBLK=0
for f in $(ls "$RBDIR"/*.sql 2>/dev/null | sort -r); do
  cat "$f" >> "$RB"; printf '\n' >> "$RB"; NBLK=$((NBLK + 1))
done
NSEC="$(grep -cE '^-- 節 [A-Z]:' "$TARGET" || true)"
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NBLK" -gt 0 ] && [ "$NBLK" -eq "$NSEC" ]; then
  record "PASS[rollback_sections_found]: $NBLK sections, $NSTMT statements"
else
  record "FAIL[rollback_sections_found]: $NBLK rollback sections for $NSEC sections"
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

echo "== guards: the migration stops (and changes nothing) =="
# (1) 節 B の関数の今の定義が土台と違えば止まる（本番だけの手直しを上書きしない）
newdb -T pre guard_drift
psql "$(conn guard_drift)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v text;
begin
  v := pg_get_functiondef('public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)'::regprocedure);
  v := replace(v, '-- 3. Create space', '-- 3. Create space (local fix)');
  execute v;
end $$;
SQL
S0="$(fnstate guard_drift)"
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_drift)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_drift.out" 2>&1; then
  record "FAIL[guard_base_drift_blocks]: applied although rpc_create_space_with_preset differed from its base"
else
  S1="$(fnstate guard_drift)"
  if [ "$S0" = "$S1" ] && grep -q "rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)" "$WORK/guard_drift.out"; then
    record "PASS[guard_base_drift_blocks]: stopped, bodies and privileges of the target functions unchanged (local fix kept)"
  else
    record "FAIL[guard_base_drift_blocks]: stopped but the target functions changed or the message differs"; cat "$WORK/guard_drift.out"
  fi
fi

# (2) 別の付与者から付いた実行権が残って service_role だけにできないときも止まる
newdb -T pre guard_grant
psql "$(conn guard_grant)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'rda_other_grantor') then create role rda_other_grantor nologin; end if; end $$;
grant execute on function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) to rda_other_grantor with grant option;
set role rda_other_grantor;
grant execute on function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) to anon;
reset role;
SQL
S0="$(fnstate guard_grant)"
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_grant)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_grant.out" 2>&1; then
  record "FAIL[guard_leftover_grant_blocks]: applied although anon kept execute on mcp_dry_run_delete"
else
  S1="$(fnstate guard_grant)"
  if [ "$S0" = "$S1" ] && grep -q "service_role だけになっていません" "$WORK/guard_grant.out"; then
    record "PASS[guard_leftover_grant_blocks]: stopped, bodies and privileges of the target functions unchanged"
  else
    record "FAIL[guard_leftover_grant_blocks]: stopped but the target functions changed or the message differs"; cat "$WORK/guard_grant.out"
  fi
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "RPC DEFINER AUTHZ CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL RPC DEFINER AUTHZ CHECKS PASSED (on real migrations)"
