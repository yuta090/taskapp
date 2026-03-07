# 見積もりワークフロー仕様書

> **Version**: 1.0
> **Updated**: 2026-03-07
> **Status**: 実装済み

## 概要

タスク作成依頼に対して見積もり金額を提示し、クライアント承認を得るワークフロー。既存のボール渡し（ball ownership）機構を活用。

## データモデル

### 追加カラム

```sql
ALTER TABLE tasks
  ADD COLUMN estimated_cost integer,        -- 見積もり金額（円単位）
  ADD COLUMN estimate_status estimate_status NOT NULL DEFAULT 'none';

-- estimate_status: 'none' | 'pending' | 'approved' | 'rejected'
```

### 状態遷移図

```
none ──→ pending ──→ approved (終了)
                 └──→ rejected ──→ pending (再見積もり)
```

**禁止遷移:**
- `approved → pending` : 承認済みの見積もりは変更不可
- `approved → rejected` : 承認後の取消は不可

## ワークフロー

### 1. 見積もり送付（社内 → クライアント）

**場所**: TaskInspector（見積もりセクション）

**操作:**
1. 金額入力（¥ 単位、整数）
2. 「見積もりを送付」ボタンをクリック
3. 以下が原子的に実行:
   - `estimated_cost` に金額を保存
   - `estimate_status` を `pending` に設定
   - `ball` を `client` に変更（ボール渡し）

**条件:**
- `client_scope = 'deliverable'` のタスクのみ表示
- `status ≠ 'done'` のタスクのみ
- `estimate_status ≠ 'approved'` のタスクのみ（承認後は変更不可）
- クライアントメンバーが1名以上存在すること

**障害耐性:**
- ボール渡し失敗時: `estimate_status` をロールバック

### 2. 見積もり確認（クライアント）

**場所**: ポータル（PortalTaskInspector）

**表示:**
- 見積もり金額バナー（¥ フォーマット、amber背景）
- ActionCardに金額バッジ表示（`見積もり ¥XXX,XXX`）

**操作:**
- **見積もり承認**: `estimate_status = 'approved'`, `ball = 'internal'`
- **再見積もり依頼**: `estimate_status = 'rejected'`, `ball = 'internal'` （コメント必須）

### 3. API エンドポイント

**POST** `/api/portal/tasks/[taskId]`

| Action | 説明 | コメント |
|--------|------|---------|
| `estimate_approve` | 見積もり承認 | 任意 |
| `estimate_reject` | 再見積もり依頼 | **必須** |

**バリデーション:**
- `ball = 'client'` であること（レースコンディション保護）
- `estimate_status = 'pending'` であること
- `estimate_status = 'pending'` の場合、通常の `approve`/`request_changes` は **409拒否**

**コメント保存失敗時:**
- `estimate_reject`: ロールバック実行 → 500返却

### 4. 監査ログ

| イベント | 表示 |
|---------|------|
| `estimate.approved` | 「{タイトル}の見積もりを承認しました」|
| `estimate.rejected` | 「{タイトル}の再見積もりを依頼しました」|

両イベントともクライアントに可視。

## UI仕様

### TaskInspector（社内側）

見積もりセクション（`client_scope = 'deliverable'` かつ `status ≠ 'done'` のとき表示）:

| 状態 | 表示 |
|------|------|
| `none` | 金額入力 + 「見積もりを送付」ボタン |
| `pending` | amber背景 「クライアント確認中」+ 金額表示 |
| `approved` | green背景 「承認済み」+ 金額表示（入力不可） |
| `rejected` | red背景 「再見積もり依頼」+ 打消し線金額 + 再入力可能 |

### PortalTaskInspector（クライアント側）

`estimate_status = 'pending'` のとき:
- 金額バナー（¥フォーマット、2xl太字）
- 「見積もり承認」（green）/「再見積もり依頼」（amber）ボタン
- コメント入力欄（再見積もり時は必須）
- 通常の承認/修正依頼ボタンは非表示

### ActionCard

`estimate_status = 'pending'` のとき:
- タイトル横に `見積もり ¥XXX,XXX` バッジ（amber）
- インライン承認ボタンは非表示（インスペクターでの操作を強制）

## ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `supabase/migrations/20260307_001_estimate_workflow.sql` | DDL |
| `src/types/database.ts` | EstimateStatus型 + カラム |
| `src/lib/hooks/useTasks.ts` | 楽観的更新対応 |
| `src/lib/audit.ts` | 監査イベント追加 |
| `src/components/task/TaskInspector.tsx` | 見積もりセクションUI |
| `src/components/portal/PortalTaskInspector.tsx` | 見積もり確認UI |
| `src/components/portal/ui/ActionCard.tsx` | バッジ + ボタン制御 |
| `src/components/portal/dashboard/ActionSection.tsx` | データ通過 |
| `src/app/api/portal/tasks/[taskId]/route.ts` | API アクション |
| `src/app/portal/tasks/page.tsx` | クエリ拡張 |
| `src/app/portal/tasks/PortalTasksClient.tsx` | ハンドラー |
| `src/app/portal/PortalDashboardClient.tsx` | ハンドラー |
| `src/app/portal/page.tsx` | ダッシュボードクエリ拡張 |
