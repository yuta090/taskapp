# クライアント不在時の内部運用対応 仕様書

> **Version**: 1.1
> **Last Updated**: 2026-02-19
> **Status**: 実装済み（Codexコードレビュー3回 → APPROVE + UX改善v1.1）

---

## 概要

TaskAppは「ボール所有」概念を中心としたクライアント向けプロジェクト管理システムだが、
クライアント未登録の状態で社内チームだけでもタスク管理・承認依頼ができるよう改善した。

### 想定運用フロー

```
社内でタスク作成 → 社内承認フロー/エスカレーション → 承認後にクライアントへボール投げ
```

### 改善サマリ

| 機能 | 改善前 | 改善後 | 優先度 |
|------|:------:|:------:|:------:|
| タスク作成・管理（内部） | OK | OK | - |
| 社内承認依頼（RPC） | OK | OK | - |
| 社内承認依頼（UI） | NG（ボタンなし） | OK | P0 |
| rpc_review_openの承認維持 | NG（毎回リセット） | OK | P0 |
| 会議作成 | NG（クライアント必須） | OK | P1 |
| UXラベル | 混乱あり | OK | P1 |
| client_scopeデフォルト | 逆行 | OK | P1 |
| 社内→クライアントへボール投げ | OK | OK | - |
| 承認フローの発見性 | 低（Inspector最下部） | OK | P2 |
| ステータス連動の自動展開 | なし | OK | P2 |
| タスク一覧のクイックアクション | なし | OK | P2 |

---

## P0-1: rpc_review_open 承認リセット修正

### 問題

`rpc_review_open` が毎回 `DELETE FROM review_approvals` で全承認をリセットしていた。
REVIEW_SPEC.md の「差し戻し後も既に通ったチェック項目は維持」要件と矛盾。

### 対象ファイル

- `supabase/migrations/20260218_000_fix_review_open_approvals.sql`（新規）

### 変更内容

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| 既存 approved | DELETE → 再挿入 | **維持**（変更なし） |
| 既存 blocked | DELETE → 再挿入 | pending にリセット（再確認） |
| 新規レビュアー | INSERT | INSERT (pending) |
| 外されたレビュアー | DELETE | DELETE |
| レビューステータス | 常に `open` | **再計算**（pending有→open / 全approved→approved） |

### セキュリティ強化

- **呼び出し元検証**: `space_memberships` で admin/editor ロールを確認
- **レビュアー検証**: 全レビュアーIDが対象スペースのメンバーであることを確認
- **入力サニタイズ**: NULL除去 + 重複排除

### RPC署名

変更なし → フロントエンド修正不要

---

## P0-2: 承認フローUI導線の構築

### 問題

`useReviews` hookとRPCは実装済みだったが、UIからの呼び出しがゼロだった。

### 新規ファイル

**`src/components/review/TaskReviewSection.tsx`**

自己完結型の承認フローUIコンポーネント。TaskInspector に埋め込む形で表示。

```typescript
interface TaskReviewSectionProps {
  taskId: string
  spaceId: string
  orgId: string
  taskStatus?: string  // v1.1: ステータス連動用
  readOnly?: boolean
  onReviewChange?: (taskId: string, status: string | null) => void
}
```

### ユーザー操作フロー

```
タスク選択 → Inspector右ペイン → 「承認フロー」セクション（ステータス/ボール直後に配置）

  [承認なし + status=in_review]
    → 承認者選択UI自動展開（紫ハイライト）→ 承認者選択 → 「依頼する」

  [承認なし + 他のステータス]
    → 「承認を依頼」ボタン → メンバー選択（チェックボックス）→ 依頼

  [承認待ち]
    → ステータスバッジ表示 + 承認者リスト（承認/差戻し/待ち状態）
    → 差し戻し理由がある場合は赤カードで表示

  [自分が承認者]
    → 「承認する」「差し戻す」ボタン表示
    → 差し戻し時は理由入力テキストエリア
```

### 変更ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/components/review/index.ts` | `TaskReviewSection` export追加 |
| `src/components/task/TaskInspector.tsx` | `<TaskReviewSection>` 追加 + `onReviewChange` prop中継 |
| `src/components/task/TaskRow.tsx` | `reviewStatus` prop追加、ステータスバッジ表示 |
| `src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx` | reviews一括取得、タスク行にレビューバッジ表示、楽観的更新 |

### レビューバッジの楽観的更新

RPC呼び出し後、実際のDB状態を `fetchReview()` で取得し、成功時のみ親に通知。
fetch失敗時はバッジを前の状態のまま保持（一時的エラーで消えない）。

```typescript
// fetchReviewの戻り値型
type FetchResult = { ok: true; status: string | null } | { ok: false }

// ハンドラ例
const result = await fetchReview()
if (result.ok) onReviewChange?.(taskId, result.status)
```

---

## P1-1: 会議のクライアント必須緩和

### 問題

3箇所でクライアント参加者が強制されており、社内ミーティングが作成不可だった。

### 変更ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/components/meeting/MeetingCreateSheet.tsx` | バリデーション削除、`*必須` ラベル削除 |
| `src/lib/hooks/useMeetings.ts` | hook内のバリデーション削除 |
| `src/components/meeting/MeetingInspector.tsx` | `canStart` 条件から `hasClientParticipants` 除去 |

### 影響範囲

- DB制約なし（`meeting_participants` にクライアント必須のCHECKはない）
- `rpc_meeting_start` もチェックなし
- 純粋なUI/hookガードの除去のみ

---

## P1-2: client_scope デフォルト変更

### 問題

デフォルト `'deliverable'`（クライアントポータルに表示）は内部運用と逆行していた。

### 変更ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/components/task/TaskCreateSheet.tsx` | `useState<ClientScope>('deliverable')` → `'internal'` |
| `src/lib/hooks/useTasks.ts` | `task.clientScope ?? 'deliverable'` → `'internal'` |

### 影響

- 既存タスクに影響なし（新規作成時のデフォルトのみ変更）
- クライアント向けに公開する場合はユーザーが明示的に `deliverable` を選択

---

## P1-3: UXラベル抽象化

### 問題

「クライアント」ラベルがクライアント不在時に混乱を招いていた。

### 新規ファイル

**`src/lib/labels.ts`**

```typescript
import type { BallSide } from '@/types/database'

export const BALL_LABELS = { client: '外部', internal: '社内' } as const
export const BALL_STATUS_LABELS = { client: '確認待ち', internal: '社内対応中' } as const

export function getBallLabel(ball: BallSide): string
export function getBallStatusLabel(ball: BallSide): string
```

### 変更マッピング

| 変更前 | 変更後 | 用途 |
|--------|--------|------|
| クライアント | 外部 | ボール所有者ラベル |
| 社内 | 社内 | ボール所有者ラベル（変更なし） |
| クライアント確認待ち | 確認待ち | ステータスラベル |
| 社内対応中 | 社内対応中 | ステータスラベル（変更なし） |

### 変更対象ファイル（35箇所、20+ファイル）

**タスク関連:**
- `TaskInspector.tsx` — 8箇所
- `TaskCreateSheet.tsx` — 6箇所
- `TaskRow.tsx` — 1箇所
- `TaskFilterMenu.tsx` — 2箇所
- `TaskComments.tsx` — 1箇所

**会議関連:**
- `MeetingCreateSheet.tsx` — 2箇所
- `MeetingInspector.tsx` — 2箇所

**レイアウト・共通:**
- `LeftNav.tsx` — 1箇所
- `GanttChart.tsx` — 2箇所
- `AmberBadge.tsx` — 1箇所
- `NotificationInspector.tsx` — 2箇所

**スケジューリング・課金:**
- `scheduling/` — 3箇所
- `billing/` — 2箇所

**バックエンド:**
- `src/lib/slack/blocks.ts` — 2箇所
- `TasksPageClient.tsx` — 3箇所

### 変更しないもの

- DB値（`ball = 'client'`, `side = 'client'`）
- TypeScript型定義（`BallSide = 'client' | 'internal'`）
- `'use client'` ディレクティブ
- LP/マーケティングページ

---

## Codexコードレビュー結果

3回のレビューを経てAPPROVEを取得。

### Round 1: REQUEST CHANGES（6件）

| # | 種別 | 内容 | 対応 |
|---|------|------|------|
| 1 | Critical | SlotResponseGrid ドラフト同期ロジック反転 | 修正済み |
| 2 | Critical | rpc_review_open が常に status='open' に固定 | ステータス再計算ロジック追加 |
| 3 | Critical | SECURITY DEFINER にメンバーシップ検証なし | 権限チェック追加 |
| 4 | Recommend | レビューバッジの古いデータ表示 | 楽観的更新実装 |
| 5 | Recommend | ラベル変換漏れ残存 | 追加修正 |
| 6 | Recommend | 未使用変数 hasClientParticipants | 削除 |

### Round 2: REQUEST CHANGES（2件）

| # | 種別 | 内容 | 対応 |
|---|------|------|------|
| 1 | Critical | 楽観的更新にハードコード文字列使用 | fetchReview戻り値型変更で実DB値を使用 |
| 2 | Recommend | SQL p_reviewer_ids の NULL/重複未処理 | サニタイズ追加 |

### Round 3: APPROVE（1件推奨事項）

| # | 種別 | 内容 | 対応 |
|---|------|------|------|
| 1 | Recommend | fetch失敗時にバッジがクリアされる可能性 | `{ ok, status }` 型で成功時のみ通知に変更 |

---

## P2: 承認フローUX改善（v1.1）

### 問題

承認フロー機能は実装済みだが、UXが直感的でなかった：
- 「レビュー」セクションがInspector最下部（位置#10）に埋もれていた
- 「責任者」「レビュー」等のラベルが紛らわしく、オーナー変更と混同されていた
- ステータスを「レビュー中」に変更しても承認依頼への導線がなかった

### 改善内容

#### P2-1: ラベル統一（用語変更）

| 変更前 | 変更後 | 理由 |
|--------|--------|------|
| レビュー | **承認フロー** | 「上長に確認してもらう」意図を明確化 |
| レビュー依頼 | **承認を依頼** | アクションの意図を直接表現 |
| レビュー中（ステータス） | **承認確認中** | フローの現在地を明示 |
| レビュー待ち（バッジ） | **承認待ち** | 待ち状態を明確化 |
| 責任者 | **実行担当** | 「オーナー変更」との混同を防止 |
| レビュアーを選択 | **承認者を選択** | 一貫した用語 |
| 再レビュー | **再依頼** | 簡潔化 |

**変更対象ファイル（12ファイル）:**
- `TaskInspector.tsx` — ステータスラベル + 責任者ラベル
- `TaskReviewSection.tsx` — 全承認フロー関連ラベル
- `TaskRow.tsx` — ステータスラベル + バッジテキスト
- `TaskFilterMenu.tsx` — フィルターラベル
- `ReviewList.tsx` / `ReviewInspector.tsx` — 一覧・詳細のラベル
- `NotificationInspector.tsx` — 通知タイプラベル
- `GanttChart.tsx` — ガントのステータスラベル
- `my/page.tsx` — マイタスクのフィルターラベル
- `slack/blocks.ts` — Slack通知テキスト
- `settings/notifications/page.tsx` — 設定画面のラベル

#### P2-2: セクション配置変更

承認フローセクションを Inspector の**位置#4**（ステータス/ボールの直後）に移動。

| 変更前の順序 | 変更後の順序 |
|:-------------|:-------------|
| 1. タイトル | 1. タイトル |
| 2. ステータス | 2. ステータス |
| 3. ボール | 3. ボール |
| 4. マイルストーン | **4. 承認フロー** ← 移動 |
| 5. 担当者 | 5. マイルストーン |
| ... | ... |
| 10. レビュー ← 埋もれていた | (削除: 位置#4に統合) |

#### P2-3: ステータス連動の自動展開

`TaskReviewSection` に `taskStatus` propを追加。
ステータスが `in_review` で承認依頼がない場合、承認者選択UIが**自動展開**される。

```typescript
// Auto-expand reviewer picker when status is in_review and no review exists
useEffect(() => {
  if (!loading && taskStatus === 'in_review' && !reviewData && !readOnly) {
    setShowReviewerPicker(true)
  }
}, [loading, taskStatus, reviewData, readOnly])
```

**視覚的ハイライト:** 紫の背景 + リングで承認フローセクションを強調。

#### P2-4: タスク一覧クイックアクション

`TaskRow` に「承認を依頼」ボタンを追加。
`status === 'in_review'` かつ承認依頼が未作成のタスクに対して常時表示。
クリックでInspectorが開き、承認フローセクションが自動展開される。

#### P2-5: フィードバック強化

- 承認依頼後のバッジテキストを「レビュー中」→「承認待ち」に変更
- 承認状態がタスク一覧で明確に表示される

---

## テスト手順

### ビルド確認

```bash
npm run lint && npm run build
```

### 機能テスト

1. **タスク作成**: クライアントなしで ball=internal → 正常作成
2. **承認依頼**: TaskInspector から社内メンバーに承認依頼 → 承認/差戻し動作確認
3. **承認再依頼**: 承認済みメンバーがいる状態で再依頼 → 承認が維持されるか確認
4. **会議作成**: クライアント参加者なしで会議作成 → バリデーションエラーなく作成可能
5. **ボール投げ**: 社内承認後 → ball=client に変更 → クライアントオーナー指定で成功
6. **ラベル確認**: 全画面で新用語（「承認フロー」「承認確認中」「承認待ち」「実行担当」等）に変更されているか目視確認
7. **client_scope**: 新規タスクのデフォルトが `internal` になっているか確認
8. **セクション配置**: Inspector で承認フローがステータス/ボールの直後に表示されるか確認
9. **自動展開**: タスクのステータスを `承認確認中` に変更 → 承認者選択UIが自動展開されるか確認
10. **クイックアクション**: タスク一覧で `承認確認中` かつ承認未依頼のタスクに「承認を依頼」ボタンが表示されるか確認

---

## 関連仕様

- [REVIEW_SPEC.md](./REVIEW_SPEC.md) — レビュー仕様（承認維持要件の根拠）
- [UI_RULES_AND_SCREENS.md](./UI_RULES_AND_SCREENS.md) — UIルール（3ペイン、楽観的更新）
- [API_SPEC_v0.4.md](../api/API_SPEC_v0.4.md) — RPC API仕様
