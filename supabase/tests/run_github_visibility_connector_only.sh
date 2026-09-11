#!/usr/bin/env bash
# =============================================================================
# GitHub 連携の見える範囲（接続した本人だけ）検証ハーネス
#
# 使い捨てクラスタで baseline スタブ → 実 migration を verbatim 適用 → 検証 → 破棄。
#   20240205_000 / 20240205_001            GitHub 連携の元定義（表・旧ポリシー・組織一致トリガー）
#   20260703_001 / 002 / 003 / 010         RLS ヘルパ・tasks・membership の本番 RLS
#   20260907142526                         二要素認証の RESTRICTIVE ポリシー（その時点の RLS 表に付く）
#   20260910212804 / 20260910233637 / 20260911002110
#                                          GitHub 表の社内限定 RLS・許可範囲の列・Issue 連携
#   *_github_visibility_connector_only.sql 本 migration（2回適用して冪等も確認）
# の順に流し、github_visibility_connector_only_assert.sql で視点別の読み書きを検証する。
# 続けて GREEN のときだけ:
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  migration 末尾のロールバック節で、適用前のスキーマ（表・列・ポリシー・関数・トリガー・制約・
#               権限・索引）と見え方に戻る → 戻したあと再適用できる
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_github_visibility_connector_only.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_github_visibility_connector_only.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/ghvis.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54445
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・ポリシー・関数・トリガー・制約・権限・索引）。データは含まない
fingerprint(){
  psql "$CONN" -qtA -v ON_ERROR_STOP=1 <<'SQL'
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

# 指定した利用者（authenticated）から見える行数
count_as(){
  psql "$CONN" -qtA -v ON_ERROR_STOP=1 <<SQL | tail -1
set role authenticated;
set test.uid = '$1';
select count(*) from public.$2;
SQL
}

echo "== baseline + stubs =="
apply "$TST/harness/baseline_stubs.sql"
apply "$TST/harness/rls_github_setup.sql"
apply "$TST/harness/github_issues_link_setup.sql"
apply "$TST/harness/github_visibility_setup.sql"

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
  20260911002110_github_issues_link.sql; do
  apply "$MIG/$m"
done

TARGET=""
if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  shopt -s nullglob
  targets=("$MIG"/*_github_visibility_connector_only.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  TARGET="${targets[0]}"
  fingerprint > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply "$TARGET"
  apply "$TARGET"
fi

echo "== checks =="
OUT="$WORK/o.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 \
  -f "$TST/github_visibility_connector_only_assert.sql" > "$OUT" 2>&1
set -e
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# 書き込み assert が権限拒否以外の SQL エラー（一意制約違反など）で終わった = テストデータ／ハーネスの不備
if grep -q "got error:" "$OUT"; then
  echo "HARNESS ERROR: an assert hit an unexpected SQL error (fix the test data):"
  grep -oE "FAIL\[[a-z0-9_]+\]: got error:.*" "$OUT"; exit 1
fi
# 集計の例外以外の ERROR はハーネス自体の不備（どちらのモードでも失敗扱い）
if grep "ERROR" "$OUT" | grep -qv "GITHUB VISIBILITY CHECKS FAILED"; then
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
    echo "RED MISMATCH: same_* failed on the pre-fix policies (expectations differ from current behaviour):"
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

echo "== re-apply with data present =="
if apply "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback section =="
RB="$WORK/rollback.sql"
# 「-- ロールバック」見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として取り出す
awk '/^-- ロールバック/{f=1; next} f && /^-- ====/{exit} f && /^--   /{sub(/^--   /, ""); print}' "$TARGET" > "$RB"
echo "-- rollback statements:"; sed 's/^/     /' "$RB"
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NSTMT" -gt 0 ]; then record "PASS[rollback_section_found]: $NSTMT statements"; else record "FAIL[rollback_section_found]: no statements"; fi
if psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$RB" >/dev/null; then
  record "PASS[rollback_applies]: ok"
  fingerprint > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  # 見え方も元に戻る（社内 member は組織の全リポジトリが見える＝適用前の状態）
  N="$(count_as "$U_MEM" github_repositories)"
  if [ "$N" = "4" ]; then record "PASS[rollback_restores_visibility]: member sees $N repositories"; else record "FAIL[rollback_restores_visibility]: member sees ${N:-<none>} repositories, want 4"; fi
  if apply "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  N="$(count_as "$U_MEM" github_repositories)"
  if [ "$N" = "0" ]; then record "PASS[reapply_after_rollback_visibility]: member sees $N repositories"; else record "FAIL[reapply_after_rollback_visibility]: member sees ${N:-<none>} repositories, want 0"; fi
else
  record "FAIL[rollback_applies]: rollback section failed"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "GITHUB VISIBILITY CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL GITHUB VISIBILITY CONNECTOR ONLY CHECKS PASSED (on real migrations)"
