#!/bin/sh
# agentpm CLI（packages/cli）を npm に公開する。
#
# ⚠ ユーザー本人のターミナルで実行する。npm のアカウントは二要素認証（公開のたびにブラウザで
#   本人確認）なので、Claude の Bash や Claude Code の `!` からは確認画面を出せず EOTP で落ちる。
#
# 使い方: publish-cli.sh [--dry-run] [リポジトリのパス]
#   - 公開するのは origin/main の packages/cli（手元のブランチや未コミットの変更は載せない）
#   - --dry-run: 公開せず、載る中身だけ確かめる（本人確認が要らないので Claude からも実行できる）
#   - Claude からの渡し方は CLAUDE.md の「CLI（agentpm）を npm に公開する」
#
# 自動テストは無い（本物の npm と本人確認が要るため）。変えたら --dry-run で確かめる。
set -eu

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi
REPO="${1:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -z "$REPO" ] || ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ リポジトリのパスを指定してください（例: $0 /Volumes/WIN-MAC2/scripts/taskapp）"
  exit 1
fi

echo "→ main の最新を取得しています"
git -C "$REPO" fetch -q origin main
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO" archive origin/main packages/cli | tar -x -C "$WORK"
CLI="$WORK/packages/cli"

NAME=$(node -p "require('$CLI/package.json').name")
VERSION=$(node -p "require('$CLI/package.json').version")
if ! grep -q "const CLI_VERSION = '$VERSION'" "$CLI/src/index.ts"; then
  echo "✗ packages/cli/src/index.ts の CLI_VERSION が package.json の $VERSION と一致しません"
  exit 1
fi
PUBLISHED=$(npm view "$NAME" version 2>/dev/null || echo "なし")
echo "→ $NAME: いま公開中 $PUBLISHED / main の版 $VERSION"
if [ "$PUBLISHED" = "$VERSION" ] && [ "$DRY_RUN" = 0 ]; then
  echo "✗ $VERSION はもう公開済みです。packages/cli/package.json と src/index.ts の版を上げて main に取り込んでから、もう一度実行してください"
  exit 1
fi

# 作り直しに要る道具（typescript）。手元のリポジトリに入っていれば借り、無ければ入れる
if [ -d "$REPO/packages/cli/node_modules" ]; then
  ln -s "$REPO/packages/cli/node_modules" "$CLI/node_modules"
else
  (cd "$CLI" && npm ci --silent)
fi
cd "$CLI"
# src から dist を作り直す（コミット済みの dist が古い・消したソースの成果物が残っていても正しい中身になる）
rm -rf dist
npm run build --silent
npm pack --dry-run 2>&1 | grep -E "name:|version:|total files:"

if [ "$DRY_RUN" = 1 ]; then
  echo "（--dry-run のため公開していません）"
  exit 0
fi
if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "✗ ご自身のターミナルで実行してください（npm の本人確認の画面を出せません）"
  exit 1
fi

npm whoami >/dev/null 2>&1 || npm login
echo "→ 公開します。ブラウザを開く案内が出たら Enter を押し、本人確認をしてください"
npm publish --access public --ignore-scripts

echo "→ 反映を待っています（1分ほどかかることがあります）"
i=0
until [ "$(npm view "$NAME" version --prefer-online 2>/dev/null)" = "$VERSION" ]; do
  i=$((i + 1))
  if [ "$i" -gt 36 ]; then
    echo "⚠ まだ反映されていません。少し待ってから npm install -g $NAME で入れ直してください"
    exit 0
  fi
  sleep 5
done

if npm ls -g --depth=0 agentpm >/dev/null 2>&1; then
  echo "⚠ 開発用の agentpm（npm link）が入っているので、入れ直しは飛ばします。npm unlink -g agentpm のあと npm install -g $NAME で入れ直してください"
  exit 0
fi
npm install -g "$NAME@$VERSION" >/dev/null
echo "✓ 公開しました: $NAME@$(agentpm --version)"
