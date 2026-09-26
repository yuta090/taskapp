#!/usr/bin/env bash
# =============================================================================
# 投票の CLI 用入口（rpc_doc_vote_cast_as。20260926133744_doc_vote_cast_as.sql）の検証ハーネス
#
# 空DBに全 migration を順に適用してから doc_vote_cli_as_assert.sql を流す。
# 使い捨てクラスタを起動し、終了時に破棄する。本番DBには一切触れない。
#
# 見るところ（DOC_VOTE_SPEC.md §4・20260926133744_doc_vote_cast_as.sql）:
#   - 道具用(rpc_doc_vote_cast_as)は service_role だけが呼べる。authenticated / anon は拒否される
#   - 押せる人（社内・読むだけの人を含む）・拒否される人（相手先・別 org）は画面用と同じ範囲
#   - 押す・選び直す・取り消す・同じ内容の押し直し（履歴を増やさない）・理由必須・引数の形の検査は
#     画面用（rpc_doc_vote_cast）と同じ挙動
#   - 画面用（rpc_doc_vote_cast・auth.uid()・mfa_satisfied）はこれまでどおり動く（回帰）
#
# 使い方: bash supabase/tests/run_doc_vote_cli_as.sh
#         RED=1 bash supabase/tests/run_doc_vote_cli_as.sh   # 本 migration を外して、落ちることを確かめる
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PostgreSQL 17 想定）
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"
TARGET="doc_vote_cast_as.sql"

WORK="$(mktemp -d /tmp/dvcas.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54461
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

echo "== bootstrap + 本番と同じ既定の権限 =="
psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$TST/_local_bootstrap.sql" >/dev/null
psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$TST/harness/supabase_function_default_acl.sql" >/dev/null
psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$TST/harness/supabase_table_default_acl.sql" >/dev/null

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

echo "== CLI 用入口(rpc_doc_vote_cast_as)の検証 =="
OUT="$WORK/o.out"
if ! PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/doc_vote_cli_as_assert.sql" > "$OUT" 2>&1; then
  grep -oE "PASS\[[^]]*\]" "$OUT" | tr '\n' ' ' || true
  echo ""; echo "STEP FAILED"; grep -E "ERROR|FAIL" "$OUT" | head -5
  exit 1
fi
grep -c "PASS\[" "$OUT" | xargs -I{} echo "-- PASS {} 件"
grep -q "DOC VOTE CLI AS 全項目 PASS" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }

echo "ALL DOC VOTE CLI AS CHECKS PASSED (on real migrations)"
