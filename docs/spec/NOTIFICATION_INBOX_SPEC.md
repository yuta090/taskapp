# 通知 & アクション受信トレイ 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

通知をアクション要否で分類し、受信トレイ（Inbox）でタスクのアクションを直接実行可能にする。

## 通知分類

### Actionable（要アクション）

| タイプ | 説明 |
|--------|------|
| `review_request` | レビュー依頼 |
| `confirmation_request` | 確認依頼 |
| `urgent_confirmation` | 緊急確認依頼 |
| `ball_passed` | ボール受け取り |
| `spec_decision_needed` | 仕様決定依頼 |
| `task_assigned` | タスクアサイン |

### Informational（情報通知）

上記以外のすべての通知イベント（task_created, status_changed, comment_added 等）。

## フロントエンド

### 受信トレイ (`/inbox`)

- `/inbox` ページで通知一覧を表示
- 要アクション通知は件数バッジで強調
- `NotificationInspector` で通知タイプ別のアクションパネルを表示
- 通知クリックで関連タスク/会議のインスペクタに遷移

### Hooks

| Hook | 用途 |
|------|------|
| `useNotifications()` | 通知一覧取得・既読管理 |
| `useUnreadNotificationCount()` | 未読件数（LeftNavバッジ用） |

### コンポーネント

| コンポーネント | 用途 |
|--------------|------|
| `NotificationInspector` | 通知詳細 & タイプ別アクションパネル |

## ライブラリ

| ファイル | パス | 用途 |
|---------|------|------|
| `classify.ts` | `src/lib/notifications/classify.ts` | 通知のactionable/informational分類 |
| `types.ts` | `src/lib/notifications/types.ts` | 通知イベント型・ペイロード型定義 |
| `registry.ts` | `src/lib/notifications/registry.ts` | 通知プロバイダー登録 |

## Slack連携

通知はSlack連携が有効な場合、Slackチャンネルにも自動配信される。
詳細は `SLACK_INTEGRATION_SPEC.md` を参照。
