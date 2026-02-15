---
name: review-cycle
description: レビューの開始から承認/ブロック、ボール移動までの一連のフロー。「レビュー依頼」「承認フロー」「レビューして」と言われた時に使用。
---

# レビューサイクル スキル

タスクのレビュー依頼→レビュアー確認→承認/ブロック→ボール移動の一連のフローを実行します。

## ワークフロー

### 1. レビュー開始
MCP `review_open` でタスクにレビューを開始。
- レビュアーを1名以上指定
- タスクのステータスは自動で `in_review` に遷移

### 2. レビュー状態確認
MCP `review_get` で各レビュアーの承認状態を確認。
- pending: 未対応
- approved: 承認済
- blocked: 変更要求あり

### 3. 承認 or ブロック
- 承認: `review_approve` → 全員が承認するとレビューは自動クローズ
- ブロック: `review_block` + 理由の記載 → 修正依頼として差し戻し

### 4. ボール移動（必要に応じて）
レビュー完了後、`ball_pass` でボールをクライアントに移動。
- ball=client + clientOwnerIds でクライアント確認待ちに

### 5. オープンレビュー一覧
`review_list` (status=open) で未完了レビューの一覧を確認。

## 使用するMCPツール
| ステップ | ツール |
|---------|--------|
| レビュー開始 | `review_open` |
| 状態確認 | `review_get` |
| 承認 | `review_approve` |
| ブロック | `review_block` |
| 一覧 | `review_list` |
| ボール移動 | `ball_pass` |
| タスク確認 | `task_get` |
