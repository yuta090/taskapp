# タスクエクスポート & APIキー & MCPツール 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 1. タスクCSVエクスポート

### API

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/export/tasks?spaceId=xxx&orgId=xxx` | タスク一覧をCSVダウンロード |

### CSV仕様

| ヘッダー | フィールド |
|---------|---------|
| ID | `id` |
| タイトル | `title` |
| 説明 | `description` |
| タイプ | `type` |
| ステータス | `status` |
| 優先度 | `priority` |
| 期限 | `due_date` |
| ボール | `ball` |
| 起案元 | `origin` |
| 担当者 | `assignee` |
| マイルストーン | `milestone` |
| 仕様パス | `spec_path` |
| 決定状態 | `decision_state` |
| 作成日時 | `created_at` |
| 更新日時 | `updated_at` |

### セキュリティ

- UUID形式バリデーション
- CSV formula injection対策（`=`, `+`, `-`, `@`, `\t`, `\r` で始まるセルを無害化）
- 認証必須（Supabase auth）

### UI

プロジェクト設定 > `ExportSettings` からダウンロード可能。

## 2. APIキー管理

### API

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/keys` | APIキー一覧取得 |
| POST | `/api/keys` | APIキー作成 |
| DELETE | `/api/keys` | APIキー削除 |
| GET | `/api/keys/user` | ユーザーのAPIキー取得 |

### レート制限

- IPベース: 15分間に20リクエストまで
- `src/lib/rate-limit.ts` によるインメモリ・スライディングウィンドウ方式
- 定期クリーンアップ（5分ごと）でメモリリーク防止

### UI

- `/settings/api-keys` — ユーザー設定内APIキー管理
- `/admin/api-keys` — 管理パネル内全キー管理

## 3. MCPツールAPI

### API

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/tools` | Claude Code等のMCPツールからのタスク操作 |

### 認証

- Bearer Token認証（APIキーを使用）
- `Authorization: Bearer <api_key>` ヘッダー必須

### 仕様

詳細は `docs/spec/MCP_TOOL_GOVERNANCE.md` を参照。
4ティアのアクセス制御モデル（Tier 1: 読み取り〜Tier 4: 管理操作）。
