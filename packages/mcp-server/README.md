# @taskapp/mcp-server

TaskApp用のMCP (Model Context Protocol) サーバー。Claude DesktopやClaude CodeなどのAIツールからTaskAppを直接操作可能にします。

- 57ツール・11モジュール
- APIキーによるランタイム認証
- space/org レベルの細粒度認可
- 操作監査ログ自動記録

## 前提条件

- Node.js 18+
- Supabase プロジェクト (migration `20240207_001_mcp_authorization.sql` 適用済み)
- APIキー (`rpc_validate_api_key` で検証)

## セットアップ

```bash
cd packages/mcp-server
cp .env.example .env
# .env を編集して SUPABASE_URL, SUPABASE_SERVICE_KEY, TASKAPP_API_KEY を設定
npm install
npm run build
```

## Claude Desktop設定

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "taskapp": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://xxx.supabase.co",
        "SUPABASE_SERVICE_KEY": "eyJ...",
        "TASKAPP_API_KEY": "tsk_xxx"
      }
    }
  }
}
```

## 認証

### 本番 (推奨): APIキー認証

`TASKAPP_API_KEY` 環境変数にAPIキーを設定すると、起動時に `rpc_validate_api_key` で検証し、org/space/action スコープを自動設定します。

### 開発: 静的config

`TASKAPP_API_KEY` 未設定時は静的configにフォールバック (認可チェックなし)。

## 全ツール一覧 (57)

### タスク管理 (7), ボール (3), ミーティング (5), レビュー (5), マイルストーン (5), スペース (4), アクティビティ (3), クライアント (8), Wiki (6), 議事録 (3), スケジューリング (8)

## 開発

```bash
npm run dev      # TypeScript ウォッチモード
npm run build    # ビルド
npm test         # テスト (vitest)
```
