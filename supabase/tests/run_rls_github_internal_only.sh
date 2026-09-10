#!/usr/bin/env bash
# =============================================================================
# GitHub 連携テーブル RLS（社内メンバー限定）検証ハーネス
#
# 使い捨てクラスタで baseline スタブ → 実 migration を verbatim 適用 → 検証 → 破棄。
#   20240205_000 / 20240205_001            GitHub 連携の元定義（表・旧ポリシー・組織一致トリガー）
#   20260703_001 / 002 / 003 / 010         RLS ヘルパ・tasks・membership の本番 RLS
#                                          （GitHub 側ポリシーが中で読む tasks / membership も本番同様に絞る）
#   *_rls_github_internal_only.sql         本修正（2回適用して冪等も確認）
# の順に流し、rls_github_internal_only_assert.sql で視点別の読み書きを検証する。
#
# 使い方:
#   bash supabase/tests/run_rls_github_internal_only.sh          # 修正後: 全 PASS を期待
#   RED=1 bash supabase/tests/run_rls_github_internal_only.sh    # 修正前: 本修正を適用せずに流し、
#       社外視点(ext_*)・形状(shape_*)の assert が FAIL し、社内視点(int_*)は PASS する
#       （= テストが問題を検出でき、社内の期待値は従来どおり）ことを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/rlsgh.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54437
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

echo "== baseline + stubs =="
apply "$TST/harness/baseline_stubs.sql"
apply "$TST/harness/rls_github_setup.sql"

echo "== prior migrations (verbatim) =="
apply "$MIG/20240205_000_github_integration.sql"
apply "$MIG/20240205_001_github_security_fixes.sql"
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260703_002_rls_tasks.sql"
apply "$MIG/20260703_003_rls_membership.sql"
apply "$MIG/20260703_010_rls_vendor_task_scope.sql"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied (pre-fix policies) =="
else
  shopt -s nullglob
  targets=("$MIG"/*_rls_github_internal_only.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply "${targets[0]}"
  apply "${targets[0]}"
fi

echo "== checks =="
OUT="$WORK/o.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 \
  -f "$TST/rls_github_internal_only_assert.sql" > "$OUT" 2>&1
set -e

grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" | sed 's/^/  /' || true
NPASS="$(grep -c 'PASS\[' "$OUT" || true)"
NFAIL="$(grep -c 'FAIL\[' "$OUT" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

# 集計の例外以外の ERROR はハーネス自体の不備（どちらのモードでも失敗扱い）
if grep "ERROR" "$OUT" | grep -qv "RLS GITHUB INTERNAL ONLY CHECKS FAILED"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi
# 書き込み assert が権限拒否以外の SQL エラー（一意制約違反など）で終わった = テストデータの不備
if grep -q "got error:" "$OUT"; then
  echo "HARNESS ERROR: an assert hit an unexpected SQL error (fix the test data):"
  grep -oE "FAIL\[[a-z0-9_]+\]: got error:.*" "$OUT"; exit 1
fi

if [ "$RED" = "1" ]; then
  FAIL_LABELS="$(grep -oE "FAIL\[[a-z0-9_]+\]" "$OUT" | sed -E 's/^FAIL\[(.*)\]$/\1/' | sort -u || true)"
  if [ -z "$FAIL_LABELS" ]; then
    echo "RED NOT REPRODUCED: all asserts passed without the fix (the test does not detect the problem)"; exit 1
  fi
  UNEXPECTED="$(printf '%s\n' "$FAIL_LABELS" | grep -vE '^(ext_|shape_)' || true)"
  if [ -n "$UNEXPECTED" ]; then
    echo "RED MISMATCH: internal viewpoints failed on the pre-fix policies (expectations differ from current behaviour):"
    printf '  %s\n' $UNEXPECTED; exit 1
  fi
  for v in cli ven clied cliadm clis2 dual; do
    if ! printf '%s\n' "$FAIL_LABELS" | grep -qE "^ext_(nt_)?${v}_"; then
      echo "RED INCOMPLETE: external viewpoint '$v' did not fail on the pre-fix policies"; exit 1
    fi
  done
  echo ""
  echo "RED CONFIRMED: $NFAIL assert(s) fail on the pre-fix policies (external viewpoints only; internal = unchanged)"
  exit 0
fi

if [ "$NFAIL" -ne 0 ] || ! grep -q "RLS GITHUB INTERNAL ONLY CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL RLS GITHUB INTERNAL ONLY CHECKS PASSED (on real migrations)"
