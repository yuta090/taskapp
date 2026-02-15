---
name: meeting-flow
description: 会議の作成〜開始〜議事録〜終了〜タスク起票までの一連のフロー。「会議フロー」「議事録作成」「会議を開始」と言われた時に使用。
---

# 会議フロー スキル

会議の作成から議事録記録、タスク起票までの一連のワークフローを実行します。

## ワークフロー

### 1. 会議作成
MCP `meeting_create` で会議を作成。参加者UUIDが分からない場合は `client_list` でクライアント一覧を確認。

### 2. 会議開始
MCP `meeting_start` で `planned → in_progress` に遷移。

### 3. 議事録記録
会議中のメモを `minutes_update` で記録、または `minutes_append` で追記。
Markdown形式で以下の構成を推奨：
```markdown
## 議題
- ...

## 決定事項
- ...

## アクションアイテム
- [ ] 担当: XXX / 期限: YYYY-MM-DD
```

### 4. 会議終了
MCP `meeting_end` を呼び出し。自動サマリーが生成される。

### 5. タスク起票（オプション）
議事録のアクションアイテムから `task_create` でタスクを自動起票。
- ball: 担当者に応じて `client` or `internal`
- origin: `internal`（会議で発生）

## 使用するMCPツール
| ステップ | ツール |
|---------|--------|
| 作成 | `meeting_create` |
| 開始 | `meeting_start` |
| 議事録 | `minutes_update` / `minutes_append` |
| 終了 | `meeting_end` |
| タスク化 | `task_create` |
| 確認 | `minutes_get` |
