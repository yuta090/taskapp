#!/usr/bin/env bash
# =============================================================================
# 「確定した時点の控え」の検証ハーネス
#
# 空DBに全 migration を順に適用してから minutes_taskify_plain_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ:
#   - rpc_set_spec_state が kind='decided' / task_id 付きの控えを作る
#   - その控えの本文に決定行が**入っていない**（＝確定した瞬間の内容）
#   - ページの末尾に、札へのリンク付きの決定行が入る（絵文字なし）
#   - authenticated は kind / task_id を付けて控えを作れない（名札の偽造防止）
#   - 5列だけの控えは権限では止まらない（＝これまでの自動保存・CLI が壊れていない）
#
# 使い方: bash supabase/tests/run_wiki_decision_versions.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
#   例: export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/mtp.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54436
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

echo "== リンク無しの行のタスク化の検証 =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/minutes_taskify_plain_assert.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "ERROR|例外" "$OUT" | head; tail -20 "$OUT"; exit 1; }
grep -oE "PASS [0-9]+\)[^\\\\]*" "$OUT" || true
grep -q "リンク無しの行のタスク化 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL MINUTES TASKIFY PLAIN CHECKS PASSED (on real migrations)"
