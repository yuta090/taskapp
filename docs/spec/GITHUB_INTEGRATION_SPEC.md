# GitHub連携 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

GitHub Appを通じたPR追跡・リポジトリ連携機能。タスクとPull Requestを紐づけ、開発進捗を可視化する。

> GitHub Issues との連携（タスクへの添付・AgentPM からの Issue 作成・全部閉じたときの確認通知）は `GITHUB_ISSUES_LINK_SPEC.md`（v1.0・設計確定・未実装）を参照。既存表の読み取り権限の是正（同仕様 §11）もそちらで扱う。

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

## PRが取り込まれたときの通知（Phase 2.5）

`pull_request` webhookで `action === 'closed' && pull_request.merged === true` を受けたとき（`handlePullRequestEvent` のPR upsert後）:

1. **つなぎ漏れを拾う**: 通知の前に `linkPRToTasks`（タイトル/本文のTP-番号で紐づけ）を実行する。リポジトリをプロジェクトに結びつける前に作られたPRも、取り込み時点で拾うため。opened/editedの既存の動きは変えない。
2. **対象タスク**: そのPRに紐づく全タスク（`task_github_links`。auto/manual とも）。**statusが `done` のタスクには通知しない**。
3. **宛先**（`src/lib/github/merge-notify.ts` の `resolveMergeNotifyRecipients`、優先順）:
   1. 担当者(`tasks.assignee_id`) と社内側の責任者(`task_owners` side='internal')の和集合（org内部メンバー=owner/admin/memberのみ）
   2. 空なら `tasks.created_by`（内部メンバーなら）
   3. それも空なら `spaces.default_reviewer_ids`（内部メンバーのみ）
   4. それも空なら送らない
4. **通知**: `notifications` に `type: 'github_pr_merged'`・`channel: 'in_app'` で1行（宛先ごと）。`dedupe_key: 'github_pr_merged:<task_id>:<github_pull_requests.id>'` で二重webhookでも重複させない（`upsert` + `ignoreDuplicates`）。payloadは `task_id`・`task_title`・`title`・`message`・`link`・`pr_url`・`pr_number`・`repo_full_name`。
5. **方針の再確認**（§6 §12・Fable裁定と同じ）: この処理は**タスク行を更新しない・ボールを動かさない・お客さん/制作会社には通知しない**。あくまで社内の担当者・責任者に「知らせるだけ」。
6. 通知の失敗はログのみで、webhookの応答（PR upsert結果）には影響しない。

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
