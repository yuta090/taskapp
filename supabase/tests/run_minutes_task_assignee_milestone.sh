#!/usr/bin/env bash
# =============================================================================
# 議事録の行の印から担当者・マイルストーンが入ることの検証ハーネス
#
# 空DBに全 migration を順に適用してから minutes_task_assignee_milestone_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ:
#   - 印（`<!--assignee:uuid 名前-->` `<!--milestone:uuid 名前-->`）のとおりに入る
#   - 印の無い行に、前の行の担当者が持ち越されない
#   - その space に居ない人・別 space のマイルストーンは入らない（行そのものは作られる）
#   - 題名に印が残らない（プレビュー・できたタスクの両方）
#   - 書き戻した行は「タスク化済み」の印で終わり、2回押しても増えない
#
# 使い方: bash supabase/tests/run_minutes_task_assignee_milestone.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
#   例: export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/mtam.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54437
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

echo "== 担当者・マイルストーンの検証 =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/minutes_task_assignee_milestone_assert.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "ERROR|例外" "$OUT" | head; tail -20 "$OUT"; exit 1; }
grep -oE "PASS [0-9]+\)[^\\\\]*" "$OUT" || true
grep -q "議事録の担当者・マイルストーン 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL MINUTES TASK ASSIGNEE/MILESTONE CHECKS PASSED (on real migrations)"
