# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskApp is a client-facing project management system with "ball ownership" concept (who needs to act next). Built with Next.js 16 (App Router) + Supabase.

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # Run ESLint
```

## Specifications

**See `docs/SPEC_INDEX.md` for the complete specification index.**

### Current Versions

| Spec | Version | Path |
|------|---------|------|
| API | v0.4 | `docs/api/API_SPEC_v0.4.md` |
| DDL | v0.3〜v0.6 | `docs/db/DDL_v0.3.sql` 〜 `DDL_v0.6_subtasks.sql` |
| UI Rules | current | `docs/spec/UI_RULES_AND_SCREENS.md` |
| Review Spec | current | `docs/spec/REVIEW_SPEC.md` |
| MCP Governance | v1.0 | `docs/spec/MCP_TOOL_GOVERNANCE.md` |
| Subtask | v1.0 | `docs/spec/SUBTASK_HIERARCHY_SPEC.md` |

## UI Rules (Violations = Bugs)

- **3-pane fixed layout**: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]
- **Inspector never overlays** - must resize Main pane
- **Amber-500** indicates client-visible elements
- **Optimistic updates** required - no save buttons
- **No modal dialogs** for task details

## Data Model

```
ball = 'client' | 'internal'     # who needs to act next
origin = 'client' | 'internal'   # who initiated
type = 'task' | 'spec'           # spec requires spec_path + decision_state
```

## Key Files

```
src/
├── app/
│   ├── (internal)/[orgId]/project/[spaceId]/  # Tasks, Meetings
│   │   └── views/
│   │       ├── gantt/                         # ガントチャート
│   │       └── burndown/                      # バーンダウンチャート
│   ├── api/burndown/route.ts                  # バーンダウン集計API
│   └── portal/[token]/                        # Client portal
├── components/
│   ├── task/          # TaskRow, TaskInspector, TaskCreateSheet
│   ├── meeting/       # MeetingRow, MeetingInspector
│   ├── notification/  # NotificationInspector (タイプ別アクションパネル)
│   ├── burndown/      # BurndownChart, BurndownControls, BurndownTooltip
│   └── shared/        # ViewsTabNav (Gantt↔Burndown切替)
├── lib/
│   ├── supabase/rpc.ts    # RPC wrappers
│   ├── hooks/             # useTasks, useMeetings, useBurndown, etc.
│   ├── notifications/     # classify.ts (通知分類), types.ts
│   ├── burndown/          # computeBurndown (集計ロジック), constants
│   └── minutes-parser.ts  # AT-005 議事録パーサー
└── types/database.ts      # Type definitions
```

## Date Handling (重要)

**`toISOString()` は使用禁止** - UTC変換により日本時間で1日ずれる

```typescript
// NG: タイムゾーンずれ
const dateStr = date.toISOString().split('T')[0]

// OK: ローカルタイムゾーン維持
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
const dateStr = formatDateToLocalString(date)
```

## Git Branch Rules (厳守)

- **`main` への直接プッシュは禁止** — いかなる場合もプルリクエスト経由のみ
- **`develop` への直接プッシュ・PRは問題ない** — 通常の作業ブランチとして使用
- **`develop` → `main`** はプルリクエスト必須（直接マージ禁止）
- **デフォルトのプッシュ先は `develop`** — 「プッシュして」と言われたら `develop` にプッシュする
- **デフォルトのPR先は `develop`** — 「PRを作って」と言われたら `--base develop` でPRを作成する
- `main` へのPRは明示的に指示された場合のみ

```
feature branch → (push/PR) → develop → (PR) → main
```

## 並行作業は worktree で分離（厳守）

このリポジトリでは**複数の作業ストリームが同時並行で進む**ことを前提とする（例: 機能開発とセキュリティ/RLS対応が同時に走る）。同一の作業ディレクトリ・同一ブランチを共有すると、**別ストリームのコミットが自分のフィーチャーブランチに差し込まれてPRが混在する**（過去に RLS Stage1・notify-approval Stage2 が機能PRへ混入）。これを防ぐため、**独立したストリームは必ず別の git worktree ＋ 別ブランチで作業する**。

- **1ストリーム = 1 worktree = 1ブランチ = 1 PR**。ストリームをまたいでコミットしない。
- **ブランチ命名**: 機能=`feat/*` / セキュリティ=`security/*`（RLSは`security/rls-*`）/ 修正=`fix/*`。いずれも `develop` 起点・`develop` 宛てPR。
- **worktree の作成**:
  ```bash
  # セキュリティ作業を隔離する例（メイン作業ディレクトリはそのまま機能開発に使える）
  git worktree add -b security/<topic> ../taskapp-wt-<topic> origin/develop
  git -C ../taskapp-wt-<topic> <commit/push など>   # cd せず -C で操作すると安全
  ```
  worktree はリポジトリの**兄弟ディレクトリ** `../taskapp-wt-<topic>` に置く（リポジトリ内には作らない）。
- **後片付け**: マージ後に `git worktree remove ../taskapp-wt-<topic>` で削除。放置しない。
- **混在してしまった場合**: 別ストリームのコミットは `git worktree add` した専用ブランチへ `cherry-pick` して独立PR化し、自分のブランチは `git rebase --onto <直前> <混入コミット> <自分のブランチ>` で除去 → `git push --force-with-lease`（並行作業を巻き込まないため `--force` 単体は使わない）。

### 命名の衝突回避（migration / ブランチ）— 厳守

並行ストリームが**同じ名前を独立に選ぶ**とファイル/ブランチが衝突する（実例: `20260703_000_collab_notifications.sql` と `20260703_000_rls_stage0_grants.sql` が同一 `YYYYMMDD_000_` prefix で衝突）。名前は**時刻で一意化**し、**作成前に存在確認**する。

- **マイグレーションのファイル名は秒まで入れる**: `YYYYMMDDHHMMSS_<topic>.sql`（例 `20260703142530_collab_notifications.sql`）。
  - 連番方式（`YYYYMMDD_000_`, `_001_` …）は**使わない**。番号は別ストリームと必ず衝突する。
  - 秒まで含めれば適用順序も一意に定まる。作成時は現在時刻を実際に確認して埋める（`date +%Y%m%d%H%M%S`）。
  - 万一同秒で衝突したら末尾に `_a` `_b` を付す。
- **ブランチ名は作成前に一意性を確認する**:
  ```bash
  # 既存なら別名にする。空きならそのまま作成
  git ls-remote --exit-code origin "refs/heads/<name>" >/dev/null 2>&1 \
    && echo "既存: 別名にする" || git worktree add -b <name> ../taskapp-wt-<topic> origin/develop
  ```
  - 命名は `feat/*` `security/*` `fix/*` `docs/*` を基本とし、汎用語（`feat/fix` 等）は避け**topic＋必要なら時刻**（`feat/<topic>-YYYYMMDDHHMM`）で一意化する。
  - リモート/ローカル双方に無いことを確認してから作る。

## 実装ルール（TDD必須）

**実装は必ずテスト駆動開発（TDD）で行う** — Red → Green → Refactor。

1. **Red**: まず失敗するテストを書く（Vitest: `*.test.ts(x)` / E2E: Playwright）。仕様・受け入れ条件をテストで表現する。
2. **Green**: テストを通す最小限の実装を書く。
3. **Refactor**: テストが緑のまま重複除去・整理する。

- テストを書かずに実装を進めない。**バグ修正も「再現するテストを先に書く」→「直す」**（例: 今回のメール承認の競合状態は、二重実行で2回目が409になり副作用が発火しないことを検証する回帰テストを付ける）。
- 目標カバレッジ **80%以上**（特に `lib/`・API route・`rpc.ts`・課金/認可など中核ロジック）。現状カバレッジは低いため、触れた箇所からテストを足していく。
- 実装エージェント `impl-runner` もこのフローに従う。`tdd` スキル / `tdd-guide` エージェントを活用してよい。
- 例外（純粋なUIスタイル等テストが困難なもの）は理由をコメントで明記する。

## モデル・オーケストレーション運用ルール

詳細と役割分担表: **`docs/workflow/MODEL_ROUTING.md`**

### 思想
- **Fable 起動前に机を完璧にする**: 収集・整形・チェックは下位モデルに済ませ、Fable には整った状態での最終判断だけをさせる。
- **Fable に任せるのは `型がない × 失敗コストが大きい × 全体を見る必要がある` 判断だけ**。
- 振り分けは原則自動（サブエージェント定義の `model:` と Workflow 台本の `model`/`effort`）。スキルにモデルは書かず、モデル指定済みエージェントを呼ぶ。

### モデル対応（業務性質 A→Fable / B→Opus / C→Sonnet / D→Haiku）
| モデル | 使いどころ |
|--------|-----------|
| **Fable 5** | 新規アーキテクチャ・DBスキーマの根幹・RLS境界の新規設計・決済/認証/承認トークンの重大セキュリティ設計・後戻り困難な全体判断 |
| **Opus 4.8** | 日常の判断・レビュー・執筆（コードレビュー、リファクタ方針、仕様執筆、UXコピー、承認判断、既存DDL拡張） |
| **Sonnet 5** | 型が決まった量産・実行（設計確定後の実装、バグ/UXパッチ、LP実装、マニュアル量産） |
| **Haiku 4.5** | 機械的な変換・検査（レポート集計、lint/test結果解釈、デザイン準拠チェック、SPEC_INDEX同期） |

### 定義済みサブエージェント（`.claude/agents/`）
- `impl-runner`(Sonnet) 実装量産 / `migration-writer`(Opus) DDL差分 / `code-reviewer`(Opus) 差分レビュー
- `report-collector`(Haiku) レポート集計 / `design-system-checker`(Haiku) UI準拠検査 / `doc-index-updater`(Haiku) 索引同期

### 定義済み Workflow（`.claude/workflows/`）
- `review-changes` 差分レビュー（観点別モデル振り分け＋検証）/ `pre-release-check` リリース前一括チェック

### メインセッション切替の提案ルール（重要）
メインのモデルは Claude 自身では変更できない。ユーザーが `/model` で切り替える。Claude は**提案まで**を担当する。

- **「Fable に切り替えるべき」と提案する条件**: 新規アーキテクチャ設計 / DBスキーマ根幹・RLS境界の新規設計 / 決済・認証・承認トークン等の重大セキュリティ設計 / 後戻り困難な全体意思決定 に着手するとき。提案時は「準備（収集・整形・チェック）が下位モデルで完了していること」を先に示す。
- **「Opus に戻してよい」と提案する条件**: 上記の重い判断が終わり、実装・レビュー・執筆などの日常作業へ移るとき。
- 提案フォーマット例: `⏸ ここは「型なし×失敗コスト大×全体俯瞰」に該当します。/model で Fable に切り替えてください（机は整っています: 〇〇済み）。`

### 固定 vs 都度
- 繰り返し発生する業務のみ上記の定義ファイルに固定する。**単発・未確定の業務は定義ファイル化せず、本ルール（思想）に従って都度判断**。繰り返すと分かった時点で初めて固定する。

## Environment Setup

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Implementation Status

AT-001〜AT-012: **全て実装済み** (詳細は `docs/SPEC_INDEX.md` 参照)
