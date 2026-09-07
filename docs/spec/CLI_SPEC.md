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
agentpm task import [--space-id <uuid>] (--file <path> | --stdin) [--no-dry-run]
```

#### `task import` — CSV からの一括取り込み

スプレッドシートや Excel で作ったタスク一覧を CSV に書き出し、そのまま流し込む。

```bash
agentpm task import --file tasks.csv              # 確認のみ（何も作らない・既定）
agentpm task import --file tasks.csv --no-dry-run # 実際に作成
cat tasks.csv | agentpm task import --stdin --no-dry-run
```

- **既定は確認モード**。作成予定の件数・自動で作る親・スキップ・エラーを返し、DB には触らない。
- **全か無か**。1行でもエラーがあれば `--no-dry-run` でも1件も作らない。
- **同じタイトルのタスクがスペースに既にあれば作らずスキップ**（再実行しても二重に増えない）。
- **親タスクは `parent` 列にタイトルで書く**。CSV 内の行 → スペースの既存タスク → どちらにも無ければ親を自動作成（最大10段）。
- 一度に取り込めるのは **500行** まで。API キーには `bulk` 権限が必要（editor では通らない）。
- 旧 CLI(0.2.x) では `--file` が出ない。`npm i -g` で 0.3.0 以上に更新する。

**CSV の列**（1行目はヘッダー。英語キー / 日本語ラベルどちらでも可。順不同・不要な列は省略可。知らない列は無視して報告）

| 列 | 別名 | 値 | 既定 |
|----|------|----|------|
| `title` (必須) | タイトル / タスク | 文字列 | — |
| `description` | 説明 / 詳細 | 文字列（セル内改行可） | 空 |
| `status` | ステータス / 状態 | `backlog` `todo` `in_progress` `in_review` `done` `considering`（未整理 / 未着手 / 進行中 / 確認待ち / 完了 / 検討中 でも可） | `todo` |
| `ball` | ボール | `client` `internal`（相手先 / 社内） | `internal` |
| `origin` | 起案元 | `client` `internal` | `internal` |
| `client_scope` | 公開範囲 | `deliverable` `internal`（公開 / 非公開） | `internal`（相手先には見せない側に倒す） |
| `start_date` | 開始日 / 開始 | `YYYY-MM-DD` または `YYYY/M/D` | 空 |
| `due_date` | 期限 / 期日 | 同上（開始より前ならエラー） | 空 |
| `assignee` | 担当者 / 主担当 | メールアドレス または 表示名（組織メンバーに限る。同名が複数ならメールで） | 空 |
| `client_owners` | 相手先担当 | 複数可（`;` `、` `・` `/` 区切り）。`ball=client` の行では必須 | 空 |
| `internal_owners` | 社内担当 / 関係者 | 複数可 | 空 |
| `parent` | 親タスク / 大項目 | 親のタイトル | 空（最上位） |
| `priority` | 優先度 | 0〜3 | 空 |
| `milestone` | マイルストーン | スペース内のマイルストーン名（無ければエラー） | 空 |

エラーは「CSV の何行目・どの列・何が悪いか」を返す（セル内改行があっても行番号は元ファイル基準）。

### File（ファイル）

```bash
agentpm file list [--space-id <uuid>] [--limit <n>]
agentpm file upload [--space-id <uuid>] --file <path> [--name <name>] [--mime-type <type>]
```

#### `file upload` — ローカルファイルをプロジェクトにアップロード

```bash
agentpm file upload --file ./list.csv                       # ファイル名そのまま
agentpm file upload --file ./spec.pdf --name 要件定義.pdf     # TaskApp 上の名前を指定
agentpm file upload -s <space-uuid> --file ./data.tsv --json
```

- Web の「ファイル」画面と同じ 3 段階で送る: `file_upload_url`（pending 行＋署名URL） → 署名URLへ実バイトを PUT → `file_upload_complete`（Storage の実体を確認して ready）。API サーバーはバイトを中継しないため **50MB まで**送れる。
- MIME は拡張子から推定（csv/tsv/pdf/png/jpg/xlsx/docx/md/json/zip など）。`--mime-type` で上書き可。
- **ファイル名は日本語のままでよい。** 表示名(`files.name`)はそのまま保存し、Storage の保存先(`storage_path`)だけ英数字に変換する（Storage の鍵は ASCII しか受け付けず、日本語のままだと `InvalidKey` で PUT が失敗するため）。規則は Web と共通（`src/lib/files/storageKey.ts`）: 英数字と `. _ -` 以外は `_` にまとめ、拡張子は残す。
- 完了結果に `downloadPath` と、CSV/TSV なら **表ビューのパス** `tablePath`（`/{orgId}/project/{spaceId}/files/{fileId}`）が返る。
- 必要な権限: API キーの `write`（内部メンバーの鍵）。client/vendor 権限の鍵は認可(`mcp_authorize`)がファイルへの write を許可しないため **アップロード不可**。`file list` は client/vendor 鍵ではクライアント公開分と自分がアップロードした分だけ返る（Web と同じ見える範囲）。
- `file list` / 完了結果の `downloadPath` は Web（Cookie ログイン）用のパス。ブラウザに貼って使う（CLI からそのまま取得はできない）。
- API キーに利用者が紐づいていない（`user_id` が空）と `uploaded_by` を埋められず失敗する。
- **旧 CLI(0.3.x 以前)では動かない**（3 段階処理を知らないため）。`npm i -g` で 0.4.0 以上に更新する。

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
