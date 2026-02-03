# @taskapp/mcp-server

TaskApp用のMCP (Model Context Protocol) サーバー。Claude CodeなどのAIツールからTaskAppを直接操作可能にします。

## インストール

```bash
cd packages/mcp-server
npm install
npm run build
```

## 環境変数

```bash
# 必須
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# オプション（デフォルト値あり）
TASKAPP_ORG_ID=00000000-0000-0000-0000-000000000001
TASKAPP_SPACE_ID=00000000-0000-0000-0000-000000000010
TASKAPP_ACTOR_ID=00000000-0000-0000-0000-000000000099
```

## Claude Code設定

`~/.claude/mcp.json` に以下を追加:

```json
{
  "mcpServers": {
    "taskapp": {
      "command": "node",
      "args": ["/path/to/taskapp/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_KEY": "your-service-role-key",
        "TASKAPP_SPACE_ID": "your-space-id"
      }
    }
  }
}
```

## 利用可能なツール

### タスク管理

| ツール | 説明 |
|--------|------|
| `task_create` | タスク作成（spec対応、オーナー設定） |
| `task_update` | タスク更新 |
| `task_list` | タスク一覧（フィルタ対応） |
| `task_get` | タスク詳細+担当者取得 |

### ボール管理

| ツール | 説明 |
|--------|------|
| `ball_pass` | ボール所有権移動 |
| `ball_query` | ボール側でフィルタ取得 |
| `dashboard_get` | ダッシュボード統計 |

### ミーティング

| ツール | 説明 |
|--------|------|
| `meeting_create` | 会議作成 |
| `meeting_start` | 会議開始 |
| `meeting_end` | 会議終了（サマリー自動生成） |
| `meeting_list` | 会議一覧 |
| `meeting_get` | 会議詳細+参加者 |

### レビュー

| ツール | 説明 |
|--------|------|
| `review_open` | レビュー開始 |
| `review_approve` | レビュー承認 |
| `review_block` | レビューブロック |
| `review_list` | レビュー一覧 |
| `review_get` | レビュー詳細+承認状態 |

## 使用例

### タスク作成
```
「TaskAppで新しいタスクを作成して。タイトルは'ログイン機能実装'、ボールは社内」
```

### ボール移動
```
「タスクID xxx のボールをクライアントに移動して。理由は'確認依頼'」
```

### ダッシュボード確認
```
「現在のプロジェクト状況を教えて」
```

## 開発

```bash
# 開発モード（ウォッチ）
npm run dev

# ビルド
npm run build

# テスト
npm test
```

## アーキテクチャ

```
src/
├── index.ts          # エントリーポイント
├── server.ts         # MCPサーバー設定
├── config.ts         # 環境設定
├── tools/
│   ├── index.ts      # ツール登録
│   ├── tasks.ts      # タスクCRUD
│   ├── ball.ts       # ボール管理
│   ├── meetings.ts   # ミーティング
│   └── reviews.ts    # レビュー
└── supabase/
    └── client.ts     # Supabaseクライアント
```
