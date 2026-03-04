---
name: agentpm
description: AgentPMでタスク管理を操作する。「タスク作成」「進捗確認」「ボール確認」「レビュー」「マイルストーン」「ミーティング」「Wiki」等と言われた時に使用。
---

# AgentPM CLI スキル

AgentPM CLI (`agentpm`) を使ってプロジェクト管理操作を実行します。
MCPサーバーの代わりに、CLIコマンドをBashで実行します。

## セットアップ（自動）

スキル実行時に以下を自動チェックし、未完了なら実行する：

1. **インストール確認**: `which agentpm` で存在チェック
   - 未インストール → `npm install -g @uzukko/agentpm` を実行
2. **ログイン確認**: `agentpm space list --json 2>&1` でAPI認証チェック
   - 未認証 → ユーザーにAPI Keyを `AskUserQuestion` で聞き、`agentpm login --api-key <key>` を実行
3. **デフォルトスペース確認**: `~/.taskapprc.json` の存在チェック
   - 未設定 → `agentpm space list --json` でスペース一覧を取得し、ユーザーに選択させて設定

## 前提

- `--json` フラグで常にJSON出力を使う（パースしやすい）

## コマンドリファレンス

### タスク管理

```bash
# タスク一覧
agentpm task list --json [--space-id <uuid>] [--status <status>] [--ball <side>] [--limit <n>]

# タスク作成
agentpm task create --json --space-id <uuid> --title "タスク名" [--description "説明"] [--status <status>] [--ball <side>] [--due-date <YYYY-MM-DD>] [--milestone-id <uuid>]

# タスク詳細
agentpm task get --json --task-id <uuid>

# タスク更新
agentpm task update --json --task-id <uuid> [--title "新タイトル"] [--status <status>] [--due-date <date>] [--priority <n>]

# 自分のタスク
agentpm task list-my --json [--ball <side>] [--status <status>]

# 滞留タスク
agentpm task stale --json [--space-id <uuid>] [--stale-days <n>]
```

ステータス: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `considering`
ボール: `client`（クライアント側）, `internal`（社内側）

### ボール管理

```bash
# ボールパス（担当変更）
agentpm ball pass --json --task-id <uuid> --ball <side> [--reason "理由"]

# ボール状態照会
agentpm ball query --json --ball <side> [--include-owners]

# ダッシュボード（タスク統計）
agentpm dashboard --json [--space-id <uuid>]
```

### プロジェクト

```bash
agentpm space list --json
agentpm space get --json [--space-id <uuid>]
```

### マイルストーン

```bash
agentpm milestone list --json [--space-id <uuid>]
agentpm milestone create --json --space-id <uuid> --name "名前" [--due-date <date>]
agentpm milestone update --json --milestone-id <uuid> [--name "名前"] [--due-date <date>]
```

### ミーティング

```bash
agentpm meeting list --json [--space-id <uuid>] [--status <status>]
agentpm meeting create --json --space-id <uuid> --title "タイトル" [--held-at <datetime>]
agentpm meeting start --json --meeting-id <uuid>
agentpm meeting end --json --meeting-id <uuid>
```

### レビュー

```bash
agentpm review list --json [--space-id <uuid>] [--status <status>]
agentpm review open --json --task-id <uuid> --reviewer-ids <id1> <id2>
agentpm review approve --json --task-id <uuid>
agentpm review block --json --task-id <uuid> --reason "理由"
```

### Wiki

```bash
agentpm wiki list --json [--space-id <uuid>]
agentpm wiki get --json --page-id <uuid>
agentpm wiki create --json --space-id <uuid> --title "タイトル" --body "本文"
agentpm wiki update --json --page-id <uuid> [--title "タイトル"] [--body "本文"]
```

### 議事録

```bash
agentpm minutes get --json --meeting-id <uuid>
agentpm minutes update --json --meeting-id <uuid> --minutes-md "# 議事録..."
agentpm minutes append --json --meeting-id <uuid> --content "追記内容"
```

## ワークフロー例

### プロジェクト状況確認
1. `agentpm dashboard --json` でタスク統計を取得
2. `agentpm milestone list --json` でマイルストーン確認
3. `agentpm ball query --json --ball client` でクライアント待ちタスク確認
4. `agentpm review list --json --status open` でオープンレビュー確認
5. 結果をまとめてレポート出力

### タスク完了フロー
1. `agentpm task update --json --task-id <uuid> --status done` でステータス更新
2. 必要に応じて `agentpm ball pass --json --task-id <uuid> --ball client --reason "完了確認お願いします"` でクライアントにボールパス

## ボール判定ルール（タスク作成時）

タスク作成時、AIがタスク内容からボール（`client` / `internal`）を判定する。

### デフォルト: `internal`（開発者側）

全てのタスクはデフォルトで `--ball internal` で作成する。

### クライアントボール判定基準

以下のいずれかに該当する場合、AIは `client` 候補と判定する：

- クライアントの確認・承認が必要（「確認お願いします」「承認ください」等）
- クライアントからの情報提供待ち（「素材提供」「原稿」「ロゴデータ」等）
- クライアント側での作業が必要（「社内調整」「契約手続き」等）
- クライアントへの質問・回答待ち（「仕様についてご質問」等）

### 確認フロー

1. AIが入力内容を分析し、各タスクのボールを判定
2. `client` と判定したタスクを一覧で `AskUserQuestion`（multiSelect）で表示
3. ユーザーが承認したものだけ `--ball client` で作成
4. 承認されなかったものはデフォルトの `--ball internal` で作成

```
例: ユーザーが5つのタスクを依頼
→ AIが2つを「クライアントボール候補」と判定
→ 確認リスト表示:
  ☑ ロゴデータの提供待ち（理由: クライアントからの素材提供）
  ☑ 契約書の押印（理由: クライアント側の手続き）
→ ユーザーが1つだけ承認
→ 結果: 4つが internal、1つが client で作成
```

## 注意事項

- `--space-id` は `~/.taskapprc.json` の `defaultSpaceId` で省略可能
- 日付は `YYYY-MM-DD` 形式を使用
- 全コマンドに `--json` を付けてJSON出力にする
- エラー時はstderrにメッセージが出力される
