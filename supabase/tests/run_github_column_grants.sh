#!/usr/bin/env bash
# =============================================================================
# GitHub の PR・Issue の列の見える範囲（列ごとの権限）・接続状態 RPC・未使用列の削除 検証ハーネス
#
# 使い捨てクラスタで baseline スタブ → 実 migration を verbatim 適用 → 検証 → 破棄。
#   20240205_000 / 20240205_001            GitHub 連携の元定義（表・旧ポリシー・組織一致トリガー）
#   20260703_001 / 002 / 003 / 010         RLS ヘルパ・tasks・membership の本番 RLS
#   20260907142526                         二要素認証の RESTRICTIVE ポリシー
#   20260910212804 / 20260910233637 / 20260911002110 / 20260911080909
#                                          GitHub 表の社内限定 RLS・許可範囲の列・Issue 連携・接続した本人だけ（応急処置）
#   *_github_column_grants.sql             本 migration（2回適用して冪等も確認）
# の順に流したデータベースを土台にし、複製2つで検証する（assert は同じ ID のデータを入れるため分ける）:
#   stopgap  応急処置の assert（github_visibility_connector_only_assert.sql）が本 migration の後も全部通る
#   columns  本 migration の assert（github_column_grants_assert.sql）
# 続けて GREEN のときだけ:
#   reapply_*   データが入った状態で再適用できる（columns の複製で）
#   rollback_*  migration 末尾のロールバック節で、適用前のスキーマ（表・列・列ごとの権限・ポリシー・関数・
#               トリガー・制約・表の権限・索引）と見え方に戻る → 戻したあと再適用できる（columns の複製で）
#   guard_*     本 migration の確認が効く: 消す列に値が残っている／別の付与者の表の select が残っていて
#               列を絞れない、のどちらでも適用が止まり、何も変わらない（本 migration の前の複製で）
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）。応急処置の assert 一式は same_stopgap_asserts
#
# 使い方:
#   bash supabase/tests/run_github_column_grants.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_github_column_grants.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/ghcol.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54446
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }
newdb base

# 「drop ... if exists」の NOTICE は出さない（WARNING 以上とエラーは出す）
apply(){ echo "-- apply [$1] $(basename "$2")"; PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'rel ' || c.relname || ' ' || c.relkind || ' ' || coalesce(c.relacl::text, '') || ' rls=' || c.relrowsecurity::text as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'idx ' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'colacl ' || c.relname || '.' || a.attname || ' ' || a.attacl::text
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and a.attacl is not null and cardinality(a.attacl) > 0
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'fn ' || p.oid::regprocedure::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proacl::text, '')
         || ' ' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

# 指定した利用者（authenticated）で SQL を流し、最後の1行（結果、または ERROR の行）を返す
as_user(){
  { psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 2>&1 <<SQL || true
set role authenticated;
set test.uid = '$2';
$3
SQL
  } | tail -1
}

echo "== baseline + stubs =="
for s in baseline_stubs.sql rls_github_setup.sql github_issues_link_setup.sql github_visibility_setup.sql \
         github_column_grants_setup.sql; do
  apply base "$TST/harness/$s"
done

echo "== prior migrations (verbatim) =="
for m in \
  20240205_000_github_integration.sql \
  20240205_001_github_security_fixes.sql \
  20260703_001_rls_helpers.sql \
  20260703_002_rls_tasks.sql \
  20260703_003_rls_membership.sql \
  20260703_010_rls_vendor_task_scope.sql \
  20260907142526_mfa_rls_enforcement.sql \
  20260910212804_rls_github_internal_only.sql \
  20260910233637_github_installation_permissions.sql \
  20260911002110_github_issues_link.sql \
  20260911080909_github_visibility_connector_only.sql; do
  apply base "$MIG/$m"
done

TARGET=""
if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  shopt -s nullglob
  targets=("$MIG"/*_github_column_grants.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  TARGET="${targets[0]}"
  # 本 migration の前の状態を残しておく（guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base stopgap
newdb -T base columns

echo "== checks: stopgap asserts (github_visibility_connector_only_assert.sql, unchanged) =="
OUT_SG="$WORK/stopgap.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn stopgap)" -v ON_ERROR_STOP=1 \
  -f "$TST/github_visibility_connector_only_assert.sql" > "$OUT_SG" 2>&1
set -e
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
SG_PASS="$( (grep -oE 'PASS\[[a-z0-9_]+\]' "$OUT_SG" || true) | wc -l | tr -d ' ')"
SG_FAIL="$( (grep -oE 'FAIL\[[a-z0-9_]+\]' "$OUT_SG" || true) | wc -l | tr -d ' ')"
if [ "$SG_FAIL" = "0" ] && [ "$SG_PASS" -gt 0 ] && grep -q "GITHUB VISIBILITY CHECKS PASSED" "$OUT_SG"; then
  record "PASS[same_stopgap_asserts]: $SG_PASS passed, 0 failed"
else
  record "FAIL[same_stopgap_asserts]: $SG_PASS passed, $SG_FAIL failed"
  grep -oE 'FAIL\[[a-z0-9_]+\].*' "$OUT_SG" | sed 's/^/    /' || true
  grep -E 'ERROR' "$OUT_SG" | head -10 | sed 's/^/    /' || true
fi

echo "== checks: column grants / connection status / dropped columns =="
OUT="$WORK/columns.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn columns)" -v ON_ERROR_STOP=1 \
  -f "$TST/github_column_grants_assert.sql" > "$OUT" 2>&1
set -e
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# same_* が権限拒否以外の SQL エラーで終わった = テストデータ／ハーネスの不備
#   （chg_* は、適用前には RPC が無いのでエラーになりうる。適用後は FAIL として数える）
if grep -qE "FAIL\[same_[a-z0-9_]+\]: got error:" "$OUT"; then
  echo "HARNESS ERROR: a same_* assert hit an unexpected SQL error (fix the test data):"
  grep -oE "FAIL\[same_[a-z0-9_]+\]: got error:.*" "$OUT"; exit 1
fi
# 集計の例外以外の ERROR はハーネス自体の不備（どちらのモードでも失敗扱い）
if grep "ERROR" "$OUT" | grep -qv "GITHUB COLUMN GRANTS CHECKS FAILED"; then
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
    echo "RED MISMATCH: same_* failed without the migration (expectations differ from current behaviour):"
    printf '  %s\n' $BAD_FAIL; exit 1
  fi
  if [ -n "$BAD_PASS" ]; then
    echo "RED MISMATCH: chg_* passed without the migration (the assert does not detect the change):"
    printf '  %s\n' $BAD_PASS; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: no assert failed without the migration"; exit 1
  fi
  echo ""
  echo "RED CONFIRMED: all $NFAIL chg_* assert(s) fail and all $NPASS same_* assert(s) pass without the migration"
  exit 0
fi

U_MEM='00000000-0000-0000-0000-0000000000c3'
# 画面の旧い読み方（PR の全列）で数える。適用前は 1 行、適用後は列の権限で拒否される
STAR_PR='select count(*) from (select * from public.github_pull_requests) s;'

echo "== re-apply with data present =="
if apply columns "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback section =="
RB="$WORK/rollback.sql"
# 「-- ロールバック」見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として取り出す
awk '/^-- ロールバック/{f=1; next} f && /^-- ====/{exit} f && /^--   /{sub(/^--   /, ""); print}' "$TARGET" > "$RB"
echo "-- rollback statements:"; sed 's/^/     /' "$RB"
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NSTMT" -gt 0 ]; then record "PASS[rollback_section_found]: $NSTMT statements"; else record "FAIL[rollback_section_found]: no statements"; fi
if psql "$(conn columns)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" >/dev/null; then
  record "PASS[rollback_applies]: ok"
  fingerprint columns > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  # 見え方も元に戻る（space のメンバーが PR を全列で読める＝適用前の状態）
  N="$(as_user columns "$U_MEM" "$STAR_PR")"
  if [ "$N" = "1" ]; then record "PASS[rollback_restores_visibility]: member reads all PR columns ($N row)"; else record "FAIL[rollback_restores_visibility]: got ${N:-<none>}, want 1"; fi
  if apply columns "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  N="$(as_user columns "$U_MEM" "$STAR_PR")"
  if printf '%s' "$N" | grep -q "permission denied"; then record "PASS[reapply_after_rollback_visibility]: $N"; else record "FAIL[reapply_after_rollback_visibility]: got ${N:-<none>}, want permission denied"; fi
else
  record "FAIL[rollback_applies]: rollback section failed"
fi

echo "== guards: the migration stops (and changes nothing) instead of losing values / leaving columns readable =="
# 止まったあとの状態: 消すはずの列が2つとも残り、authenticated の PR の表の select も残っている（=何も変わっていない）
unchanged_state(){ echo "cols=$(q "$1" "select count(*) from pg_attribute where attrelid = 'public.github_installations'::regclass and attname in ('access_token', 'token_expires_at') and not attisdropped"),pr_table_select=$(q "$1" "select has_table_privilege('authenticated', 'public.github_pull_requests', 'select')"),rpc=$(q "$1" "select count(*) from pg_proc where proname = 'github_connection_status'")"; }

# (1) 消す列に値が残っていたら止まる
newdb -T pre guard_token
psql "$(conn guard_token)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.organizations(id) values ('00000000-0000-0000-0000-0000000000f9');
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f8');
insert into public.github_installations(org_id, installation_id, account_login, created_by, token_expires_at)
  values ('00000000-0000-0000-0000-0000000000f9', 1, 'x', '00000000-0000-0000-0000-0000000000f8', now());
SQL
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_token)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_token.out" 2>&1; then
  record "FAIL[guard_token_values_block]: applied although token_expires_at had a value"
else
  S="$(unchanged_state guard_token)"
  if [ "$S" = "cols=2,pr_table_select=t,rpc=0" ] && grep -q "access_token / token_expires_at" "$WORK/guard_token.out"; then
    record "PASS[guard_token_values_block]: stopped, nothing changed ($S)"
  else
    record "FAIL[guard_token_values_block]: stopped but got $S"; cat "$WORK/guard_token.out"
  fi
fi

# (2) 別の付与者から付いた表の select が残っていて列を絞れないときも止まる
newdb -T pre guard_grant
psql "$(conn guard_grant)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'gh_other_grantor') then create role gh_other_grantor nologin; end if; end $$;
grant select on public.github_pull_requests to gh_other_grantor with grant option;
set role gh_other_grantor;
grant select on public.github_pull_requests to authenticated;
reset role;
SQL
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_grant)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_grant.out" 2>&1; then
  record "FAIL[guard_leftover_grant_block]: applied although authenticated could still read hidden columns"
else
  S="$(unchanged_state guard_grant)"
  if [ "$S" = "cols=2,pr_table_select=t,rpc=0" ] && grep -q "github column grants" "$WORK/guard_grant.out"; then
    record "PASS[guard_leftover_grant_block]: stopped, nothing changed ($S)"
  else
    record "FAIL[guard_leftover_grant_block]: stopped but got $S"; cat "$WORK/guard_grant.out"
  fi
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "GITHUB COLUMN GRANTS CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL GITHUB COLUMN GRANTS CHECKS PASSED (on real migrations)"
