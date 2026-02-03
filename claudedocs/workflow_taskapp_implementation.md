# TaskApp 実装ワークフロー

Generated: 2026-02-01
Strategy: Systematic
Status: **Ready for Implementation**

---

## Executive Summary

TaskApp は実装可能な状態です。詳細仕様（UI規則、API仕様 v0.3、DDL v0.2）とプロトタイプ（v29系）が完成しており、受け入れテスト（AT-001〜AT-012）も定義済みです。

---

## Phase 0: プロジェクト初期化

### 0.1 Next.js セットアップ
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
```

**依存関係**:
- `@supabase/supabase-js` - Supabase クライアント
- `@supabase/ssr` - SSR対応
- `phosphor-react` - アイコン（プロトタイプと統一）

### 0.2 環境設定
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### 0.3 Tailwind 設定
プロトタイプの `tailwind.config` を参考に設定:
- カスタムカラー（gray, amber, indigo, red, blue）
- カスタムフォントサイズ（2xs: 10px, xs: 12px, sm: 13px, base: 14px）
- カスタムシャドウ（subtle, pane, popover, modal）

**Checkpoint**: `npm run dev` が動作すること

---

## Phase 1: データベース構築

### 1.1 DDL 適用
**ファイル**: `docs/db/DDL_v0.2.sql`

適用順序:
1. `organizations`, `spaces`, `users` (前提テーブル - v0.1)
2. `tasks` テーブル拡張（ball, origin, type, spec_path, decision_state）
3. `task_owners` テーブル作成
4. `meetings` テーブル拡張
5. `meeting_participants` テーブル作成
6. `task_events` テーブル作成（監査ログ）
7. `reviews`, `review_approvals` テーブル作成
8. `notifications` テーブル作成

### 1.2 RLS ポリシー設定
- Organization / Space レベルのアクセス制御
- Client Portal 用の読み取り専用ポリシー

**Checkpoint**: Supabase Studio でテーブル確認

---

## Phase 2: RPC 関数実装

**優先度順**（依存関係考慮）:

### 2.1 Core RPC
| # | RPC | 目的 | 依存 |
|---|-----|------|------|
| 1 | `rpc_pass_ball` | ボール移動 + owners 更新 + 監査ログ | - |
| 2 | `rpc_set_owners` | オーナー設定（pass_ball 内部用） | - |

### 2.2 Considering/Spec RPC
| # | RPC | 目的 | 依存 |
|---|-----|------|------|
| 3 | `rpc_decide_considering` | 検討中→決定（会議内/外分離） | rpc_pass_ball |
| 4 | `rpc_set_spec_state` | spec タスク状態遷移 | - |

### 2.3 Review RPC
| # | RPC | 目的 | 依存 |
|---|-----|------|------|
| 5 | `rpc_review_open` | レビュー作成 + approvals 初期化 | - |
| 6 | `rpc_review_approve` | 承認 | rpc_review_open |
| 7 | `rpc_review_block` | 差し戻し | rpc_review_open |

### 2.4 Meeting RPC
| # | RPC | 目的 | 依存 |
|---|-----|------|------|
| 8 | `rpc_meeting_start` | planned → in_progress | - |
| 9 | `rpc_meeting_end` | in_progress → ended + 通知 | rpc_generate_meeting_minutes |
| 10 | `rpc_generate_meeting_minutes` | 議事録生成 | - |

**Checkpoint**: 各RPC の単体テスト通過

---

## Phase 3: コンポーネント設計

### 3.1 レイアウト（3ペイン固定）

```
┌─────────────────────────────────────────────────────┐
│ [Left Nav: 240px] │ [Main: flex-1] │ [Inspector: 400px] │
└─────────────────────────────────────────────────────┘
```

**絶対ルール**:
- Inspector は **Overlay 禁止**（Main をリサイズ）
- Inspector 幅: 400px（1920px+: 440px, 2560px+: 480px）

### 3.2 コンポーネント階層

```
src/
├── app/
│   ├── (internal)/           # 社内用ルート
│   │   ├── inbox/
│   │   ├── my/
│   │   └── [orgId]/
│   │       └── project/
│   │           └── [spaceId]/
│   │               ├── page.tsx        # Tasks
│   │               ├── meetings/
│   │               ├── wiki/
│   │               └── views/
│   └── portal/               # クライアントポータル
│       └── [token]/
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx      # 3ペイン管理
│   │   ├── LeftNav.tsx
│   │   ├── MainPane.tsx
│   │   └── Inspector.tsx
│   │
│   ├── task/
│   │   ├── TaskRow.tsx       # 行高 32-40px
│   │   ├── TaskInspector.tsx
│   │   └── TaskCreateSheet.tsx
│   │
│   ├── meeting/
│   │   ├── MeetingRow.tsx
│   │   ├── MeetingInspector.tsx
│   │   └── MinutesEditor.tsx
│   │
│   ├── review/
│   │   ├── ReviewList.tsx
│   │   └── ReviewInspector.tsx
│   │
│   └── shared/
│       ├── InlinePopover.tsx  # 単一フィールド編集
│       ├── AmberBadge.tsx     # クライアント可視マーク
│       └── OptimisticButton.tsx
│
└── lib/
    ├── supabase/
    │   ├── client.ts
    │   ├── server.ts
    │   └── rpc.ts            # RPC ラッパー
    └── hooks/
        ├── useTasks.ts
        ├── useMeetings.ts
        └── useOptimistic.ts
```

### 3.3 編集 UI（3種類のみ）

| UI | 用途 | トリガー |
|----|------|----------|
| **Inspector** | 詳細編集 | 行クリック → `?task=<id>` |
| **Inline Popover** | 単一フィールド | フィールドクリック |
| **Create Sheet** | 新規作成 | `C` キー or ボタン |

**Checkpoint**: 空の 3 ペインレイアウトが動作

---

## Phase 4: 画面実装

### 4.1 Inbox（受信トレイ）`/inbox`
- Inbox Inspector（Task Inspector とは別）
- 通知詳細 + 「タスクへ移動」リンク
- フィルタ: 重要 / その他 / スヌーズ

### 4.2 Tasks List `/[orgId]/project/[spaceId]`
- Task Inspector（右ペイン）
- タブ: すべて / アクティブ / バックログ
- Ball アイコン表示（client: amber, internal: gray）

### 4.3 Considering View
- `status=considering` のタスク専用
- Ball ownership による並び替え
- 連続作成時の clientOwnerIds 自動引き継ぎ

### 4.4 Meetings `/[orgId]/project/[spaceId]/meetings`
- 会議一覧（planned / in_progress / ended）
- Meeting Inspector: Transcript | Extract | Apply タブ
- 会議ライフサイクル操作（開始/終了）

### 4.5 Client Portal `/portal/[token]`
- 閲覧 + コメントのみ
- 内部情報非表示（TP-ID, GitHub, 社内ラベル）
- `ball=client` 優先表示

**Checkpoint**: 各画面の基本表示

---

## Phase 5: ビジネスロジック実装

### 5.1 Ball Ownership
```typescript
// rpc_pass_ball 呼び出し時の検証
if (ball === 'client' && clientOwnerIds.length === 0) {
  throw new Error('Client owner required');
}
```

### 5.2 代理入力（会議外確定）
```typescript
// on_behalf_of='client' の場合の必須チェック
if (onBehalfOf === 'client' && evidence !== 'meeting') {
  if (!clientConfirmedBy) throw new Error('Confirmed by required');
}
```

### 5.3 Spec Task 遷移
```
considering → decided → implemented
```
- `spec_path` 必須（`/spec/*.md#anchor` 形式）
- implemented 移行は 2 クリック導線（1回目: ファイル開く、2回目: 状態変更）

### 5.4 会議終了通知（冪等性）
```typescript
// dedupe_key = `${meetingId}:${endedAt}`
// UNIQUE(to_user_id, channel, dedupe_key) で重複防止
```

**Checkpoint**: RPC 経由の操作が正常動作

---

## Phase 6: 受け入れテスト

### テスト一覧（AT-001〜AT-012）

| ID | テスト内容 | Phase 依存 |
|----|-----------|------------|
| AT-001 | 会議作成（参加者必須） | 4, 5 |
| AT-002 | 会議開始前は決定/承認不可 | 4, 5 |
| AT-003 | 会議終了通知は1回だけ（冪等） | 5 |
| AT-004 | 会議終了通知の内容（決定/未決抽出） | 5 |
| AT-005 | 議事録MD A方式：SPEC行タスク化 | 4, 5 |
| AT-006 | 会議内決定：SPECをdecidedにするログ | 5 |
| AT-007 | 会議外「クライアント確定として登録」必須入力 | 5 |
| AT-008 | 入力者と意思決定者の分離（監査） | 2, 5 |
| AT-009 | decided → implemented（2クリック導線） | 4, 5 |
| AT-010 | クライアントダッシュボード：未決優先表示 | 4 |
| AT-011 | 通知の受信者（参加者＋担当者） | 5 |
| AT-012 | DB制約：SPECタスクの必須条件 | 1 |

**Checkpoint**: 全 AT パス

---

## Dependency Graph

```
Phase 0 (Init)
    │
    ▼
Phase 1 (DB) ──────────────────────┐
    │                              │
    ▼                              │
Phase 2 (RPC) ◄────────────────────┤
    │                              │
    ▼                              │
Phase 3 (Components)               │
    │                              │
    ▼                              │
Phase 4 (Screens) ◄────────────────┘
    │
    ▼
Phase 5 (Business Logic)
    │
    ▼
Phase 6 (Acceptance Tests)
```

---

## 実装順序（推奨）

### Week 1
- [x] Phase 0: プロジェクト初期化
- [ ] Phase 1: DDL 適用 + RLS
- [ ] Phase 2.1-2.2: Core + Considering RPC

### Week 2
- [ ] Phase 2.3-2.4: Review + Meeting RPC
- [ ] Phase 3: コンポーネント基盤

### Week 3
- [ ] Phase 4.1-4.3: Inbox, Tasks, Considering

### Week 4
- [ ] Phase 4.4-4.5: Meetings, Client Portal
- [ ] Phase 5: ビジネスロジック統合

### Week 5
- [ ] Phase 6: 受け入れテスト
- [ ] バグ修正 + 最終調整

---

## 参照ドキュメント

| ドキュメント | パス |
|-------------|------|
| UI規則 | `docs/spec/UI_RULES_AND_SCREENS.md` |
| API仕様 | `docs/api/API_SPEC_v0.3.md` |
| DDL | `docs/db/DDL_v0.2.sql` |
| 設計決定 | `docs/notes/DECISIONS_v4.md` |
| 受け入れテスト | `docs/spec/REVIEW_SPEC.md` |
| プロトタイプ | `docs/prototypes/TaskApp_MasterPrototype_v29*.html` |

---

## Next Step

このワークフローを `/sc:implement` で実行開始できます。

```
/sc:implement Phase 0: プロジェクト初期化
```
