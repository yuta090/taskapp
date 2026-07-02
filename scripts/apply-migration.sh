#!/usr/bin/env bash
#
# apply-migration.sh — 単一マイグレーションファイルを安全に適用する
#
# `supabase db push`（差分適用・意図しないDROPのリスク）は使わない。
# 指定した1ファイルだけを、既定でドライラン（BEGIN→実行→ROLLBACK）で検証し、
# --commit を付けたときだけ単一トランザクションで本番反映する。
#
# 接続情報:
#   SUPABASE_DB_URL 環境変数（.env.local から自動読込。gitignore済み）
#   例: postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres?sslmode=require
#   ※ Supabase Dashboard → Project Settings → Database → Connection string の
#      「Direct connection」または「Session pooler」を使う（Transaction pooler:6543 は不可）。
#
# 使い方:
#   scripts/apply-migration.sh <file.sql>                 # ドライラン（既定・安全）
#   scripts/apply-migration.sh <file.sql> --commit        # 本番適用（要 APPLY 入力）
#   scripts/apply-migration.sh <file.sql> --commit --yes  # 非対話で適用（確認スキップ）
#   scripts/apply-migration.sh <file.sql> --commit --no-transaction   # CONCURRENTLY等トランザクション外で適用
#   scripts/apply-migration.sh <file.sql> --commit --allow-destructive # 破壊的文を許可
#
set -euo pipefail

# ---- 引数パース -------------------------------------------------------------
FILE=""
COMMIT=0
NO_TX=0
ALLOW_DESTRUCTIVE=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --commit) COMMIT=1 ;;
    --no-transaction) NO_TX=1 ;;
    --allow-destructive) ALLOW_DESTRUCTIVE=1 ;;
    --yes) ASSUME_YES=1 ;;
    --help|-h)
      sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "❌ 不明なオプション: $arg" >&2; exit 2 ;;
    *) FILE="$arg" ;;
  esac
done

if [[ -z "$FILE" ]]; then
  echo "❌ マイグレーションファイルを指定してください。 --help で使い方を表示。" >&2
  exit 2
fi
if [[ ! -f "$FILE" ]]; then
  echo "❌ ファイルが見つかりません: $FILE" >&2
  exit 2
fi

# ---- 接続情報の読込（.env.local から SUPABASE_DB_URL）-----------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${SUPABASE_DB_URL:-}" && -f "$ROOT_DIR/.env.local" ]]; then
  # .env.local から SUPABASE_DB_URL のみ抽出（他の値は読み込まない）
  line="$(grep -E '^SUPABASE_DB_URL=' "$ROOT_DIR/.env.local" || true)"
  if [[ -n "$line" ]]; then
    SUPABASE_DB_URL="${line#SUPABASE_DB_URL=}"
    # 前後のクォートを除去
    SUPABASE_DB_URL="${SUPABASE_DB_URL%\"}"; SUPABASE_DB_URL="${SUPABASE_DB_URL#\"}"
    SUPABASE_DB_URL="${SUPABASE_DB_URL%\'}"; SUPABASE_DB_URL="${SUPABASE_DB_URL#\'}"
  fi
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  cat >&2 <<'MSG'
❌ SUPABASE_DB_URL が未設定です。
   .env.local に以下を追記してください（Dashboard → Settings → Database → Connection string）:
   SUPABASE_DB_URL="postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
   ※ Direct connection か Session pooler を使用（Transaction pooler:6543 は不可）
MSG
  exit 2
fi

# ---- 接続先の表示（パスワードはマスク）-------------------------------------
mask_url() {
  # postgresql://user:pass@host... の :pass@ を :****@ に
  printf '%s' "$1" | sed -E 's#(://[^:]+:)[^@]+(@)#\1****\2#'
}

# ---- 破壊的文の検査 ---------------------------------------------------------
# コメント行を除いた本文で判定
BODY="$(grep -vE '^\s*--' "$FILE" || true)"
DESTRUCTIVE_HITS="$(printf '%s' "$BODY" | grep -inE '\b(drop\s+(table|column|schema|database|type|function|policy|index)|truncate|alter\s+table\s+.*\s+drop\s+|delete\s+from)\b' || true)"

if [[ -n "$DESTRUCTIVE_HITS" ]]; then
  echo "⚠️  破壊的の可能性がある文を検出:" >&2
  printf '%s\n' "$DESTRUCTIVE_HITS" | sed 's/^/    /' >&2
  # DELETE ... WHERE は比較的安全なので情報表示のみ、それ以外は要フラグ
  HARD_HITS="$(printf '%s' "$BODY" | grep -inE '\b(drop\s+(table|column|schema|database)|truncate)\b' || true)"
  if [[ -n "$HARD_HITS" && "$ALLOW_DESTRUCTIVE" -ne 1 ]]; then
    echo "❌ DROP/TRUNCATE を含みます。意図的なら --allow-destructive を付けてください。" >&2
    exit 3
  fi
fi

# ---- CONCURRENTLY のトランザクション整合チェック ---------------------------
if grep -iqE 'concurrently' "$FILE"; then
  if [[ "$NO_TX" -ne 1 ]]; then
    echo "❌ ファイルに CONCURRENTLY が含まれます。トランザクション内では実行できません。" >&2
    echo "   --no-transaction を付けて（かつ --commit で）実行してください。ドライラン不可。" >&2
    exit 3
  fi
fi

echo "──────────────────────────────────────────────"
echo " ファイル : $FILE"
echo " 接続先   : $(mask_url "$SUPABASE_DB_URL")"
echo " モード   : $([[ $COMMIT -eq 1 ]] && echo '本番適用 (COMMIT)' || echo 'ドライラン (ROLLBACK)')$([[ $NO_TX -eq 1 ]] && echo ' / トランザクション外' || echo '')"
echo "──────────────────────────────────────────────"

PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -q)

# ---- ドライラン -------------------------------------------------------------
if [[ "$COMMIT" -ne 1 ]]; then
  echo "🧪 ドライラン: BEGIN → 実行 → ROLLBACK（本番は一切変更されません）"
  if [[ "$NO_TX" -eq 1 ]]; then
    echo "⚠️  --no-transaction 指定時はドライラン不可（CONCURRENTLY等）。--commit で実行してください。" >&2
    exit 3
  fi
  set +e
  printf 'BEGIN;\n\\i %s\nROLLBACK;\n' "$FILE" | "${PSQL[@]}"
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    echo "✅ ドライラン成功: SQLは本番スキーマ上で問題なく実行できます（変更は破棄済み）。"
    echo "   反映するには同じコマンドに --commit を付けて再実行してください。"
  else
    echo "❌ ドライラン失敗（rc=$rc）。上記エラーを確認してください。本番は未変更です。" >&2
  fi
  exit $rc
fi

# ---- 本番適用（確認）-------------------------------------------------------
if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "⚠️  本番DBに適用します。よろしければ APPLY と入力してください。"
  read -r -p "> " CONFIRM </dev/tty || { echo "❌ 確認入力を取得できません。--yes を使うか対話端末で実行してください。" >&2; exit 4; }
  if [[ "$CONFIRM" != "APPLY" ]]; then
    echo "中止しました（APPLY 以外が入力されました）。"
    exit 4
  fi
fi

LOG="$SCRIPT_DIR/.migration-apply.log"
ts="$(date '+%Y-%m-%d %H:%M:%S')"

echo "🚀 適用中..."
set +e
if [[ "$NO_TX" -eq 1 ]]; then
  "${PSQL[@]}" -f "$FILE"
else
  "${PSQL[@]}" --single-transaction -f "$FILE"
fi
rc=$?
set -e

if [[ $rc -eq 0 ]]; then
  echo "✅ 適用成功: $FILE"
  echo "$ts  OK    $([[ $NO_TX -eq 1 ]] && echo 'no-tx' || echo 'tx')  $FILE" >> "$LOG"
else
  echo "❌ 適用失敗（rc=$rc）。$([[ $NO_TX -eq 1 ]] && echo 'トランザクション外のため一部が適用済みの可能性あり。' || echo '単一トランザクションのため全ロールバック済み。')" >&2
  echo "$ts  FAIL  $([[ $NO_TX -eq 1 ]] && echo 'no-tx' || echo 'tx')  $FILE" >> "$LOG"
fi
exit $rc
