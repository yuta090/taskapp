# Slack連携 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

Slack Bot/Appを通じた通知配信・スラッシュコマンド・インタラクション機能。タスク更新やスケジューリングイベントをSlackチャンネルに自動通知する。

## アーキテクチャ

```
Slack App
  ├── OAuth2 → /api/slack/authorize → /api/slack/callback
  ├── Webhook (Event) → /api/slack/webhook
  ├── Commands → /api/slack/commands
  ├── Interactions → /api/slack/interactions
  └── Internal APIs
      ├── /api/slack/notify (通知送信)
      ├── /api/slack/post (メッセージ投稿)
      ├── /api/slack/channels (チャンネル一覧)
      └── /api/slack/token (トークン取得)
```

## データモデル

Space設定に `slack_channel_id`, `slack_team_id` を保持し、チャンネルごとに通知を配信。

## 通知イベントタイプ

| イベント | 説明 |
|---------|------|
| `task_created` | タスク新規作成 |
| `task_updated` | タスク更新 |
| `ball_passed` | ボール移動 |
| `status_changed` | ステータス変更 |
| `comment_added` | コメント追加 |
| `review_opened` | レビュー開始 |
| `meeting_ended` | 会議終了 |
| `task_shared` | タスク手動共有 |
| `scheduling_proposal_created` | 日程調整提案作成 |
| `scheduling_response_submitted` | 日程調整回答 |
| `scheduling_slot_confirmed` | 日程確定 |
| `scheduling_proposal_expired` | 日程調整期限切れ |
| `scheduling_reminder` | スケジューリングリマインダー |

## APIエンドポイント

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/slack/authorize` | OAuth2認証開始 |
| GET | `/api/slack/callback` | OAuth2コールバック |
| POST | `/api/slack/webhook` | Slackイベント受信 |
| POST | `/api/slack/commands` | スラッシュコマンド処理 |
| POST | `/api/slack/interactions` | ボタン/モーダル操作処理 |
| POST | `/api/slack/notify` | 通知メッセージ送信 |
| POST | `/api/slack/post` | メッセージ直接投稿 |
| GET | `/api/slack/channels` | チャンネル一覧取得 |
| GET | `/api/slack/token` | Bot Token取得 |

## ライブラリ構成

| ファイル | 用途 |
|---------|------|
| `src/lib/slack/config.ts` | 設定・機能フラグ |
| `src/lib/slack/client.ts` | Slack API クライアント |
| `src/lib/slack/oauth.ts` | OAuth2フロー |
| `src/lib/slack/verify.ts` | リクエスト署名検証 |
| `src/lib/slack/notify.ts` | 通知送信ロジック |
| `src/lib/slack/blocks.ts` | Block Kit メッセージ構築 |
| `src/lib/slack/modals.ts` | モーダルビュー構築 |
| `src/lib/slack/usermap.ts` | Slack↔TaskAppユーザーマッピング |
| `src/lib/slack/provider.ts` | 通知プロバイダー抽象化 |

## 通知プロバイダー抽象化

`src/lib/notifications/` で通知配信を抽象化:

| ファイル | 用途 |
|---------|------|
| `types.ts` | `NotificationEventType`, `TaskNotificationPayload` 型定義 |
| `classify.ts` | 通知のアクション要否分類（actionable/informational） |
| `registry.ts` | プロバイダー登録・配信ルーティング |

### アクション要通知タイプ

`review_request`, `confirmation_request`, `urgent_confirmation`, `ball_passed`, `spec_decision_needed`, `task_assigned`

## フロントエンド

| コンポーネント | 用途 |
|--------------|------|
| `SlackChannelSettings` | Space設定内Slackチャンネル選択 |
| `useSlack()` hook | Slack連携状態管理 |

## セキュリティ

- Slack署名検証（HMAC SHA-256）
- OAuth2トークンのサーバーサイド管理
- `isSlackConfigured()` による機能フラグ

## 環境変数

| 変数 | 用途 |
|------|------|
| `SLACK_CLIENT_ID` | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret |
| `SLACK_SIGNING_SECRET` | リクエスト署名検証 |
| `SLACK_STATE_SECRET` | OAuth state暗号化 |
| `NEXT_PUBLIC_SLACK_ENABLED` | Slack機能の有効化フラグ |
