# CLI Dynamic Manifest 仕様書 v1.2

> Codex Architect Review: v1.0で6件、v1.1で3件の指摘を反映済み

## 概要

AgentPM CLI のコマンド定義をサーバーから動的に取得する仕組み。
CLI本体を更新せずに、サーバー側のJSON更新だけで新コマンドの追加・変更が可能になる。

```
現状: CLI (ハードコード) → /api/tools → Supabase
将来: CLI (マニフェスト駆動) → /api/tools → Supabase
            ↑
      /api/cli/manifest から動的取得
```

## 背景・課題

| 現状 | 問題 |
|------|------|
| コマンド定義が `packages/cli/src/commands/*.ts` にハードコード | 新機能追加のたびにCLI再ビルド + `npm install -g` が必要 |
| MCP Server と CLI のツール定義が二重管理 | 同期漏れ・乖離リスク |
| MCPを段階的に廃止予定 | CLI が唯一のインターフェースになるため、運用性が重要 |

## アーキテクチャ

### 全体フロー

```
1. CLI起動
2. GET /api/cli/manifest → コマンドスキーマJSON取得 (ETag対応)
3. マニフェスト検証 (スキーマ + チェックサム + バージョン互換性)
4. Commander.js にコマンドを動的登録
5. ユーザーのコマンドを実行 → POST /api/tools (既存)
6. マニフェストをローカルにキャッシュ (atomic write)
```

### キャッシュ戦略

```
~/.agentpm/                     # ディレクトリ: 0700
  manifest.json                 # キャッシュ本体: 0600
  manifest.prev.json            # last-known-good バックアップ: 0600
  manifest.meta.json            # { fetchedAt, version, etag, checksum }
```

| 条件 | 動作 |
|------|------|
| キャッシュなし | サーバーから取得 → 検証 → atomic write で保存 |
| キャッシュあり + TTL内 (24h) | キャッシュ使用（ネットワーク不要） |
| キャッシュあり + TTL切れ | `If-None-Match: <etag>` で条件付きfetch。304ならTTL更新のみ。200なら検証→保存 |
| `agentpm update` 実行 | 強制再取得（ETag無視） |
| サーバー到達不能 + キャッシュあり | 期限切れキャッシュをfallback使用（警告表示） |
| サーバー到達不能 + キャッシュなし | ビルトインfallback使用（警告表示） |
| キャッシュ破損 (parse失敗) | `manifest.prev.json` を使用。それも失敗ならビルトイン |

### Atomic Write

```typescript
// 書き込み手順: tmp → rename (POSIX atomic)
const tmpPath = `${MANIFEST_PATH}.${process.pid}.tmp`
writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
renameSync(MANIFEST_PATH, PREV_MANIFEST_PATH)  // backup current
renameSync(tmpPath, MANIFEST_PATH)              // atomic swap
```

## マニフェストJSON スキーマ

### エンドポイント

```
GET /api/cli/manifest
Authorization: Bearer <api_key>  (任意)
If-None-Match: "<etag>"          (条件付きfetch)

Response Headers:
  Content-Type: application/json
  ETag: "<sha256-hash>"
  Cache-Control: public, max-age=86400

Response: 200 (body) or 304 (not modified)
```

### レスポンス形式

```json
{
  "version": "1.0.0",
  "minCliVersion": "0.2.0",
  "generatedAt": "2026-03-07T12:00:00Z",
  "checksum": "sha256:<hex>",
  "commands": [
    {
      "name": "task",
      "description": "Task management",
      "aliases": ["t"],
      "subcommands": [
        {
          "name": "list",
          "description": "List tasks",
          "aliases": ["ls"],
          "tool": "task_list",
          "examples": [
            "agentpm task list --ball client",
            "agentpm task list --status in_progress --limit 10"
          ],
          "options": [
            {
              "flags": "-s, --space-id <uuid>",
              "description": "Space UUID",
              "param": "spaceId",
              "resolve": "spaceId"
            },
            {
              "flags": "--ball <side>",
              "description": "Filter by ball owner",
              "param": "ball",
              "choices": ["client", "internal"]
            },
            {
              "flags": "--status <status>",
              "description": "Filter by status",
              "param": "status",
              "choices": ["backlog", "todo", "in_progress", "in_review", "done", "considering"]
            },
            {
              "flags": "--limit <n>",
              "description": "Max results",
              "param": "limit",
              "type": "int",
              "default": "50"
            }
          ]
        },
        {
          "name": "create",
          "description": "Create a task",
          "tool": "task_create",
          "options": [
            {
              "flags": "-s, --space-id <uuid>",
              "param": "spaceId",
              "resolve": "spaceId"
            },
            {
              "flags": "--title <title>",
              "description": "Task title",
              "param": "title",
              "required": true
            },
            {
              "flags": "--description <desc>",
              "description": "Task description",
              "param": "description"
            },
            {
              "flags": "--type <type>",
              "description": "Task type",
              "param": "type",
              "choices": ["task", "spec"],
              "default": "task"
            },
            {
              "flags": "--ball <side>",
              "param": "ball",
              "choices": ["client", "internal"],
              "default": "internal"
            },
            {
              "flags": "--due-date <date>",
              "description": "Due date (YYYY-MM-DD)",
              "param": "dueDate"
            },
            {
              "flags": "--estimated-cost <yen>",
              "description": "Estimated cost in JPY",
              "param": "estimatedCost",
              "type": "int"
            },
            {
              "flags": "--client-owner-ids <ids...>",
              "description": "Client owner UUIDs",
              "param": "clientOwnerIds",
              "type": "string[]"
            }
          ]
        },
        {
          "name": "delete",
          "description": "Delete a task (dry-run by default)",
          "tool": "task_delete",
          "deprecated": false,
          "options": [
            {
              "flags": "-s, --space-id <uuid>",
              "param": "spaceId",
              "resolve": "spaceId"
            },
            {
              "flags": "--task-id <uuid>",
              "param": "taskId",
              "required": true
            },
            {
              "flags": "--no-dry-run",
              "description": "Actually delete",
              "param": "dryRun",
              "type": "negatable"
            },
            {
              "flags": "--confirm-token <token>",
              "description": "Confirmation token from dry-run",
              "param": "confirmToken",
              "dependsOn": "no-dry-run"
            }
          ]
        }
      ]
    },
    {
      "name": "ball",
      "description": "Ball ownership management",
      "aliases": ["b"],
      "subcommands": [
        {
          "name": "pass",
          "description": "Pass ball to other side",
          "tool": "ball_pass",
          "options": [
            {
              "flags": "-s, --space-id <uuid>",
              "param": "spaceId",
              "resolve": "spaceId"
            },
            {
              "flags": "--task-id <uuid>",
              "param": "taskId",
              "required": true
            },
            {
              "flags": "--ball <side>",
              "description": "Target side",
              "param": "ball",
              "required": true,
              "choices": ["client", "internal"]
            },
            {
              "flags": "--reason <reason>",
              "description": "Reason for passing",
              "param": "reason"
            }
          ]
        }
      ]
    }
  ]
}
```

### Command フィールド定義

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | string | Yes | コマンド名 (`/^[a-z][a-z0-9-]*$/`) |
| `description` | string | Yes | ヘルプテキスト（制御文字禁止） |
| `aliases` | string[] | No | エイリアス (`["t"]`, `["ls"]`) |
| `subcommands` | array | Yes | サブコマンド定義 |

### Subcommand フィールド定義

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | string | Yes | サブコマンド名 (`/^[a-z][a-z0-9-]*$/`) |
| `description` | string | Yes | ヘルプテキスト（制御文字禁止） |
| `aliases` | string[] | No | エイリアス |
| `tool` | string | Yes | APIツール名（許可リスト照合） |
| `examples` | string[] | No | 使用例（`--help` 表示用） |
| `deprecated` | boolean | No | 非推奨マーク（true: 警告表示） |
| `hidden` | boolean | No | `--help` から隠す |
| `options` | array | Yes | オプション定義 |

### Option フィールド定義

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `flags` | string | Yes | Commander.js 形式 (`/^(-[a-zA-Z],\s)?--[a-z][a-z0-9-]*(\s<[^>]+>)?$/`) |
| `description` | string | No | ヘルプテキスト（制御文字禁止） |
| `param` | string | Yes | API パラメータ名 (`/^[a-zA-Z][a-zA-Z0-9]*$/`) |
| `required` | boolean | No | 必須オプション（デフォルト: false） |
| `default` | string | No | デフォルト値 |
| `type` | string | No | 型変換（下表参照） |
| `choices` | string[] | No | 許可値リスト（Commander `.choices()` にマップ） |
| `resolve` | string | No | 特殊解決: `spaceId` → resolveSpaceId() 適用 |
| `dependsOn` | string | No | 依存オプション名（指定時のみ有効） |
| `conflictsWith` | string | No | 排他オプション名（同時指定不可） |

### type による自動変換

| type | 変換処理 |
|------|---------|
| `int` | `parseInt(value)` — NaN時エラー |
| `float` | `parseFloat(value)` — NaN時エラー |
| `bool` | `value === 'true'` |
| `json` | `JSON.parse(value)` — parse失敗時エラー |
| `string[]` | Commander variadic (`<items...>`) |
| `negatable` | Commander `--no-xxx` パターン（boolean反転） |
| (未指定) | そのまま string |

## マニフェスト検証

### サーバー側（生成時）

```typescript
// 生成時に自動チェック
function validateManifest(manifest: Manifest): void {
  // 1. ツール名ホワイトリスト照合
  const allowedTools = await getRegisteredToolNames()  // dispatchTool の登録一覧
  for (const cmd of manifest.commands) {
    for (const sub of cmd.subcommands) {
      if (!allowedTools.includes(sub.tool)) {
        throw new Error(`Unknown tool: ${sub.tool}`)
      }
    }
  }

  // 2. コマンド名・パラメータ名のフォーマット検証
  //    - name: /^[a-z][a-z0-9-]*$/
  //    - param: /^[a-zA-Z][a-zA-Z0-9]*$/
  //    - flags: Commander形式のみ許可

  // 3. 表示文字列のサニタイズ（制御文字・ANSIエスケープ除去）
  //    - description, examples 内の \x00-\x1f, \x7f, \x1b[... を除去

  // 4. checksum 生成
  manifest.checksum = `sha256:${sha256(JSON.stringify(manifest.commands))}`
}
```

### CLI側（受信時）

```typescript
function validateReceivedManifest(manifest: unknown): Manifest {
  // 1. JSONスキーマ検証（必須フィールド、型チェック）
  // 2. checksum 検証: commands部分のSHA-256が一致するか（破損検知用）
  // 3. バージョン互換性チェック（後述。失敗時はnullを返しビルトインfallbackへ）
  // 4. ツール名フォーマット検証: /^[a-z][a-z_]*$/ のみ許可
  // 5. flags フォーマット検証: Commander形式のみ許可
  // 6. 表示文字列サニタイズ: ANSI/制御文字を除去
  // 検証失敗 → fallback (prev cache or builtin)
}
```

## バージョン互換性

```json
{
  "version": "1.0.0",
  "minCliVersion": "0.2.0"
}
```

### 互換性チェックフロー

```
CLI version >= minCliVersion ?
  ├─ Yes → マニフェスト適用
  └─ No → 常にビルトインfallback使用
           + 警告: "CLI v{current} は古いです。npm update -g @uzukko/agentpm でアップデートしてください"
           (キャッシュ済みマニフェストも使用しない — 互換性が保証できないため)
```

**決定的ルール**: CLI < minCliVersion の場合、サーバー取得・キャッシュ・期限切れキャッシュを問わず **一律ビルトインfallback** を使用する。キャッシュに互換マニフェストが残っていても無視する（minCliVersionが上がった = スキーマ破壊的変更のため）。
- 明示的なアップグレードメッセージを表示
- マニフェストスキーマの破壊的変更時のみ minCliVersion を上げる

## CLI 側の実装

### 動的コマンド登録エンジン

```typescript
// packages/cli/src/dynamic-loader.ts

function registerDynamicCommands(program: Command, manifest: Manifest): void {
  for (const cmd of manifest.commands) {
    const group = program.command(cmd.name).description(sanitize(cmd.description))

    // エイリアス登録
    if (cmd.aliases) {
      for (const alias of cmd.aliases) group.alias(alias)
    }

    for (const sub of cmd.subcommands) {
      // 非推奨チェック
      if (sub.deprecated) {
        // 実行時に警告表示するが動作はする
      }

      const subCmd = group.command(sub.name).description(sanitize(sub.description))

      if (sub.aliases) {
        for (const alias of sub.aliases) subCmd.alias(alias)
      }
      if (sub.hidden) subCmd.hideHelp()
      if (sub.examples?.length) {
        subCmd.addHelpText('after', '\nExamples:\n' + sub.examples.map(e => `  $ ${e}`).join('\n'))
      }

      // オプション登録
      for (const opt of sub.options) {
        if (opt.required) {
          const o = subCmd.requiredOption(opt.flags, sanitize(opt.description || ''))
          if (opt.choices) o.choices(opt.choices)
        } else if (opt.default !== undefined) {
          const o = subCmd.option(opt.flags, sanitize(opt.description || ''), opt.default)
          if (opt.choices) o.choices(opt.choices)
        } else {
          const o = subCmd.option(opt.flags, sanitize(opt.description || ''))
          if (opt.choices) o.choices(opt.choices)
        }
      }

      // アクション (conflictsWith / dependsOn 検証 + API呼び出し)
      subCmd.action(async (opts) => {
        // dependsOn チェック: 依存オプションが存在しない場合エラー
        for (const opt of sub.options) {
          if (!opt.dependsOn) continue
          const depKey = camelCase(opt.dependsOn)
          const selfKey = camelCase(extractLongFlag(opt.flags))
          if (opts[selfKey] !== undefined && opts[depKey] === undefined) {
            outputError(
              new Error(`--${extractLongFlag(opt.flags)} requires --${opt.dependsOn}`),
              program.opts().json
            )
            return
          }
        }

        // conflictsWith チェック: 排他オプション同時指定時エラー
        for (const opt of sub.options) {
          if (!opt.conflictsWith) continue
          const selfKey = camelCase(extractLongFlag(opt.flags))
          const conflictKey = camelCase(opt.conflictsWith)
          if (opts[selfKey] !== undefined && opts[conflictKey] !== undefined) {
            outputError(
              new Error(`--${extractLongFlag(opt.flags)} conflicts with --${opt.conflictsWith}`),
              program.opts().json
            )
            return
          }
        }
        if (sub.deprecated) {
          console.error(chalk.yellow(`Warning: "${cmd.name} ${sub.name}" is deprecated`))
        }
        try {
          const params = buildParams(sub.options, opts)
          const result = await callTool(sub.tool, params)
          output(result, program.opts().json)
        } catch (e) {
          outputError(e, program.opts().json)
        }
      })
    }
  }
}

// 表示文字列からANSI/制御文字を除去
function sanitize(str: string): string {
  return str.replace(/[\x00-\x1f\x7f]|\x1b\[[0-9;]*[a-zA-Z]/g, '')
}
```

### キャッシュマネージャ

```typescript
// packages/cli/src/manifest-cache.ts

const CACHE_DIR = join(homedir(), '.agentpm')
const MANIFEST_PATH = join(CACHE_DIR, 'manifest.json')
const PREV_PATH = join(CACHE_DIR, 'manifest.prev.json')
const META_PATH = join(CACHE_DIR, 'manifest.meta.json')
const TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

async function loadManifest(apiUrl: string, apiKey?: string): Promise<Manifest> {
  // 1. Check cache (TTL内ならネットワーク不要)
  const meta = readMeta()
  if (meta && isFresh(meta)) {
    const cached = readAndValidateCache(MANIFEST_PATH)
    if (cached) return cached
  }

  // 2. Fetch from server (ETag条件付き)
  try {
    const { manifest, notModified } = await fetchManifest(apiUrl, apiKey, meta?.etag)

    if (notModified) {
      // 304: TTLだけ更新
      updateMetaTTL()
      return readAndValidateCache(MANIFEST_PATH)!
    }

    // 200: 検証 → atomic write
    const validated = validateReceivedManifest(manifest)
    atomicSaveCache(validated)
    return validated
  } catch (err) {
    // 3. Fallback: 期限切れキャッシュ
    const expired = readAndValidateCache(MANIFEST_PATH)
    if (expired) {
      console.error(chalk.yellow('Warning: Using cached manifest (server unreachable)'))
      return expired
    }

    // 4. Fallback: prev backup
    const prev = readAndValidateCache(PREV_PATH)
    if (prev) {
      console.error(chalk.yellow('Warning: Using previous manifest (cache corrupted)'))
      return prev
    }

    // 5. Fallback: builtin
    console.error(chalk.yellow('Warning: Using builtin commands (no manifest available)'))
    return BUILTIN_MANIFEST
  }
}

function readAndValidateCache(path: string): Manifest | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return validateReceivedManifest(parsed)
  } catch {
    return null  // 破損 or 検証失敗
  }
}

function atomicSaveCache(manifest: Manifest): void {
  mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 })
  const tmpPath = `${MANIFEST_PATH}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  // backup current → prev
  try { renameSync(MANIFEST_PATH, PREV_PATH) } catch { /* first run */ }
  // atomic swap
  renameSync(tmpPath, MANIFEST_PATH)
}

async function fetchManifest(
  apiUrl: string,
  apiKey?: string,
  etag?: string
): Promise<{ manifest?: unknown; notModified: boolean }> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  if (etag) headers['If-None-Match'] = etag

  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/cli/manifest`, { headers })

  if (res.status === 304) return { notModified: true }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const manifest = await res.json()
  const newEtag = res.headers.get('etag') || undefined
  saveMeta({ etag: newEtag })

  return { manifest, notModified: false }
}
```

### 新しいエントリーポイント

```typescript
// packages/cli/src/index.ts (改修後)

const program = new Command()
program
  .name('agentpm')
  .version('0.2.0')
  .option('--json', 'Output raw JSON')
  .option('-s, --space-id <uuid>', 'Override default space ID')
  .option('--api-key <key>', 'Override API key')

// config/login は常にビルトイン（認証前に必要）
registerConfigCommand(program)

// update コマンド追加
program
  .command('update')
  .description('Fetch latest command manifest from server')
  .action(async () => {
    const manifest = await fetchManifest(apiUrl, apiKey)  // ETag無視で強制取得
    const validated = validateReceivedManifest(manifest)
    atomicSaveCache(validated)
    console.log(chalk.green(`Updated to manifest v${validated.version}`))
  })

// 動的コマンド登録
const manifest = await loadManifest(apiUrl, apiKey)

// バージョン互換性チェック
if (!satisfiesVersion(CLI_VERSION, manifest.minCliVersion)) {
  console.error(chalk.yellow(
    `Warning: CLI v${CLI_VERSION} は古いです。` +
    `npm update -g @uzukko/agentpm でアップデートしてください`
  ))
  // ビルトインfallbackを使用
  registerDynamicCommands(program, BUILTIN_MANIFEST)
} else {
  registerDynamicCommands(program, manifest)
}

program.parseAsync()
```

## サーバー側の実装

### マニフェスト生成

```
src/app/api/cli/manifest/route.ts    # GET エンドポイント (ETag + Cache-Control)
src/lib/cli-manifest.ts              # マニフェストJSON定義 + 検証
```

### エンドポイント実装

```typescript
// src/app/api/cli/manifest/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getManifest } from '@/lib/cli-manifest'
import { createHash } from 'crypto'

export async function GET(request: NextRequest) {
  const manifest = getManifest()
  const body = JSON.stringify(manifest)
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`

  // 条件付きリクエスト対応
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } })
  }

  return NextResponse.json(manifest, {
    headers: {
      ETag: etag,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
```

### マニフェストの管理方法

**Phase 1**: TypeScript定数としてサーバーコードに定義（デプロイで更新）

**Phase 2**: Supabase テーブルに保存（管理画面から更新）

```sql
-- Phase 2 用テーブル
CREATE TABLE cli_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  manifest jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',  -- draft | published | archived
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 公開済みは1つだけ
CREATE UNIQUE INDEX idx_cli_manifest_published
  ON cli_manifest (status) WHERE status = 'published';
```

### Phase 2 ガバナンスフロー

```
draft → validate → preview → publish → (rollback可)
```

| ステップ | 説明 |
|---------|------|
| **draft** | 管理画面で編集。保存のたびにJSONスキーマ自動検証 |
| **validate** | ツール名ホワイトリスト照合 + 既存CLIとの互換性チェック |
| **preview** | `agentpm update --preview` で取得可能（本番には影響なし） |
| **publish** | 現在の published を archived に変更 → 新版を published に |
| **rollback** | 直前の archived を published に戻す（1クリック） |

## MCP → CLI 移行ロードマップ

```
Phase 1 (現在): MCP + CLI 並行運用
  └─ CLI はハードコード、MCP は直接DB接続

Phase 2: CLI Dynamic Manifest 導入
  └─ CLI がマニフェスト駆動に切り替え
  └─ 新機能は CLI のみで追加（MCP には追加しない）

Phase 3: MCP 非推奨化
  └─ MCP の README に deprecation notice
  └─ Claude Desktop / Cursor ユーザーに CLI 移行案内

Phase 4: MCP 廃止
  └─ agentpm-core パッケージをアーカイブ
  └─ /api/tools エンドポイントが唯一のバックエンド
```

## セキュリティ

| 脅威 | 対策 |
|------|------|
| マニフェスト改ざん (MITM) | HTTPS必須 + ETagによる整合性チェック |
| マニフェスト破損検知 | `checksum` フィールドでcommands部分のSHA-256検証（注: 破損検知のみ。サーバー侵害には対応しない。将来的に署名検証を検討） |
| ツール名インジェクション | CLI側: `/^[a-z][a-z_]*$/` のみ許可。サーバー側: `dispatchTool` 内の登録済みツール名ホワイトリスト |
| ANSIエスケープ注入 | `name`, `description`, `examples` の制御文字・ANSIシーケンスを除去 |
| フラグインジェクション | `flags` を正規表現 `/^(-[a-zA-Z],\s)?--[a-z][a-z0-9-]*(\s<[^>]+>)?$/` で検証 |
| キャッシュ汚染 | atomic write + parse/validate on read + last-known-good backup |
| ローカルキャッシュ漏洩 | `~/.agentpm/` ディレクトリ 0700、ファイル 0600 |
| Phase 2: 管理画面誤操作 | draft→validate→publish フロー + 1クリックrollback + 操作ログ |

## コマンド一覧（マニフェスト化対象）

| コマンド | ツール名 | エイリアス | 現状 |
|---------|---------|-----------|------|
| `task list` | `task_list` | `t ls` | ハードコード済 |
| `task create` | `task_create` | | ハードコード済 |
| `task get` | `task_get` | | ハードコード済 |
| `task update` | `task_update` | | ハードコード済 |
| `task delete` | `task_delete` | | ハードコード済 |
| `task list-my` | `task_list_my` | | ハードコード済 |
| `task stale` | `task_stale` | | ハードコード済 |
| `ball pass` | `ball_pass` | `b` | ハードコード済 |
| `ball query` | `ball_query` | | ハードコード済 |
| `dashboard` | `dashboard_get` | | ハードコード済 |
| `meeting *` | `meeting_*` | `m` | ハードコード済 |
| `review *` | `review_*` | `r` | ハードコード済 |
| `milestone *` | `milestone_*` | `ms` | ハードコード済 |
| `space *` | `space_*` | `sp` | ハードコード済 |
| `activity *` | `activity_*` | `act` | ハードコード済 |
| `client *` | `client_*` | | ハードコード済 |
| `wiki *` | `wiki_*` | `w` | ハードコード済 |
| `minutes *` | `minutes_*` | `min` | ハードコード済 |
| `scheduling *` | `scheduling_*` | `sch` | ハードコード済 |
| (新規) `estimate send` | `estimate_send` | | マニフェスト追加のみ |

## ファイル構成

```
packages/cli/src/
  index.ts                  # エントリーポイント（改修）
  dynamic-loader.ts         # NEW: マニフェスト→Commander変換 + サニタイズ
  manifest-cache.ts         # NEW: キャッシュ管理 (ETag, atomic write, fallback chain)
  manifest-validator.ts     # NEW: スキーマ検証 + チェックサム照合
  builtin-manifest.ts       # NEW: フォールバック用ビルトイン定義
  api-client.ts             # 既存（変更なし）
  config.ts                 # 既存（変更なし）
  output.ts                 # 既存（変更なし）
  commands/
    config-cmd.ts           # 常にビルトイン（認証前に必要）
    *.ts                    # Phase完了後に削除可能

src/app/api/cli/manifest/
  route.ts                  # NEW: GET エンドポイント (ETag + 304)

src/lib/
  cli-manifest.ts           # NEW: マニフェスト定義 + サーバー側検証
```

## 工数見積もり

| Phase | 内容 | 工数 |
|-------|------|------|
| Phase 1 MVP | マニフェスト定義 + エンドポイント + CLI動的ローダー + キャッシュ + 検証 | Medium (1-2d) |
| Phase 2 管理画面 | DB保存 + admin UI + ガバナンスフロー | Large (3d+) |
