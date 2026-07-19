#!/usr/bin/env bash
# supabase/migrations を「空DBに先頭から順に適用」して再構築できるかを検証する。
#
# 目的: migration の順序崩れ（列を参照する migration が、列を追加する migration より先に走る）を検出する。
#   実例: tasks.client_scope は docs/db/DDL_v0.5_client_scope.sql で本番に手動適用されており、
#   supabase/migrations には存在しなかった。そのため 20260703_010 / 20260706003903 が
#   存在しない列を参照し、空DBからの再構築が不可能だった。
#
# 前提: PostgreSQL 17 が入っていること（本番と同じメジャーバージョン）
#   brew install postgresql@17
#
# 使い方: ./scripts/verify-migrations-from-scratch.sh
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PATH="$PGBIN:$PATH"

PORT="${PGPORT:-55432}"
HOST="127.0.0.1"
DB="mig_verify_$$"

command -v psql >/dev/null || { echo "psql が見つかりません（PGBIN を設定してください）"; exit 1; }
pg_isready -h "$HOST" -p "$PORT" -q || {
  echo "スクラッチ用 Postgres が $HOST:$PORT で起動していません。"
  echo "例: initdb -D /tmp/ccpgdata -U postgres && pg_ctl -D /tmp/ccpgdata -o \"-p $PORT -h $HOST\" start"
  exit 1
}

cleanup() { psql -h "$HOST" -p "$PORT" -U postgres -q -c "drop database if exists \"$DB\";" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -h "$HOST" -p "$PORT" -U postgres -q -c "create database \"$DB\";"
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/_local_bootstrap.sql

applied=0
for f in $(ls supabase/migrations/*.sql | sort); do
  if ! psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>/tmp/mig_err.txt; then
    echo "❌ 適用失敗: $(basename "$f")"
    grep -m3 "ERROR" /tmp/mig_err.txt || cat /tmp/mig_err.txt
    echo
    echo "適用済み: ${applied} 件"
    exit 1
  fi
  applied=$((applied + 1))
done

echo "✅ 空DBから ${applied} 件の migration を適用できました"
