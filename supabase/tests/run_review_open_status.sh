#!/usr/bin/env bash
# =============================================================================
# 「社内承認を依頼したら状態も社内承認中になる」の検証ハーネス
#
# 空DBに全 migration を順に適用してから review_open_status_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ:
#   - 依頼すると backlog → in_review になる
#   - 既に in_review なら updated_at をむだに動かさない
#   - 完了済み(done)のタスクは戻さない
#   - 承認しても勝手に完了にはならない（完了は人が押す）
#   - 差し戻しても状態は戻さない（ボールだけ社内に戻る＝既存のふるまい）
#
# 使い方: bash supabase/tests/run_review_open_status.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
#   例: export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/ros.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54432
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

echo "== bootstrap + 本番と同じ既定の権限 =="
apply "$TST/_local_bootstrap.sql"
apply "$TST/harness/supabase_function_default_acl.sql"
apply "$TST/harness/supabase_table_default_acl.sql"

echo "== 全 migration を順に適用 =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  if ! psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$WORK/err.txt"; then
    echo "❌ 適用失敗: $(basename "$f")"; grep -m3 "ERROR" "$WORK/err.txt" || cat "$WORK/err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "-- $n 件適用"

echo "== 承認依頼と状態の連動の検証 =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/review_open_status_assert.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "ERROR|例外" "$OUT" | head; tail -20 "$OUT"; exit 1; }
grep -oE "PASS [0-9]+\)[^\\\\]*" "$OUT" || true
grep -q "承認依頼と状態の連動 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL REVIEW OPEN STATUS CHECKS PASSED (on real migrations)"
