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

- **3-pane fixed layout**: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]（**デスクトップ = `md`(768px)以上**）
- **Inspector never overlays** - must resize Main pane（**デスクトップ限定**。`md`未満のモバイルでは Inspector は Main をリサイズせず、全画面シート(`.inspector-pane` の `@media (max-width:767px)`)としてオーバーレイする。単一インスタンスをクラス切替で開閉し二重マウントしない）
- **モバイル(`md`未満)**: LeftNav はハンバーガー＋スライドインdrawer化（`AppShell`）。ブレークポイントは portal と統一して**必ず `md`(768px)** を使う。ガント編集は**desktop-only**（`md`未満は推奨バナーでゲート）
- **Amber-500** indicates client-visible elements
- **Optimistic updates** required - no save buttons
- **No modal dialogs** for task details

## Data Model

```
ball = 'client' | 'internal'     # who needs to act next
origin = 'client' | 'internal'   # who initiated
type = 'task' | 'spec'           # spec requires spec_path + decision_state
```

## AI秘書 LINE連携：つなぎ方とプラン（要点）

**LINEのつなぎ方＝そのままプラン。違いは「誰の名前で相手に届くか」。**

| | agentpm秘書（無料） | agentpm秘書 Pro（有料） |
|---|---|---|
| つなぎ方 | **共通LINE**（TaskApp共通の共有アカウント・`owner_type='platform'`） | **自社LINE**（事務所自身のLINE公式アカウント・白ラベル・`owner_type='org'`） |
| 相手先との接続 | **グループ単位** | 担当者（個人）単位も可 |
| 自動タスク拾い | あり・**日次まとめ**のみ | あり・**即時** |
| Pro専有 | — | 自社名義・**1:1個別DM**・即時通知・時刻リマインド・送信枠拡大・縮退なし |
| 上限 | グループ数・共通LINE送信量に上限（縮退） | 大きめ＋グループ追加パック |

- **Proを選ぶ理由**＝自社の名前で届く／即時／個別DM／送信量。承認（責任者のタスク承認）は**両方で可能**（差別化にならない）。
- **Pro＝「つなぐハブ」（全体方針）**: チャットは LINE だけでなく **Slack/Teams など全チャット**、タスクは **Google Tasks など他のタスク管理ツールとも**連携する。この**マルチチャネル×マルチツールの連携の広さ自体を Pro の売り**にする。外部連携（Google Tasks ミラー・他チャット・他タスクツール）は原則 **Pro 専有**。個々の連携は順次追加。
- **UIの言葉（厳守）**: 「顧問先」ではなく **「相手先」**、「共有Bot/専用Bot」ではなく **「共通LINE/自社LINE」**。グループを社内/社外に分類させない（見せ分けはタスク単位の `client_scope`）。
- **機能ゲート**: `src/lib/billing/entitlements.ts` の `PLAN_FEATURES`（own_line_account / line_direct_dm / instant_line_notify は Pro 専有）＋ `PLAN_LIMITS`（maxLineGroups / monthlySharedPushQuota）。gate は**確立/送信境界のみ・新規紐付けの拒否のみ（既存は切らない）**。
- **⚠ 共通LINE送信クォータ**: LINE無料枠200通/月は**アカウント単位（共有bot全org相乗り）**。org別capだけでは持ち出しが非有界 → **グローバル予算＋org別capの二層制**が必要（`monthlySharedPushQuota` の仮値は安全側、実装は別PR）。
- **価格は未確定**（LLM抽出原価の実測とLINE規約の複数アカウント可否が前提）。方向＝**定額＋グループ追加パック**、Pro は粗利70-80%・LINE側費用込みで月10万円未満。訴求は時短でなく**クオリティ（拾い漏れゼロ）**。

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
- `fable-architect`(**Fable**) 型なし×失敗コスト大×全体俯瞰の最終判断（判断のみ・実装しない）
- `impl-runner`(Sonnet) 実装量産 / `migration-writer`(Opus) DDL差分 / `code-reviewer`(Opus) 差分レビュー
- `report-collector`(Haiku) レポート集計 / `design-system-checker`(Haiku) UI準拠検査 / `doc-index-updater`(Haiku) 索引同期
- `page-perf-reviewer`(Opus) ページの表示速度レビュー。データ取得・描画が「速いページの型」(react-query永続キャッシュ活用・fetch並列/waterfall・staleTime・limit/N+1・仮想化)に準拠しているか検査

### ページ表示速度は必ずレビューする（厳守）
`src/app/**` にページ(route/`page.tsx`)を**新規作成**、または既存ページのクライアントコンポーネント・データ取得hookを**編集**したら、出す前に必ず `page-perf-reviewer` サブエージェントを呼んで表示速度の型準拠をレビューさせる。基準は速いページ(`project/[spaceId]/TasksPageClient.tsx`, `inbox/InboxClient.tsx`)と `QueryProvider`。指摘(waterfall・cache-miss・heavy-query・非仮想化)は修正してからPRにする。認証×横断の根幹設計に踏み込む指摘は Fable に判断を委ねる。

### 定義済み Workflow（`.claude/workflows/`）
- `review-changes` 差分レビュー（観点別モデル振り分け＋検証）/ `pre-release-check` リリース前一括チェック

### Fable 判断は委譲が既定（メイン切替は原則しない）
メインは **Opus のまま**運用する。Fable 級の判断が要るときは `/model` での手動切替を求めず、**`fable-architect` サブエージェント（`model: fable`）に委譲**する。ユーザーがモデルを都度切り替える手間をなくすのが狙い。

- **委譲の条件**（3条件を満たす後戻り困難な判断）: 新規アーキテクチャ設計 / DBスキーマ根幹・新規テーブルのRLS境界設計 / 決済・認証・承認トークン等の重大セキュリティ設計 / 複数サブシステムに波及する全体意思決定 / 大規模SPECの骨格方針。
- **委譲の作法（机を整えてから渡す）**: Opus が収集・整形・チェック・選択肢の洗い出しを済ませ、`fable-architect` には**整った前提＋制約＋論点＋候補案**を渡して「最終判断だけ」を求める。返ってきた決定を Opus が実装（or impl-runner/migration-writer へ）に落とす。
- **`fable-architect` は判断のみ**（実装・編集はしない）。返却は決定・根拠・リスク/不可逆性・実装指示・検証項目。文脈不足なら決定を保留して不足情報を返す。
- **`/model` で Fable にメイン切替する例外**: 判断に**メイン会話の全文脈が不可欠**で、サブエージェントへの briefing に要約しきれない場合のみ。そのときだけ「⏸ ここは全文脈が要るので `/model` で Fable に切替を」と提案する。既定はあくまで委譲。

### 固定 vs 都度
- 繰り返し発生する業務のみ上記の定義ファイルに固定する。**単発・未確定の業務は定義ファイル化せず、本ルール（思想）に従って都度判断**。繰り返すと分かった時点で初めて固定する。

## Environment Setup

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Implementation Status

AT-001〜AT-012: **全て実装済み** (詳細は `docs/SPEC_INDEX.md` 参照)
