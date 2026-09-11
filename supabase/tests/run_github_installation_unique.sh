#!/usr/bin/env bash
# =============================================================================
# GitHub のインストールを1つの組織にだけ紐づける（installation_id を一意にする）検証ハーネス
#
# 使い捨てクラスタで baseline スタブ → GitHub 連携の実 migration を verbatim 適用 →
# 本 migration（*_github_installation_unique.sql・2回適用して冪等も確認）→ 検証 → 破棄。
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
# 続けて GREEN のときだけ:
#   guard_*     重複が既にあると、分かる文言で止まり、何も変わらない（本 migration の前の複製で）
#   rollback_*  migration 末尾のロールバック節で索引が消え、適用前の索引の並びに戻る → 再適用できる
#
# 使い方:
#   bash supabase/tests/run_github_installation_unique.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_github_installation_unique.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS することを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/ghinst.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54447
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }
newdb base

apply(){ echo "-- apply [$1] $(basename "$2")"; PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# github_installations の索引の並び（ロールバックで元に戻ったかを見る）
index_list(){ q "$1" "select string_agg(indexdef, E'\n' order by indexdef) from pg_indexes where schemaname = 'public' and tablename = 'github_installations'"; }

echo "== baseline + stubs =="
for s in baseline_stubs.sql rls_github_setup.sql github_issues_link_setup.sql github_visibility_setup.sql; do
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

ORG_A='00000000-0000-0000-0000-00000000a001'
ORG_B='00000000-0000-0000-0000-00000000b001'
U='00000000-0000-0000-0000-0000000000e1'
psql "$(conn base)" -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.organizations(id) values ('$ORG_A'), ('$ORG_B');
insert into auth.users(id) values ('$U');
SQL
ins(){ echo "insert into public.github_installations(org_id, installation_id, account_login, created_by) values ('$1', $2, 'acct', '$U');"; }

TARGET=""
if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  shopt -s nullglob
  targets=("$MIG"/*_github_installation_unique.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  TARGET="${targets[0]}"
  newdb -T base pre
  index_list base > "$WORK/idx_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base checks

# 1つのトランザクションで SQL を流し、want=reject なら一意性違反で止まること、want=ok なら通ることを確かめる
run_case(){ # label db sql want
  local out
  out="$(psql "$(conn "$2")" -qtA -v ON_ERROR_STOP=1 -c "$3" 2>&1 || true)"
  if [ "$4" = "reject" ]; then
    if printf '%s' "$out" | grep -q "duplicate key value violates unique constraint"; then
      record "PASS[$1]: rejected"
    else
      record "FAIL[$1]: want rejected, got: ${out:-ok}"
    fi
  else
    if printf '%s' "$out" | grep -q "ERROR"; then record "FAIL[$1]: want ok, got: $out"; else record "PASS[$1]: ok"; fi
  fi
}

echo "== checks =="
# 別の組織が、既に紐づいている installation_id を登録しようとすると止まる（本 migration で変わる）
run_case chg_other_org_same_installation_rejected checks "$(ins "$ORG_A" 7001) $(ins "$ORG_B" 7001)" reject
# 同じ組織に同じ installation_id を2回は、もともと止まる
run_case same_same_org_same_installation_rejected checks "$(ins "$ORG_A" 7002) $(ins "$ORG_A" 7002)" reject
# 組織ごとに別の installation_id なら、どちらも登録できる
run_case same_different_installations_ok checks "$(ins "$ORG_A" 7003) $(ins "$ORG_B" 7004)" ok
# 既に紐づいている行の更新（callback の再認可の経路）は通る
run_case same_existing_row_update_ok checks "$(ins "$ORG_A" 7005) update public.github_installations set account_login = 'acct2' where installation_id = 7005;" ok

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  NPASS="$(grep -c '^PASS\[' "$RES" || true)"
  NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  BAD_FAIL="$( (grep -oE '^FAIL\[[a-z0-9_]+\]' "$RES" || true) | grep -v '^FAIL\[chg_' || true)"
  BAD_PASS="$( (grep -oE '^PASS\[[a-z0-9_]+\]' "$RES" || true) | grep '^PASS\[chg_' || true)"
  if [ -n "$BAD_FAIL" ]; then echo "RED MISMATCH: same_* failed without the migration:"; printf '  %s\n' $BAD_FAIL; exit 1; fi
  if [ -n "$BAD_PASS" ]; then echo "RED MISMATCH: chg_* passed without the migration:"; printf '  %s\n' $BAD_PASS; exit 1; fi
  if [ "$NFAIL" -eq 0 ]; then echo "RED NOT REPRODUCED: no assert failed without the migration"; exit 1; fi
  echo ""
  echo "RED CONFIRMED: all $NFAIL chg_* assert(s) fail and all $NPASS same_* assert(s) pass without the migration"
  exit 0
fi

echo "== guard: duplicates already present -> the migration stops and changes nothing =="
newdb -T pre guard_dup
psql "$(conn guard_dup)" -q -v ON_ERROR_STOP=1 -c "$(ins "$ORG_A" 7101) $(ins "$ORG_B" 7101)" >/dev/null
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_dup)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_dup.out" 2>&1; then
  record "FAIL[guard_duplicates_block]: applied although duplicates existed"
else
  N="$(q guard_dup "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'github_installations_installation_id_key'")"
  if [ "$N" = "0" ] && grep -q "github installation unique" "$WORK/guard_dup.out"; then
    record "PASS[guard_duplicates_block]: stopped with the message, index not created"
  else
    record "FAIL[guard_duplicates_block]: stopped but index=$N"; cat "$WORK/guard_dup.out"
  fi
fi

echo "== rollback section =="
newdb -T base rb
RB="$WORK/rollback.sql"
awk '/^-- ロールバック/{f=1; next} f && /^-- ====/{exit} f && /^--   /{sub(/^--   /, ""); print}' "$TARGET" > "$RB"
echo "-- rollback statements:"; sed 's/^/     /' "$RB"
if [ -s "$RB" ] && psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" >/dev/null; then
  index_list rb > "$WORK/idx_after_rollback.txt"
  if diff -u "$WORK/idx_before.txt" "$WORK/idx_after_rollback.txt" > "$WORK/idx.diff"; then
    record "PASS[rollback_restores_indexes]: identical to pre-migration"
  else
    record "FAIL[rollback_restores_indexes]: differs"; cat "$WORK/idx.diff"
  fi
  if apply rb "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  run_case rollback_reapplied_rejects_other_org rb "$(ins "$ORG_A" 7201) $(ins "$ORG_B" 7201)" reject
else
  record "FAIL[rollback_applies]: rollback section missing or failed"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ]; then echo "NOT PASSED"; exit 1; fi
echo ""
echo "ALL GITHUB INSTALLATION UNIQUE CHECKS PASSED (on real migrations)"
