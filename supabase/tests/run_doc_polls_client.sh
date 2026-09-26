#!/usr/bin/env bash
# =============================================================================
# 投票ブロック PR3（相手先も読める・押せる）の検証ハーネス
#
# 空DBに全 migration を順に適用してから doc_polls_client_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ（仕様 docs/spec/DOC_VOTE_SPEC.md §4）:
#   - 作れるのは社内の編集者だけ。space / org は文書から取る
#   - 押せるのは社内（読むだけの人を含む）。1人1票・選び直しと取り消しは履歴に残る
#   - 理由必須の投票は NG・保留の空メモを拒否する。設定は作ったあと変えられない
#   - 表へ直接は書けない（入口の関数だけ）。相手先・別組織・aal1 は読めない
#
# 使い方: bash supabase/tests/run_doc_polls.sh
#         RED=1 bash supabase/tests/run_doc_polls.sh   # 本 migration を外して、落ちることを確かめる
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"
TARGET="doc_polls_client.sql"

WORK="$(mktemp -d /tmp/dpollc.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54458
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
  if [ "$RED" = "1" ] && [[ "$(basename "$f")" == *"_$TARGET" ]]; then
    echo "-- RED: $(basename "$f") を外す"; continue
  fi
  if ! psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$WORK/err.txt"; then
    echo "❌ 適用失敗: $(basename "$f")"; grep -m3 "ERROR" "$WORK/err.txt" || cat "$WORK/err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "-- $n 件適用"

echo "== 投票ブロックの検証 =="
OUT="$WORK/o.out"
if ! PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/doc_polls_client_assert.sql" > "$OUT" 2>&1; then
  grep -oE "PASS\[[^]]*\]" "$OUT" | tr '\n' ' ' || true
  echo ""; echo "STEP FAILED"; grep -E "ERROR|FAIL" "$OUT" | head -5
  exit 1
fi
grep -c "PASS\[" "$OUT" | xargs -I{} echo "-- PASS {} 件"
grep -q "DOC POLLS CLIENT 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo "ALL DOC POLLS CLIENT CHECKS PASSED (on real migrations)"
