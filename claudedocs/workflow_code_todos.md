# Implementation Workflow: Code TODOs

## Overview
コード内に残っているTODOを解消するワークフロー

**対象:**
1. `TaskCreateSheet.tsx:241` - 内部担当者選択UIの追加
2. `LeftNav.tsx:82` - Inbox件数の通知テーブル連携

---

## Phase 1: 内部担当者選択UI

### 1.1 現状分析

**TaskCreateSheet.tsx の現状:**
- `clientOwnerIds` - クライアント担当者（実装済み）
- `internalOwnerIds` - 内部担当者（空配列ハードコード）

**既存パターン:**
```typescript
// クライアント担当者
const [clientOwnerIds, setClientOwnerIds] = useState<string[]>([])
const [clientOptions, setClientOptions] = useState<string[]>([])

// 切り替え関数
const toggleClientOwner = (ownerId: string) => {
  setClientOwnerIds((prev) =>
    prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]
  )
}
```

### 1.2 実装内容

**追加するstate:**
- `internalOwnerIds` - 選択された内部担当者ID配列
- `internalOptions` - 内部メンバー一覧（role !== 'client'）

**追加するロジック:**
- `fetchData`内で内部メンバー取得
- `toggleInternalOwner`関数追加
- UI: クライアント担当者セクションの下に内部担当者セクション追加

**依存関係:** なし

### 1.3 テスト観点
- 内部メンバー一覧が正しく取得される
- 内部担当者の選択/解除が動作する
- onSubmit時にinternalOwnerIdsが渡される

---

## Phase 2: Inbox通知件数

### 2.1 現状分析

**LeftNav.tsx の現状:**
```typescript
const inboxCount = 0 // TODO: Fetch from notifications table
```

**notifications テーブル構造:**
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  space_id uuid NOT NULL,
  to_user_id uuid NOT NULL,  -- 通知先ユーザー
  channel text NOT NULL,      -- 'in_app' | 'email'
  type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz NULL    -- NULLなら未読
);
```

### 2.2 実装内容

**新規フック作成:** `useUnreadNotificationCount.ts`
- Supabaseから未読件数を取得
- `to_user_id = current_user` AND `read_at IS NULL` AND `channel = 'in_app'`
- リアルタイム更新（Supabase Realtime）はオプション

**LeftNav.tsx 修正:**
- `useUnreadNotificationCount`フックを使用
- `inboxCount`を動的に表示

**依存関係:** なし

### 2.3 テスト観点
- 未読件数が正しく取得される
- ログイン前は0を返す
- エラー時のフォールバック

---

## Execution Order

```
Phase 1: 内部担当者選択UI
├─ 1.1 TaskCreateSheet.tsx に内部担当者state追加
├─ 1.2 fetchData に内部メンバー取得追加
├─ 1.3 toggleInternalOwner 関数追加
├─ 1.4 UI セクション追加
└─ 1.5 onSubmit で internalOwnerIds を渡す

Phase 2: Inbox通知件数
├─ 2.1 useUnreadNotificationCount フック作成
├─ 2.2 LeftNav.tsx でフック使用
└─ 2.3 テスト作成
```

---

## Quality Gates

### 各Phase完了時チェック
- [ ] TypeScript型エラーなし
- [ ] 全テスト通過
- [ ] ビルド成功

---

## Files to Modify

| Phase | File | Action |
|-------|------|--------|
| 1 | `src/components/task/TaskCreateSheet.tsx` | 内部担当者選択UI追加 |
| 2 | `src/lib/hooks/useUnreadNotificationCount.ts` | 新規作成 |
| 2 | `src/components/layout/LeftNav.tsx` | フック使用 |
| 1,2 | `src/__tests__/...` | テスト追加 |

---

**作成日:** 2026-02-02
**完了日:** 2026-02-02

## Completion Status

### Phase 1: 内部担当者選択UI ✅
- `TaskCreateSheet.tsx` に `internalOwnerIds`, `internalOptions` state追加
- `fetchData`で内部メンバー取得（`role !== 'client'`）
- `toggleInternalOwner`関数追加
- ボール=社内時に内部担当者選択UI表示
- `onSubmit`で`internalOwnerIds`を渡す

### Phase 2: Inbox通知件数 ✅
- `useUnreadNotificationCount.ts`フック作成
- `notifications`テーブルから未読件数取得
- `LeftNav.tsx`でフック使用してinboxCount表示
- テスト7件追加

### 品質チェック結果
- ✅ 114 tests passed
- ✅ Build successful
