# AgentPM CLI 仕様書

## 概要

AgentPM CLI (`@uzukko/agentpm`) は、AIエージェントがAgentPMを軽量なコンテキストで操作するためのコマンドラインツール。
MCP サーバーの代替として、より少ないリソースでタスク管理操作を実行できる。

```
AI (Claude Code等) → agentpm CLI → HTTP POST /api/tools → Next.js → Supabase
```

## インストール

```bash
npm install -g @uzukko/agentpm
```

## セットアップ

```bash
agentpm login
# API Key を入力（Settings → APIキー管理 で発行）
# API URL はデフォルトで https://agentpm.app
```

## 設定

`~/.taskapprc.json` に保存:

```json
{
  "apiKey": "tsk_...",
  "apiUrl": "https://agentpm.app",
  "defaultSpaceId": "省略可"
}
```

### 優先順位

CLIフラグ > 環境変数 > 設定ファイル > デフォルト値

| 環境変数 | 説明 |
|----------|------|
| `TASKAPP_API_KEY` | API Key |
| `TASKAPP_API_URL` | API URL (デフォルト: https://agentpm.app) |
| `TASKAPP_SPACE_ID` | デフォルト Space ID |

## グローバルオプション

| オプション | 説明 |
|-----------|------|
| `--json` | JSON で出力 |
| `-s, --space-id <uuid>` | Space ID を上書き |
| `--api-key <key>` | API Key を上書き |

## コマンド一覧

### Task（タスク管理）

```bash
agentpm task list [--space-id <uuid>] [--ball <side>] [--status <status>] [--type <type>] [--client-scope <scope>] [--limit <n>]
agentpm task create --space-id <uuid> --title <title> [--description <desc>] [--type <type>] [--ball <side>] [--origin <origin>] [--client-scope <scope>] [--due-date <date>] [--assignee-id <uuid>] [--milestone-id <uuid>]
agentpm task get [--space-id <uuid>] --task-id <uuid>
agentpm task update [--space-id <uuid>] --task-id <uuid> [--title <title>] [--description <desc>] [--status <status>] [--due-date <date>] [--assignee-id <uuid>] [--priority <n>] [--milestone-id <uuid>]
agentpm task delete [--space-id <uuid>] --task-id <uuid> [--no-dry-run] [--confirm-token <token>]
agentpm task list-my [--ball <side>] [--status <status>] [--client-scope <scope>] [--limit <n>]
agentpm task stale [--space-id <uuid>] [--stale-days <n>] [--ball <side>] [--limit <n>]
```

### Ball（ボール管理）

```bash
agentpm ball pass [--space-id <uuid>] --task-id <uuid> --ball <side> [--reason <reason>]
agentpm ball query [--space-id <uuid>] --ball <side> [--include-owners] [--limit <n>]
agentpm dashboard [--space-id <uuid>]
```

### Space / Milestone / Meeting / Review / Activity / Client / Wiki / Minutes / Scheduling

全コマンド詳細は `agentpm --help` または各サブコマンドの `--help` を参照。

## MCP サーバーとの関係

| | CLI | MCP Server |
|---|---|---|
| パッケージ | `@uzukko/agentpm` | `agentpm-core` |
| 接続方式 | HTTP API 経由 | Supabase 直接接続 |
| 必要な認証情報 | API Key のみ | API Key + Supabase URL + Service Role Key |
| 用途 | AIエージェント（軽量） | Claude Desktop / Cursor（段階的に廃止予定） |

MCP サーバーは段階的に廃止予定。CLI + スキルで代替する。
