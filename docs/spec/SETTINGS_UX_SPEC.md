# 設定画面UX 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み（Phase 1-5）

## 概要

設定画面のUXリデザイン。サイドバーナビゲーション、toast通知、接続ステータス、セットアップウィザード、設定検索を段階的に実装。

## Phase 1: サイドバーナビゲーション

5カテゴリに整理されたサイドバー:

### ユーザー設定 (`/settings/`)

| ページ | パス | 機能 |
|--------|------|------|
| アカウント | `/settings/account` | プロフィール・パスワード変更 |
| 通知 | `/settings/notifications` | 通知設定 |
| 表示設定 | `/settings/preferences` | テーマ・言語 |
| 連携 | `/settings/integrations` | Google Calendar等の個人連携 |

### 組織設定 (`/settings/`)

| ページ | パス | 機能 |
|--------|------|------|
| 組織情報 | `/settings/organization` | 組織名・設定 |
| メンバー | `/settings/members` | メンバー管理・招待 |
| 課金 | `/settings/billing` | プラン・請求 |
| APIキー | `/settings/api-keys` | API Key管理 |
| 組織連携 | `/settings/org-integrations` | Slack・GitHub等の組織連携 |

### プロジェクト設定

| コンポーネント | 機能 |
|--------------|------|
| `GeneralSettings` | スペース名・説明 |
| `MembersSettings` | メンバー管理 |
| `MilestonesSettings` | マイルストーン管理 |
| `SlackChannelSettings` | Slackチャンネル連携 |
| `GitHubRepoSettings` | GitHubリポジトリ連携 |
| `VideoProviderSettings` | ビデオ会議プロバイダー |
| `ApiSettings` | API設定 |
| `ExportSettings` | データエクスポート |
| `PresetSettings` | プリセットテンプレート |

## Phase 2: Toast通知

- `alert()` を全廃止（14箇所）
- sonner の `toast()` に統一置換
- 成功/エラー/情報の視覚的フィードバック

## Phase 3: 接続ステータスバッジ

| ステータス | 色 | 意味 |
|-----------|-----|------|
| connected | 緑 | 連携済み |
| disconnected | グレー | 未連携 |
| warning | 黄 | 要確認 |

## Phase 4: セットアップバナー

`SetupBanner` コンポーネントで3ステップのウィザード:
1. 基本設定（スペース名・説明）
2. メンバー招待
3. 連携設定（Slack/GitHub）

## Phase 5: 設定検索

- `/` または `Cmd+K` で設定検索を起動
- `CommandPalette` コンポーネント（`src/components/shared/CommandPalette.tsx`）
- 設定ページ横断のインクリメンタル検索
