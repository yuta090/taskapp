---
name: agentpm
description: AgentPMでタスク管理を操作する。「タスク作成」「進捗確認」「ボール確認」「レビュー」「マイルストーン」「ミーティング」「Wiki」等と言われた時に使用。
---

# AgentPM CLI スキル

AgentPM CLI (`agentpm`) を使ってプロジェクト管理操作を実行します。
MCPサーバーの代わりに、CLIコマンドをBashで実行します。

## 前提

- `agentpm` CLI がインストール済み (`npm install -g @uzukko/agentpm`)
- `agentpm login` で API Key を設定済み
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

## 注意事項

- `--space-id` は `~/.taskapprc.json` の `defaultSpaceId` で省略可能
- 日付は `YYYY-MM-DD` 形式を使用
- 全コマンドに `--json` を付けてJSON出力にする
- エラー時はstderrにメッセージが出力される
