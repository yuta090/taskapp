# Slack連携 セットアップ手順

## 1. Slack App 作成

1. https://api.slack.com/apps にアクセス
2. **Create New App** → **From scratch** を選択
3. App Name: `TaskApp`（任意）、Workspace: 連携先のワークスペースを選択

## 2. Bot Token Scopes 設定

左メニュー **OAuth & Permissions** → **Bot Token Scopes** で以下を追加:

| Scope | 用途 |
|-------|------|
| `chat:write` | メッセージ投稿 |
| `channels:read` | パブリックチャンネル一覧取得 |
| `groups:read` | プライベートチャンネル一覧取得 |

## 3. OAuth Redirect URL 設定

左メニュー **OAuth & Permissions** → **Redirect URLs** で以下を追加:

```
https://your-domain.com/api/slack/callback
```

（開発環境: `http://localhost:3000/api/slack/callback`）

## 4. Client ID / Client Secret 取得

1. 左メニュー **Basic Information**
2. **App Credentials** セクション:
   - **Client ID** をコピー
   - **Client Secret** をコピー
   - **Signing Secret** をコピー

## 5. 環境変数設定

`.env.local` に以下を追加:

```env
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_STATE_SECRET=your-random-secret-for-hmac
NEXT_PUBLIC_SLACK_ENABLED=true
```

> `SLACK_STATE_SECRET` はOAuth CSRF防止用のランダム文字列です。
> `openssl rand -hex 32` などで生成してください。

## 6. DBマイグレーション

Supabase Dashboard の SQL Editor で以下を順番に実行:

1. `supabase/migrations/20250213_000_slack_integration.sql`（テーブル作成）
2. `supabase/migrations/20250213_001_slack_oauth.sql`（OAuth対応カラム追加）

## 7. Slackワークスペースを連携

### 方法A: OAuth連携（推奨）

1. プロジェクト設定ページ（`/{orgId}/project/{spaceId}/settings`）を開く
2. **Slack連携** セクションの **「Slackと連携する」** ボタンをクリック
3. Slack認証画面で **Allow** をクリック
4. 自動でTaskAppに戻り、連携完了

### 方法B: 手動トークン入力

1. Slack App の **OAuth & Permissions** → **Install to Workspace** → **Allow**
2. 表示される **Bot User OAuth Token** (`xoxb-...`) をコピー
3. プロジェクト設定ページの Slack連携セクションで **「手動でBot Tokenを入力」** を展開
4. トークンを貼り付けて **「トークンを保存」** をクリック

## 8. Botをチャンネルに招待

投稿先のSlackチャンネルで:

```
/invite @TaskApp
```

## 9. TaskAppでチャンネルを紐付け

1. プロジェクト設定ページの **Slack連携** セクションでチャンネルを選択
2. **連携する** をクリック

## 10. 動作確認

1. タスク詳細画面を開く
2. **Slackに投稿** ボタンをクリック
3. メッセージ（任意）を入力して送信
4. Slackチャンネルにタスクカードが表示されることを確認

---

## 本番デプロイ時の追加設定

### 1. Redirect URL の追加

Slack App管理画面（https://api.slack.com/apps）で:

1. 対象Appを選択
2. **OAuth & Permissions** → **Redirect URLs**
3. 本番URLを追加: `https://your-production-domain.com/api/slack/callback`
4. **Save URLs** をクリック

> 開発用URL（`http://localhost:3000/...`）と本番URLは**両方登録したまま**でOKです。

### 2. 環境変数の確認

本番環境（Vercel / Netlify 等）に以下が設定されていること:

```
SLACK_CLIENT_ID=（開発と同じ値）
SLACK_CLIENT_SECRET=（開発と同じ値）
SLACK_SIGNING_SECRET=（開発と同じ値）
SLACK_STATE_SECRET=（開発と同じ値 or 本番専用の値）
NEXT_PUBLIC_SLACK_ENABLED=true
NEXT_PUBLIC_APP_URL=https://your-production-domain.com
```

### 3. 仕組みの概要

```
開発者（1回だけ）:
  Slack App作成 → 環境変数設定 → Redirect URL登録

各クライアント企業の管理者（組織ごとに1回）:
  設定画面「Slackと連携する」→ Slack認証で Allow → 完了
  ↓
  Bot Tokenが組織ごとにDB暗号化保存される
  以降はそのまま使える（再認証不要）
```

---

## Phase 2: スラッシュコマンド + メンション対話

### 11. 追加 Scopes 設定

左メニュー **OAuth & Permissions** → **Bot Token Scopes** で以下を追加:

| Scope | 用途 |
|-------|------|
| `app_mentions:read` | メンションイベント受信 |
| `commands` | スラッシュコマンド |
| `users:read` | ユーザー情報取得 |
| `users:read.email` | ユーザーメール取得（ユーザー照合用） |

> Scope追加後、ワークスペースへの再インストールが必要です。

### 12. Slash Commands 設定

左メニュー **Slash Commands** → **Create New Command**:

| 項目 | 値 |
|------|---|
| Command | `/taskapp` |
| Request URL | `https://your-domain.com/api/slack/commands` |
| Short Description | タスクを作成 |

### 13. Interactivity 設定

左メニュー **Interactivity & Shortcuts** → **On**:

| 項目 | 値 |
|------|---|
| Request URL | `https://your-domain.com/api/slack/interactions` |

### 14. Event Subscriptions 設定

左メニュー **Event Subscriptions** → **On**:

| 項目 | 値 |
|------|---|
| Request URL | `https://your-domain.com/api/slack/webhook` |

**Subscribe to bot events** で以下を追加:

| Event | 用途 |
|-------|------|
| `app_mention` | Botへのメンション検知（LLM対話） |

### 15. DBマイグレーション（追加分）

```
supabase/migrations/20250213_002_org_ai_config.sql
```

### 16. 環境変数（追加分）

```env
# ポータルからの内部通知用シークレット
INTERNAL_NOTIFY_SECRET=your-random-internal-secret
```

### 17. AI機能の設定（組織管理者）

1. プロジェクト設定ページ → **AI設定** セクション
2. プロバイダーを選択（OpenAI / Anthropic）
3. APIキーを入力して保存
4. モデルを選択（デフォルト: gpt-4o-mini）

### 使い方

| 操作 | 説明 |
|------|------|
| `/taskapp` | モーダルからタスク作成（タイトル・担当者・期限・説明） |
| `@TaskApp 今週の期限のタスクは？` | AIがタスク情報を基に回答 |
| 自動通知 | タスク作成・ステータス変更・ボール移動・コメント追加時にSlack通知 |

### 自動通知トグル

プロジェクト設定 → Slack連携 → 自動通知設定で、イベントごとにON/OFF可能:

| トグル | デフォルト |
|-------|---------|
| タスク作成時 | ON |
| ボール移動時 | ON |
| ステータス変更時 | ON |
| コメント追加時 | OFF |

---

## トラブルシューティング

### 「Slackと連携する」ボタンが表示されない
- `NEXT_PUBLIC_SLACK_ENABLED=true` が設定されているか確認
- `SLACK_CLIENT_ID` と `SLACK_CLIENT_SECRET` が設定されているか確認

### OAuth後にエラーが表示される
- Slack App の Redirect URL に `https://your-domain.com/api/slack/callback` が追加されているか確認
- `SLACK_STATE_SECRET` が設定されているか確認

### チャンネル一覧が表示されない
- ワークスペースが連携済みか確認（緑のバッジ表示）
- Botがワークスペースにインストールされているか確認

### 投稿に失敗する
- Botが対象チャンネルに招待されているか確認（`/invite @TaskApp`）
- `slack_message_logs` テーブルでエラー内容を確認

### 「Slackに投稿」ボタンが表示されない
- `NEXT_PUBLIC_SLACK_ENABLED=true` が設定されているか確認
- プロジェクト設定でチャンネルが紐付けられているか確認
