#!/usr/bin/env bash
# =============================================================================
# 「CLI から承認依頼を取り消す」の検証ハーネス
#
# 空DBに全 migration を順に適用してから review_cancel_as_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ:
#   - rpc_review_cancel_as で取り消せ、監査（task_events.actor_id）が渡した人になる
#   - 宙に浮いた承認者と依頼者に「対応不要」が届き、取り消した本人には出ない
#   - 画面用（rpc_review_cancel・auth.uid()）もこれまでどおり動く
#   - 承認済みの依頼は取り消せない／依頼者・管理者・オーナー以外は取り消せない
#   - 閲覧のみ・相手先の役割は前段で断られる／別の組織からは越えられない
#   - 取り消したあと、同じタスクに依頼し直せる／取り消し済みは二度取り消せない
#   - authenticated は道具用（_as）を呼べない／本体は誰も直接呼べない
#
# 使い方: bash supabase/tests/run_review_cancel_as.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
#   例: export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/rca.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54451
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

echo "== CLIからの承認依頼の取り消しの検証 =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/review_cancel_as_assert.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "ERROR|例外" "$OUT" | head; tail -20 "$OUT"; exit 1; }
grep -oE "PASS [0-9]+\)[^\\\\]*" "$OUT" || true
grep -q "CLIからの承認依頼の取り消し 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
for n in 11 12; do
  grep -q "PASS $n)" "$OUT" || { echo "NOT PASSED ($n)"; tail -30 "$OUT"; exit 1; }
done
echo ""
echo "ALL REVIEW CANCEL AS CHECKS PASSED (on real migrations)"
