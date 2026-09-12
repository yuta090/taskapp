# AgentPM CLI 仕様書

## 概要

AgentPM CLI (`@uzukko/agentpm`) は、AIエージェントがAgentPMを軽量なコンテキストで操作するためのコマンドラインツール。
MCP サーバーの代替として、より少ないリソースでタスク管理操作を実行できる。

```
AI (Claude Code等) → agentpm CLI → HTTP POST /api/tools → Next.js → Supabase
```

## インストール

```bash
npm install -g @uzukko/agentpm   # Node.js 18 以上
```

- npm に公開する名前は `packages/cli/package.json` の `name`（`@uzukko/agentpm`）。画面と AI 用の説明書に出す「入れ方」の正本は `src/lib/cli-setup.ts` で、両者の一致は `src/__tests__/lib/cli-setup.test.ts` が見張る。
- 公開は `scripts/publish-cli.sh`（ユーザー本人のターミナルで。渡し方は CLAUDE.md「CLI（agentpm）を npm に公開する」）。origin/main の `packages/cli` を取り出し、`dist` を消して `tsc` で作り直してから載せる（消したソースの古い成果物を載せないため）。載せるのは `bin` と `dist` だけ。`--dry-run` で公開せずに中身を確かめられる。公開済みの版のままなら止まる。版を上げるときは `package.json` の `version` と `src/index.ts` の `CLI_VERSION` を揃える（テストで検査）。

## セットアップ

```bash
agentpm login
# API URL: 何も入れずに Enter で https://agentpm.app（0.5.0 から既定値。0.4.x 以前は手入力が必要だった）
# API Key: 画面で発行したキーを貼る（下の「APIキーの種類」）
# Default Space ID: よく使うプロジェクトのID（省略可）
```

APIキーは合鍵なので、AI のチャットに貼らせず、本人がターミナルで入力する（AI 用の説明書にもそう書いてある）。

## APIキーの種類

| 発行する画面 | 使える範囲 | 許可する操作 |
|---|---|---|
| アカウントの「設定 → APIキー」（`/settings/api-keys` → `/api/keys/user`、scope=`user`） | 選んだ複数のプロジェクト | 画面で選ぶ（既定: 読み取り） |
| プロジェクト設定の「API設定」（`ApiSettings` → `/api/keys`、scope=`space`） | そのプロジェクトだけ | 画面で選ぶ（既定: 読み取り＋書き込み） |

- どちらの鍵も「作った人」（`user_id`）の代理として動き、操作の可否はその人のプロジェクトでの役割で決まる（`mcp_authorize`）。
- **API キーは社内メンバー（admin / editor / viewer）専用**。相手先（client / vendor）の役割では発行も利用もできない。
  - 利用の拒否の正本は `mcp_authorize`（役割が後から相手先に変わった鍵も止まる）。発行側は `/api/keys/user`（社内の役割のプロジェクトだけ）・`/api/keys`（組織 owner / space admin だけ）・画面の選択肢で二重に守る。判定は `src/lib/roles/spaceRoles.ts` の `isInternalSpaceRole`（通す役割を並べる形）
  - `mcp_authorize` は鍵の持ち主（`user_id`）が作成者（`created_by`）と一致し、鍵の組織のメンバーであることも確かめる。プロジェクトの鍵は、そのプロジェクトが鍵の組織のものであることも確かめる
  - `api_keys` 表への書き込みはサーバーの窓口（service role）だけ。ブラウザ側のロールは読み取りのみ（`api_key_usage` の RLS が参照するため authenticated の SELECT は残す）
  - 将来、相手先に CLI を開くなら、ツールを利用者の JWT で実行して RLS に任せる形で行う（ツールごとの見せ分けは採らない）
- 個人用の鍵（scope=`user`）の `agentpm space list` は、選んだプロジェクトのうち今もメンバーで読めるものだけを返す（プロジェクトごとに `mcp_authorize` を通す）。個人用の鍵は組織をまたげる
- プロジェクト設定の鍵で `agentpm space list` を打つと、そのプロジェクト1件だけを返す（以前は断っていて、画面の確認手順が必ず失敗していた）。
- 権限で断られると `/api/tools` は **403 と `権限エラー: <理由>`** を返し、CLI にそのまま出る（以前は 500 "Internal server error" に化けて理由が見えなかった）。理由は `mcp_authorize` の決まった文言で、秘密は含まない。
- 両方の一覧に「許可した操作」を出す。プロジェクト設定の一覧では、持ち主が空の古い鍵に「CLI では使えない。発行し直して」と出す。アカウントの一覧では、プロジェクト設定の鍵を「〇〇のみ（プロジェクト設定で発行）」と出す（`allowed_space_ids` が空でも「全スペース」と出さない）。
- プロジェクト設定の鍵に `user_id` を記録するようになる前（〜2026-09）に作った鍵は `user_id` が空で CLI では使えなかったため、**無効化した**（`is_active=false`。利用記録を残すため削除はしない）。使う場合は発行し直してもらう。

## AI に使い方を覚えさせる（スキル）

- 説明書は `/skills/agentpm/SKILL.md`（Claude Code のスキルと同じ「<名前>/SKILL.md」の形）。中身はコマンド一覧（`src/lib/cli-manifest.ts`）から `src/lib/cli-skill.ts` が組み立てるので、コマンドを足せば説明書にも自動で載る。旧 URL `/skills/agentpm.md` も同じ中身を返す。
- パスに「.」を含むので proxy（ログインの門番）を通らず、未ログインの端末から curl で取れる。
- Claude Code: `mkdir -p ~/.claude/skills/agentpm && curl -fsSL https://agentpm.app/skills/agentpm/SKILL.md -o ~/.claude/skills/agentpm/SKILL.md` → Claude Code を開き直す。
  - ⚠ `~/.claude/skills/agentpm.md` のような1枚置きは Claude Code に読まれない（以前の案内はこれだった）。
- ほかの AI（Codex・Cursor など）: 説明書の URL を読ませる一文をチャットに貼る（画面からコピーできる）。
- 画面では、アカウントの「APIキー」とプロジェクト設定の「API設定」の両方に同じ手順（`src/components/settings/CliSetupGuide.tsx`）を出す。

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

## お知らせ

- 新しい機能や直した不具合は、コマンド一覧の更新と一緒に **「📣 AgentPM からのお知らせ」** として一度だけ表示される（`agentpm update` でも出る）。同じお知らせは二度出ない。
- `--json` を付けた実行では出ない（機械向けの出力を汚さないため）。仕様は `CLI_DYNAMIC_MANIFEST_SPEC.md` の「お知らせ」。

## コマンド一覧

### Task（タスク管理）

```bash
agentpm task list [--space-id <uuid>] [--ball <side>] [--status <status>] [--type <type>] [--client-scope <scope>] [--limit <n>] [--offset <n>]
agentpm task create --space-id <uuid> --title <title> [--description <desc>] [--status <status>] [--type <type>] [--ball <side>] [--origin <origin>] [--client-scope <scope>] [--due-date <date>] [--assignee-id <uuid>] [--milestone-id <uuid>]
agentpm task get [--space-id <uuid>] --task-id <uuid>
agentpm task update [--space-id <uuid>] --task-id <uuid> [--title <title>] [--description <desc>] [--status <status>] [--due-date <date>] [--assignee-id <uuid>] [--priority <n>] [--milestone-id <uuid>]
agentpm task delete [--space-id <uuid>] --task-id <uuid> [--no-dry-run] [--confirm-token <token>]
agentpm task list-my [--ball <side>] [--status <status>] [--client-scope <scope>] [--limit <n>] [--offset <n>]
agentpm task stale [--space-id <uuid>] [--stale-days <n>] [--ball <side>] [--limit <n>]
agentpm task import [--space-id <uuid>] (--file <path> | --stdin) [--no-dry-run]
```

`--offset` は `--limit` と組み合わせて続きから取る（ページング）用。例: `--limit 100 --offset 100` で101件目から100件。

#### `task create --status` — 最初のステータスを指定して作る

省略すると従来どおり **未着手(backlog)**（仕様タスク `--type spec` は `considering`）で作られる。
すでに動いているものを登録するときは、作成→更新の2回叩きをせずに一度で済む。

```bash
agentpm task create --title "見積もりを送る" --status in_progress
```

指定できる値は画面と同じ 6 種: `backlog` / `todo` / `in_progress` / `in_review` / `done` / `considering`。

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

### Invite（招待：社内メンバー・相手先）

```bash
agentpm invite create --email tabata@example.co.jp                 # 社内メンバー（既定）
agentpm invite create --email client@example.com --role client     # 相手先（ポータル）
agentpm invite list [--role member|client|all] [--status pending|accepted|expired|all]
agentpm invite resend --invite-id <uuid> [--expires-in-days <n>]
```

- **この経路はメールを送らない。** 返ってくる `inviteUrl` を相手に渡すか、画面の「設定 → メンバー → 保留中の招待 → 再送」から送る（送信はアプリ側の経路が持つ）。
- 同じ宛先に**有効な招待が既にあれば作り直さず期限だけ延ばす**（`reused: true`）。同じ人に複数のリンクを配らないため。
- 役割で入口が違う: 社内メンバーは `/invite/<token>`、相手先は `/portal/<token>`。
- `agentpm client invite-create --role member` でも同じことができる（既定は `client`）。

### File（ファイル）

```bash
agentpm file list [--space-id <uuid>] [--limit <n>]
agentpm file upload [--space-id <uuid>] --file <path> [--name <name>] [--mime-type <type>]
agentpm file update --file-id <uuid> --description "<何のファイルか>"   # 空文字 "" で説明を消す。--name で表示名も変更可
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
- 必要な権限: API キーの `write`。API キーは社内メンバー専用なので、相手先（client / vendor）の役割では使えない（`mcp_authorize` が断る）。`file list` の相手先向けの見せ分け（クライアント公開分と自分が上げた分だけ）は二重の守りとして残している。
- `file list` / 完了結果の `downloadPath` は Web（Cookie ログイン）用のパス。ブラウザに貼って使う（CLI からそのまま取得はできない）。
- API キーに利用者が紐づいていない（`user_id` が空）と `uploaded_by` を埋められず失敗する。
- **旧 CLI(0.3.x 以前)では動かない**（3 段階処理を知らないため）。`npm i -g` で 0.4.0 以上に更新する。

- 説明文は 1000 文字まで（`files.description` の CHECK と同じ）。一覧画面の行に出るので「何のファイルか」を1行で書く。ファイルIDは `agentpm file list` で確認する。

### Ball（ボール管理）

```bash
agentpm ball pass [--space-id <uuid>] --task-id <uuid> --ball <side> [--reason <reason>]
agentpm ball query [--space-id <uuid>] --ball <side> [--include-owners] [--limit <n>]
agentpm dashboard [--space-id <uuid>]
```

### Wiki（Markdown / HTML の転記とタスクからの参照）

```bash
agentpm wiki list [--space-id <uuid>]
agentpm wiki create --title <title> (--file <path> | --stdin | --body <text>) [--format markdown|html|blocks] [--tags <tags...>]
agentpm wiki update --page-id <id> [--title <title>] [--file <path> | --stdin | --body <text>] [--format ...] [--tags ...]
agentpm wiki update --page-id <id> [--parent-page-id <id>] [--milestone-id <id>] [--pinned | --no-pinned]
agentpm task update --task-id <uuid> --wiki-page-id <uuid>     # タスクの「仕様書連携」に Wiki を紐づける（解除は画面から）
```

- 本文は **Markdown / HTML / BlockNote JSON** のどれでも可。省略時は自動判定（JSONブロック配列→blocks、HTMLらしければ html、それ以外 markdown）。
  保存時にサーバーで画面と同じブロック形式へ変換するので、見出し・箇条書き・表・リンク・太字がそのまま Wiki で表示・編集できる。
  （以前は Markdown をそのまま保存していたため、画面では**空のページに見えていた**）
- `--file` はファイルをそのまま本文にする（BOM は除去）。`.md` / `.html` の区別は中身で自動判定するので拡張子は問わない。
- タスク側の「仕様書連携」欄に出るのは **タグ「仕様書」の付いたページ**だけ。作業成果物を紐づける用途では `--tags 仕様書` を付ける。
- 一覧での**並べ方**も CLI から変えられる。`--parent-page-id` でフォルダのように親ページの下に入れ、`--milestone-id` でマイルストーンに紐づけ、`--pinned` で一覧の先頭に固定する。
  外すときは **`none`**（`--parent-page-id none` / `--milestone-id none`）、ピン留めの解除は `--no-pinned`。
  親に自分の子孫を指定する・別スペースのページを指定するといった無理な指定は、DB 側で拒否して日本語の理由を返す。

例: 作業した md/html を Wiki に転記してタスクから参照する
```bash
PAGE=$(agentpm wiki create --title "顧客ジャーニー v1" --file 14_customer_journey_v1.md --tags 仕様書 --json | jq -r .id)
agentpm task update --task-id <タスクUUID> --wiki-page-id "$PAGE"
```

### Space / Milestone / Meeting / Review / Activity / Client / Wiki / Minutes / Scheduling

全コマンド詳細は `agentpm --help` または各サブコマンドの `--help` を参照。

### アプリの中の物へのリンク（`link`）

タスク・Wikiページ・議事録・ファイルの**一覧と詳細に `link` が入る**。画面で開くための
URL で、Wiki や議事録の本文にそのまま貼れる。詳細は `spec/DOC_LINK_SPEC.md`。

```bash
agentpm task list --json      # 各タスクに link（末尾のキー）
agentpm wiki list --json      # 各ページに link（先頭のキー）
agentpm meeting list --json   # 各会議に link
agentpm file list --json      # 各ファイルに link（= downloadPath と同じ値）
```

Markdown で `[名前](link)` と書いて `wiki create` / `wiki update` に渡す。
**`link` の値をそのまま使い、自分で URL を組み立てない**（綴りがずれると押しても開かない）。

## MCP サーバーとの関係

| | CLI | MCP Server |
|---|---|---|
| パッケージ | `@uzukko/agentpm` | `agentpm-core` |
| 接続方式 | HTTP API 経由 | Supabase 直接接続 |
| 必要な認証情報 | API Key のみ | API Key + Supabase URL + Service Role Key |
| 用途 | AIエージェント（軽量） | Claude Desktop / Cursor（段階的に廃止予定） |

MCP サーバーは段階的に廃止予定。CLI + スキルで代替する。
