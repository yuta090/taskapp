# GitHub連携 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

GitHub Appを通じたPR追跡・リポジトリ連携機能。タスクとPull Requestを紐づけ、開発進捗を可視化する。

## アーキテクチャ

```
GitHub App
  ├── Webhook → /api/github/webhook
  │   ├── pull_request イベント → PR作成/更新/マージ同期
  │   ├── installation イベント → アプリインストール/アンインストール
  │   └── installation_repositories → リポジトリ追加/削除
  ├── OAuth → /api/github/callback
  └── REST API → /api/github/repositories, /api/github/spaces
```

## データモデル

| テーブル | 用途 |
|---------|------|
| `github_installations` | 組織ごとのGitHub App インストール情報 |
| `github_repositories` | 連携可能リポジトリ一覧 |
| `space_github_repos` | Space↔リポジトリの紐づけ |
| `github_pull_requests` | PR情報（タイトル、ステータス、ブランチ等） |
| `task_github_links` | タスク↔PRの紐づけ（多対多） |
| `github_webhook_events` | Webhookイベントログ |

## APIエンドポイント

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/github/webhook` | GitHub Webhookの受信・署名検証・イベント処理 |
| GET | `/api/github/callback` | OAuth認証コールバック |
| GET | `/api/github/repositories` | 組織の連携可能リポジトリ取得 |
| GET/POST | `/api/github/spaces` | Space-リポジトリ紐づけ管理 |

## フロントエンド

### コンポーネント

| コンポーネント | パス | 用途 |
|--------------|------|------|
| `TaskPRList` | `src/components/github/TaskPRList.tsx` | タスクインスペクタ内PR一覧・手動リンク |
| `PRBadge` | `src/components/github/PRBadge.tsx` | PRステータスバッジ表示 |
| `GitHubRepoSettings` | `src/app/.../settings/GitHubRepoSettings.tsx` | Space設定内リポジトリ選択 |

### Hooks

| Hook | 用途 |
|------|------|
| `useGitHubInstallation(orgId)` | 組織のGitHub連携状態 |
| `useGitHubRepositories(orgId)` | 連携可能リポジトリ一覧 |
| `useSpaceGitHubRepo(spaceId)` | Spaceの連携リポジトリ |
| `useSpacePullRequests(spaceId)` | SpaceのPR一覧 |
| `useTaskGitHubLinks(taskId)` | タスクのPRリンク |
| `useManualLinkPR()` | 手動PR紐づけ |
| `useUnlinkPR()` | PR紐づけ解除 |

## セキュリティ

- Webhook署名検証（HMAC SHA-256）
- GitHub App経由のOAuth認証
- RLSによるorg/spaceレベルのアクセス制御
- `isGitHubConfigured()` による機能フラグ（環境変数未設定時は非表示）

## 環境変数

| 変数 | 用途 |
|------|------|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App 秘密鍵 |
| `GITHUB_WEBHOOK_SECRET` | Webhook署名検証シークレット |
| `NEXT_PUBLIC_GITHUB_ENABLED` | GitHub機能の有効化フラグ |
