---
name: client-onboarding
description: クライアントの招待からスペース追加、初期タスク作成まで。「クライアント追加」「クライアント招待」「新規クライアント」と言われた時に使用。
---

# クライアントオンボーディング スキル

新しいクライアントの招待→スペース追加→初期タスク作成の一連のフローを実行します。

## ワークフロー

### 1. クライアント招待
MCP `client_invite_create` でメールアドレスとスペースを指定して招待。
- 複数名の場合は `client_invite_bulk_create` で一括招待（最大50件）

### 2. 招待状況確認
MCP `client_invite_list` (status=pending) で未承諾の招待を確認。
- 期限切れの場合は `client_invite_resend` で再送

### 3. スペース追加（既存クライアント）
既にアカウントがあるクライアントは `client_add_to_space` で別プロジェクトに追加。

### 4. 初期タスク作成（オプション）
クライアント向けの初期タスクを `task_create` で作成。
- ball: `client`（クライアントが対応する）
- origin: `internal`（社内から起票）
- clientOwnerIds: 招待したクライアントのUUID
- clientScope: `deliverable`（ポータルに表示）

## 使用するMCPツール
| ステップ | ツール |
|---------|--------|
| 招待（単体） | `client_invite_create` |
| 招待（一括） | `client_invite_bulk_create` |
| 招待確認 | `client_invite_list` |
| 招待再送 | `client_invite_resend` |
| スペース追加 | `client_add_to_space` |
| ロール変更 | `client_update` |
| タスク作成 | `task_create` |
| クライアント確認 | `client_list` / `client_get` |
