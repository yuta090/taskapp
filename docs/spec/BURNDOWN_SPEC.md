# バーンダウンチャート & マイルストーン開始日 仕様書

> **Version**: 1.6
> **Last Updated**: 2026-02-23
> **Status**: 実装済み（Codex Code Reviewer 3回 → APPROVE、completed_at 追跡追加）

---

## 概要

開発者向けバーンダウンチャートを実装し、マイルストーン単位でのタスク消化状況を可視化する。
前提として、マイルストーンに `start_date` を追加し、期間（開始日〜期限日）を明示的に管理する。

### UXフロー

```
[開発者]
  ├─ 1. マイルストーン設定で開始日・期限日を登録
  ├─ 2. タスクをマイルストーンに紐付け
  ├─ 3. Views → バーンダウンタブで進捗確認
  │     ├─ 理想線（均等消化ライン）
  │     ├─ 実績線（日次の残タスク推移）
  │     └─ マイルストーン切り替え
  └─ 4. ガントチャートでもマイルストーン期間を可視化
```

---

## Phase 1: マイルストーン `start_date` 追加

### データモデル変更

#### マイグレーション

```sql
-- マイルストーンに開始日を追加
ALTER TABLE milestones ADD COLUMN start_date date NULL;

-- バリデーション: start_date <= due_date
ALTER TABLE milestones ADD CONSTRAINT milestones_date_order
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);
```

#### パフォーマンス用インデックス

```sql
-- バーンダウン集計クエリ高速化: target_id + event_type でフィルタ
CREATE INDEX IF NOT EXISTS audit_logs_burndown_idx
  ON audit_logs (space_id, target_type, event_type, occurred_at ASC)
  WHERE target_type = 'task';
```

#### 型定義 (`src/types/database.ts`)

```typescript
// milestones.Row に追加
start_date: string | null

// milestones.Insert に追加
start_date?: string | null

// milestones.Update に追加
start_date?: string | null
```

### 改修対象ファイル

| ファイル | 改修内容 | 必須/任意 |
|----------|----------|-----------|
| `src/types/database.ts` | `start_date` フィールド追加 | 必須 |
| `src/lib/hooks/useMilestones.ts` | Input型に `startDate` 追加、CRUD操作対応 | 必須 |
| `src/app/.../settings/MilestonesSettings.tsx` | 開始日入力フィールド追加 | 必須 |
| `src/lib/gantt/dateUtils.ts` | `calcDateRange()` で `start_date` 考慮 | 必須 |
| `src/components/gantt/GanttMilestone.tsx` | 期間バー表示対応（縦線→範囲） | 任意 |
| `src/components/task/MilestoneGroupHeader.tsx` | 期間表示（開始〜期限） | 任意 |
| `packages/mcp-server/.../milestones.ts` | Zodスキーマに `startDate` 追加 | 必須 |
| Portal系（`portal/page.tsx` 等） | select句に `start_date` 追加 | 任意 |

### MilestonesSettings UI改修

現行の「名前 + 期限」フォームに「開始日」を追加する。

```
[新規マイルストーン]
├─ 名前: [________________]
├─ 開始日: [____-__-__]    ← 新規追加
├─ 期限:   [____-__-__]
└─ [追加]

[一覧 - 編集モード]
├─ [名前入力] [開始日入力] [期限入力] [✓] [✗]
```

バリデーション:
- `start_date > due_date` の場合はエラー表示
- 両方 null は許容（未設定マイルストーン）
- 片方だけ設定も許容

### useMilestones Hook 改修

```typescript
interface CreateMilestoneInput {
  name: string
  startDate?: string | null  // 追加
  dueDate?: string | null
}

interface UpdateMilestoneInput {
  name?: string
  startDate?: string | null  // 追加
  dueDate?: string | null
  orderKey?: number
}
```

### dateUtils 改修

```typescript
// calcDateRange() にマイルストーン start_date チェック追加
milestones.forEach((milestone) => {
  if (milestone.start_date) {
    const start = new Date(milestone.start_date)
    start.setHours(0, 0, 0, 0)
    if (start < minDate) {
      minDate = new Date(start)
      minDate.setDate(minDate.getDate() - padding)
    }
  }
  if (milestone.due_date) {
    const due = new Date(milestone.due_date)
    due.setHours(0, 0, 0, 0)
    if (due > maxDate) maxDate = due
  }
})
```

---

## Phase 1.5: 監査ログ整備（バーンダウン前提条件）

### 現状の課題

コード調査の結果、以下が判明:

- `audit_logs` テーブルは `event_type: 'task.status_changed'` をサポート
- `data_before` / `data_after` (JSONB) でステータス変更前後を記録可能
- **しかし現状、内部ユーザーのステータス変更時に `createAuditLog()` が呼ばれていない**
  - `src/lib/hooks/useTasks.ts` の `updateTask()` は通知のみ発火
  - `createAuditLog()` は Portal API (`src/app/api/portal/tasks/[taskId]/route.ts`) でのみ使用

### バーンダウンが使用するイベント一覧（正規リスト）

以下の4イベントのみを集計に使用する。これが唯一の正規リストである。

| event_type | 用途 | `data_before` | `data_after` | デルタ処理 |
|------------|------|---------------|--------------|-----------|
| `task.status_changed` | ステータス変遷 | `{ status: string }` | `{ status: string }` | done化: remaining-1, done解除: remaining+1 |
| `task.created` | タスク新規追加 | なし | `{ milestone_id: string }` | 期間内作成: added+1, remaining+1 |
| `task.updated` | MS付け替え | `{ milestone_id: string\|null }` | `{ milestone_id: string\|null }` | IN: remaining+1, OUT: remaining-1 |
| `task.deleted` | タスク削除 | `{ milestone_id: string\|null }` | なし | remaining-1（完了扱いしない） |

### 必要な監査ログ生成箇所

以下の全箇所で `createAuditLog()` を fire-and-forget で呼び出す。

| 生成箇所 | event_type | 現状 | 対応 |
|----------|-----------|------|------|
| `src/lib/hooks/useTasks.ts` - `updateTask()` ステータス変更 | `task.status_changed` | 通知のみ | **追加必要** |
| `src/lib/hooks/useTasks.ts` - `updateTask()` MS付替 | `task.updated` | なし | **追加必要** |
| `src/lib/hooks/useTasks.ts` - `createTask()` | `task.created` | なし | **追加必要** |
| `src/lib/hooks/useTasks.ts` - `deleteTask()` | `task.deleted` | なし | **追加必要** |
| `src/app/api/portal/tasks/[taskId]/route.ts` - 承認 | `task.status_changed` | 記録済み | 変更不要 |
| Gantt のドラッグ操作 | `task.status_changed` | なし | **追加必要**（`useTasks.updateTask` 経由なら自動） |

#### コード例

```typescript
// src/lib/hooks/useTasks.ts

// --- ステータス変更 ---
if (input.status !== undefined && prevTask && prevTask.status !== input.status) {
  fireNotification({ event: 'status_changed', taskId, spaceId, ... })
  void createAuditLog({
    supabase, orgId: prevTask.org_id, spaceId,
    actorId: userId, actorRole: 'member',
    eventType: 'task.status_changed',
    targetType: 'task', targetId: taskId,
    dataBefore: { status: prevTask.status },
    dataAfter: { status: input.status },
  })
}

// --- マイルストーン付け替え ---
if (input.milestoneId !== undefined && prevTask?.milestone_id !== input.milestoneId) {
  void createAuditLog({
    supabase, orgId: prevTask.org_id, spaceId,
    actorId: userId, actorRole: 'member',
    eventType: 'task.updated',
    targetType: 'task', targetId: taskId,
    dataBefore: { milestone_id: prevTask.milestone_id },
    dataAfter: { milestone_id: input.milestoneId },
  })
}

// --- タスク作成（createTask 内） ---
void createAuditLog({
  supabase, orgId, spaceId,
  actorId: userId, actorRole: 'member',
  eventType: 'task.created',
  targetType: 'task', targetId: newTask.id,
  dataAfter: { milestone_id: newTask.milestone_id },
})

// --- タスク削除（deleteTask 内） ---
void createAuditLog({
  supabase, orgId: prevTask.org_id, spaceId,
  actorId: userId, actorRole: 'member',
  eventType: 'task.deleted',
  targetType: 'task', targetId: taskId,
  dataBefore: { milestone_id: prevTask.milestone_id },
})
```

**影響**: 既存の `audit_logs` インフラを活用するため新テーブル不要。
**制約**: マイグレーション日以前の履歴は存在しない（後述の「履歴データの制約」参照）。

---

## Phase 2: バーンダウンチャート

### データソース設計

#### 使用テーブル: `audit_logs`（`task_events` ではない）

```
audit_logs テーブル:
├─ event_type: 正規リスト4種（Phase 1.5 参照）
├─ target_type: 'task'
├─ target_id: uuid (task.id)
├─ data_before: { status: '...' } / { milestone_id: '...' }
├─ data_after: { status: '...' } / { milestone_id: '...' }
├─ occurred_at: timestamptz
└─ space_id: uuid
```

**選定理由**:
- `data_before` / `data_after` で変更前後が明示的（`task_events.payload` は構造未定義）
- `event_type` で正確にフィルタ可能
- 既存のインデックス `audit_logs_event_idx` が利用可能

#### 方式: API Route でサーバーサイド集計

```
GET /api/burndown?spaceId={spaceId}&milestoneId={milestoneId}
```

**パラメータ仕様**:

| パラメータ | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `spaceId` | 必須 | uuid | スペースID |
| `milestoneId` | 必須 | uuid | マイルストーンID |

**milestoneId は必須**。「全タスク表示」モードは Phase 1 ではサポートしない。
理由: マイルストーン未選択時の「期間」が定義できない（start_date / due_date がない）。

**日付 null の挙動**:

| 状態 | 挙動 |
|------|------|
| `start_date = null, due_date = null` | 400 エラー「開始日と期限を設定してください」 |
| `start_date = null, due_date あり` | `start_date` = マイルストーン `created_at` の日付をフォールバック |
| `start_date あり, due_date = null` | `due_date` = 今日 + 14日をフォールバック |
| 両方あり | そのまま使用 |

**理由**:
- 監査ログの全件をクライアントに送るのは非効率
- サーバーで日次集計して軽量なJSONを返す
- RPC化も可能だが、Phase 2 ではAPI Routeで十分

#### API 認証・認可

```typescript
// route.ts
const supabase = await createClient()  // サーバーサイド Supabase クライアント
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// RLS で space_memberships を通じてアクセス制御
// audit_logs の既存 RLS ポリシーが適用される
```

#### レスポンス型

```typescript
interface BurndownData {
  milestoneId: string
  milestoneName: string
  startDate: string        // YYYY-MM-DD（ローカルタイムゾーン）
  endDate: string          // YYYY-MM-DD (due_date)
  totalTasks: number       // 期間開始時点のMS所属タスク総数（done含む）
  dataAvailableFrom: string | null  // 監査ログの最古日（制約表示用）
  dailySnapshots: DailySnapshot[]
}

interface DailySnapshot {
  date: string             // YYYY-MM-DD
  remaining: number        // 残タスク数（done以外）
  completed: number        // 累計完了数
  added: number            // その日に追加されたタスク数
  reopened: number         // done → 非done に戻されたタスク数
}
```

### 日付・タイムゾーン仕様

| 項目 | 仕様 |
|------|------|
| 日次バケット | `Asia/Tokyo` の `00:00:00` 〜 `23:59:59.999` |
| スナップショット基準 | **end-of-day**（その日の終了時点の状態） |
| `start_date` / `due_date` | `date` 型（タイムゾーンなし）、表示はローカル |
| API内の変換 | `occurred_at` (timestamptz) → JST変換して日付バケットに割当 |
| 日付フォーマット | `formatDateToLocalString()` 使用（`toISOString()` 禁止） |

```typescript
// API Route 内での日付バケット変換
function toJSTDateString(timestamptz: string): string {
  const date = new Date(timestamptz)
  // JST = UTC+9
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const y = jstDate.getUTCFullYear()
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jstDate.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

### 集計ロジック（詳細）

#### 設計原則

1. **所属状態の追跡**: `membershipSet` で「対象MSに所属しているタスクID」を管理
2. **ステータスは全タスク追跡**: `statusMap` は membershipSet の内外を問わず全タスクのステータスを常に最新に保つ（MS IN 時に正しい状態を参照するため）
3. **remaining へのデルタは所属タスクのみ**: `task.status_changed` の remaining 増減は `membershipSet` 内のタスクのみ
4. **ログ取得範囲**: start_date 以前も含めて全期間取得し、初日状態を正確に構築
5. **done流入の考慮**: MS INしたタスクが done の場合は `remaining` に加算しない

#### クエリ戦略: イベントタイムラインベース + 所属状態管理

```typescript
async function computeBurndown(
  supabase: SupabaseClient,
  spaceId: string,
  milestoneId: string
): Promise<BurndownData> {

  // 1. マイルストーン情報取得
  const milestone = await getMilestone(supabase, milestoneId)
  const { start_date, due_date } = milestone

  // 2. 対象タスクIDの収集（現在 + 過去の所属タスク両方）
  const currentTasks = await getTasksByMilestone(supabase, spaceId, milestoneId)
  const historicalTaskIds = await getHistoricalMilestoneTaskIds(supabase, spaceId, milestoneId)
  const allTaskIds = union(currentTasks.map(t => t.id), historicalTaskIds)

  // 3. 全対象タスクの情報を取得
  const allTasks = await getTasksByIds(supabase, allTaskIds)

  // 4. 監査ログを【全期間】取得（start_date以前も含む）
  //    → 初日の所属状態・ステータスを正確に逆算するため
  //    event_type IN ('task.status_changed', 'task.created', 'task.updated', 'task.deleted')
  //    target_id IN (allTaskIds)
  //    ORDER BY occurred_at ASC
  const allAuditLogs = await getAuditLogs(supabase, spaceId, allTaskIds, null /* 全期間 */)

  // 5. 初日の状態を構築（イベントを start_date まで適用）
  //    各タスクについて:
  //    - 作成イベントからMS所属を開始
  //    - task.updated でMS変更を追跡
  //    - task.status_changed でステータスを追跡
  //    - start_date 時点の { membership, status } を確定
  const initialState = buildStateAtDate(allTasks, allAuditLogs, milestoneId, start_date)
  // initialState: Map<taskId, { inMilestone: boolean, status: string }>

  // 所属状態セット: 「現在このMSに所属しているタスクID」のセット
  const membershipSet = new Set<string>()
  // ステータス追跡: 全タスクの現在ステータス（MS内外を問わず追跡）
  // → MS外で done になったタスクが後で IN した場合に正しく判定するため
  const statusMap = new Map<string, string>()

  for (const [taskId, state] of initialState) {
    // ★ 全タスクのステータスを追跡（membershipSet 外も）
    statusMap.set(taskId, state.status)
    if (state.inMilestone) {
      membershipSet.add(taskId)
    }
  }

  // remaining = MS所属タスクのうち done 以外
  let remaining = [...membershipSet].filter(id => statusMap.get(id) !== 'done').length
  // totalTasks = MS所属タスクの総数（done 含む）
  const totalTasks = membershipSet.size
  let totalCompleted = 0

  // 6. start_date 以降のイベントのみフィルタ
  //    ★ 境界ルール: buildStateAtDate() は start_date の「前日末」までを処理
  //       periodLogs は start_date 当日以降を処理（二重適用なし）
  //       buildStateAtDate の内部条件: toJSTDateString(e.occurred_at) < start_date
  const periodLogs = allAuditLogs.filter(e => toJSTDateString(e.occurred_at) >= start_date)

  // 7. 日次集計
  const snapshots: DailySnapshot[] = []
  let currentDate = start_date

  while (currentDate <= today && currentDate <= due_date) {
    const dayEvents = filterEventsByDay(periodLogs, currentDate)

    let completedToday = 0
    let reopenedToday = 0
    let addedToday = 0

    for (const event of dayEvents) {
      const taskId = event.target_id

      switch (event.event_type) {
        case 'task.status_changed': {
          const oldStatus = event.data_before?.status
          const newStatus = event.data_after?.status

          // ★ statusMap は常に更新（MS外タスクも追跡）
          // → 後で MS IN した時に正しいステータスを参照するため
          statusMap.set(taskId, newStatus)

          // ★ remaining への影響は MS所属タスクのみ
          if (!membershipSet.has(taskId)) break

          if (newStatus === 'done' && oldStatus !== 'done') {
            completedToday++
          }
          if (oldStatus === 'done' && newStatus !== 'done') {
            reopenedToday++
          }
          break
        }

        case 'task.created': {
          if (event.data_after?.milestone_id === milestoneId) {
            membershipSet.add(taskId)
            const taskStatus = event.data_after?.status || 'backlog'
            statusMap.set(taskId, taskStatus)
            // ★ done 以外の場合のみ remaining に加算
            if (taskStatus !== 'done') {
              addedToday++
            }
          }
          break
        }

        case 'task.updated': {
          const fromMs = event.data_before?.milestone_id
          const toMs = event.data_after?.milestone_id

          // MS付け替え IN
          if (toMs === milestoneId && fromMs !== milestoneId) {
            membershipSet.add(taskId)
            // ★ statusMap は常に最新を保持しているので直接参照
            //   （MS外の status_changed も statusMap を更新済み）
            const currentStatus = statusMap.get(taskId) || 'backlog'
            if (currentStatus !== 'done') {
              addedToday++
            }
            // done の場合は membershipSet には入るが remaining は不変
          }

          // MS付け替え OUT
          if (fromMs === milestoneId && toMs !== milestoneId) {
            const wasRemaining = statusMap.get(taskId) !== 'done'
            membershipSet.delete(taskId)
            if (wasRemaining) {
              remaining--
            }
          }
          break
        }

        case 'task.deleted': {
          if (membershipSet.has(taskId)) {
            const wasRemaining = statusMap.get(taskId) !== 'done'
            membershipSet.delete(taskId)
            if (wasRemaining) {
              remaining--
            }
          }
          break
        }
      }
    }

    remaining = remaining - completedToday + reopenedToday + addedToday
    totalCompleted += completedToday - reopenedToday

    snapshots.push({
      date: currentDate,
      remaining: Math.max(0, remaining),
      completed: totalCompleted,
      added: addedToday,
      reopened: reopenedToday,
    })

    currentDate = nextDay(currentDate)
  }

  // 8. データ利用可能日
  const dataAvailableFrom = allAuditLogs.length > 0
    ? toJSTDateString(allAuditLogs[0].occurred_at)
    : null

  return { milestoneId, milestoneName: milestone.name, startDate: start_date,
           endDate: due_date, totalTasks, dataAvailableFrom, dailySnapshots: snapshots }
}
```

#### `buildStateAtDate()` — 初日状態の構築

```typescript
/**
 * start_date の「前日末」時点での各タスクの所属状態とステータスを構築する。
 *
 * ★ 境界ルール（二重適用防止）:
 *    - この関数は toJSTDateString(occurred_at) < start_date のイベントのみ処理
 *    - start_date 当日のイベントは日次集計ループ（periodLogs）で処理
 *    - これにより、start_date 当日のイベントが二重に適用されることはない
 *
 * 手順:
 * 1. 全タスクの初期状態を「現在の状態」で初期化（フォールバック）
 * 2. start_date より前（< start_date）の監査ログを occurred_at ASC で適用
 *    - task.created: 作成時のMS所属とステータスを記録
 *    - task.updated: MS付替を反映
 *    - task.status_changed: ステータスを更新
 *    - task.deleted: 所属解除
 * 3. 最終的な状態が start_date 開始時点（前日末）のスナップショット
 *
 * 監査ログが start_date 以前に存在しない場合:
 * → 現在のタスク状態をそのままフォールバック（推定値）
 */
function buildStateAtDate(
  allTasks: Task[],
  allAuditLogs: AuditLog[],
  milestoneId: string,
  targetDate: string
): Map<string, { inMilestone: boolean; status: string }>
```

### エッジケース対応表

| ケース | 使用イベント | デルタ処理 | 所属状態 |
|--------|------------|-----------|---------|
| **非done → done（完了）** | `task.status_changed` | `remaining` -1、`completed` +1 | membershipSet 内のみ処理 |
| **done → 非done（再オープン）** | `task.status_changed` | `remaining` +1、`reopened` +1 | membershipSet 内のみ処理 |
| **MS外タスクのステータス変更** | `task.status_changed` | `statusMap` は更新、**remaining は不変** | `membershipSet.has(taskId) === false` → remaining skip |
| **同日に複数回ステータス変更** | `task.status_changed` ×N | 各イベントを `occurred_at ASC` で順次処理 | — |
| **MS付替 IN（done以外）** | `task.updated` | `remaining` +1、`added` +1 | `membershipSet.add(taskId)` |
| **MS付替 IN（done状態）** | `task.updated` | `remaining` 不変（加算しない） | `membershipSet.add(taskId)` のみ |
| **MS付替 OUT** | `task.updated` | done以外なら `remaining` -1 | `membershipSet.delete(taskId)` |
| **タスク新規作成（done以外）** | `task.created` | `remaining` +1、`added` +1 | `membershipSet.add(taskId)` |
| **タスク新規作成（done状態）** | `task.created` | `remaining` 不変 | `membershipSet.add(taskId)` のみ |
| **タスク削除** | `task.deleted` | done以外なら `remaining` -1 | `membershipSet.delete(taskId)` |
| **期間前に作成・期間中に完了** | — | 初日の `remaining` に含まれ、完了日に減算 | buildStateAtDate で構築 |
| **期間中に作成・期間外に完了** | `task.created` | `added` にカウント、期間内では `remaining` のまま | — |
| **監査ログなし（履歴不足）** | — | 現在のタスク状態をフォールバック（推定値） | buildStateAtDate のフォールバック |
| **start_date / due_date が null** | — | API パラメータ仕様に従いフォールバック or 400 エラー | — |
| **タスク0件** | — | 空のチャート + メッセージ「タスクがありません」 | membershipSet = 空 |

### 履歴データの制約

```
制約: 監査ログ記録はマイグレーション日以降のみ正確。
      それ以前のステータス変更履歴は存在しない。

対応方針:
├─ 1. dataAvailableFrom フィールドで最古の監査ログ日付を返す
├─ 2. チャート上に「データ取得開始日」を薄い縦線で表示
├─ 3. データなし期間はフォールバック:
│     現在のタスクステータスから start_date 時点の状態を推定
│     （done タスクは done のまま、それ以外は remaining）
└─ 4. ツールチップに「推定値」と表示
```

### コンポーネント構成

```
src/
├── app/(internal)/[orgId]/project/[spaceId]/views/burndown/
│   ├── page.tsx                 # サーバーコンポーネント（ルーティング）
│   └── BurndownPageClient.tsx   # クライアントコンポーネント
├── components/burndown/
│   ├── BurndownChart.tsx        # SVGチャート本体
│   ├── BurndownTooltip.tsx      # ホバー時のツールチップ
│   └── BurndownControls.tsx     # マイルストーン選択・表示切替
├── lib/
│   ├── hooks/
│   │   └── useBurndown.ts       # データ取得Hook
│   └── burndown/
│       └── constants.ts         # チャート設定・色定義
└── app/api/burndown/
    └── route.ts                 # 集計API
```

### ルーティング

```
/(internal)/[orgId]/project/[spaceId]/views/burndown
```

Views ページ (`views/page.tsx`) のデフォルトリダイレクトは Gantt のまま維持。
Views 内にタブ切り替え UI を追加して Gantt ↔ Burndown を切り替え可能にする。

```
[Views]
├─ [ガントチャート] ← 既存
├─ [バーンダウン]   ← 新規
└─ (将来: ベロシティ等)
```

### BurndownChart SVG 設計

カスタム SVG で実装する（Gantt と同じアプローチ、外部ライブラリ不要）。

```
┌─────────────────────────────────────────────────┐
│  Sprint 1 バーンダウン                    [▼ MS選択] │
├─────────────────────────────────────────────────┤
│ 20│ ╲                                           │
│   │  ╲ ← 理想線（グレー破線）                     │
│ 15│   ╲                                         │
│   │    ●──●                                     │
│ 10│        ╲  ●──●──●                           │
│   │    理想線╲       ╲                           │
│  5│          ╲  実績線●──●                       │
│   │           ╲          ╲                       │
│  0│────────────────────────●─────────────────────│
│   │ 2/1  2/3  2/5  2/7  2/9  2/11  2/13  2/15  │
│   └─────────────────────────────────────────────│
│   残: 3タスク / 20タスク (85%完了)    今日: 2/14  │
└─────────────────────────────────────────────────┘
```

#### SVG要素

| 要素 | 描画方法 | 色 |
|------|----------|-----|
| 理想線 | `<line>` 破線 | `#9CA3AF` (Gray-400) |
| 実績線 | `<polyline>` + `<circle>` 各点 | `#3B82F6` (Blue-500) |
| 追加タスク帯 | `<rect>` 積み上げ | `#F59E0B` (Amber-500, 20%透過) |
| 今日線 | `<line>` 実線 | `#EF4444` (Red-500) |
| グリッド | `<line>` 薄線 | `#E2E8F0` (Slate-200) |
| ホバー点 | `<circle>` 拡大 | Blue-500 |

#### レイアウト定数 (`burndown/constants.ts`)

```typescript
export const BURNDOWN_CONFIG = {
  // レイアウト
  CHART_HEIGHT: 320,
  CHART_PADDING: { top: 20, right: 20, bottom: 40, left: 50 },
  POINT_RADIUS: 4,
  POINT_RADIUS_HOVER: 6,

  // 色（GANTT_CONFIGと統一）
  COLORS: {
    IDEAL_LINE: '#9CA3AF',      // Gray-400
    ACTUAL_LINE: '#3B82F6',     // Blue-500
    ACTUAL_FILL: '#DBEAFE',     // Blue-100（実績線下の塗り）
    ADDED_TASKS: '#FEF3C7',     // Amber-100（追加タスク帯）
    TODAY: '#EF4444',           // Red-500
    GRID: '#E2E8F0',           // Slate-200
    POINT: '#3B82F6',          // Blue-500
    POINT_HOVER: '#1D4ED8',    // Blue-700
  },

  // 表示
  GRID_LINES_Y: 5,              // Y軸グリッド分割数
  DATE_LABEL_SKIP: 2,           // 日付ラベル表示間隔（日）
} as const
```

### useBurndown Hook

```typescript
interface UseBurndownOptions {
  spaceId: string
  milestoneId: string | null
}

interface UseBurndownReturn {
  data: BurndownData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useBurndown({ spaceId, milestoneId }: UseBurndownOptions): UseBurndownReturn
```

### BurndownControls

```typescript
interface BurndownControlsProps {
  milestones: Milestone[]
  selectedMilestoneId: string | null
  onSelectMilestone: (id: string | null) => void
}
```

機能:
- マイルストーン選択ドロップダウン
- 期間表示（選択中のマイルストーンの start_date 〜 due_date）
- 進捗サマリー（残タスク数 / 総数、完了率%）

### BurndownTooltip

ホバー時に表示:
```
2/14 (金)
残: 5タスク
完了: +2
追加: +1
```

---

## Phase 2.5: タスク・マイルストーン完了日時追跡 (`completed_at`)

> **実装済み**: 2026-02-23
> **DDL**: `docs/db/DDL_v0.7_completed_at.sql`
> **マイグレーション**: `supabase/migrations/20260223_000_completed_at_tracking.sql`

### 背景

バーンダウンチャートの velocity 計算やリスク分析で、タスクの完了日時が必要だが `completed_at` カラムが存在せず `updated_at` で代用していた。完了後の編集（actual_hours 入力等）で `updated_at` が更新されるため不正確だった。

また、マイルストーンの予定日 (`due_date`) に対し、実際に全タスクが完了した日時を保持する仕組みがなかった。

### データモデル変更

#### tasks テーブル

```sql
ALTER TABLE tasks ADD COLUMN completed_at timestamptz NULL;
-- Auto-managed by trigger: set when status → 'done', cleared when leaving 'done'
```

#### milestones テーブル

```sql
ALTER TABLE milestones ADD COLUMN completed_at timestamptz NULL;
-- Auto-managed by trigger: set when all tasks are 'done' (count > 0),
-- cleared when any task leaves 'done' or milestone becomes empty
```

#### 型定義 (`src/types/database.ts`)

```typescript
// tasks.Row / milestones.Row に追加
completed_at: string | null

// tasks.Insert / milestones.Insert に追加
completed_at?: string | null

// tasks.Update / milestones.Update に追加
completed_at?: string | null
```

### DBトリガー設計

| トリガー | テーブル | タイミング | 動作 |
|---------|---------|----------|------|
| `trg_task_completed_at` | tasks | BEFORE UPDATE | `done` → `completed_at = now()`、`done` 以外 → `NULL` |
| `trg_task_completed_at_insert` | tasks | BEFORE INSERT | `status='done'` で作成時 → `completed_at = now()` |
| `trg_check_milestone_completion` | tasks | AFTER INSERT/UPDATE/DELETE | ヘルパー関数で所属マイルストーンを再チェック |

#### マイルストーン完了判定ロジック (`check_and_update_milestone`)

```
入力: milestone_id
  ↓
タスク数カウント: total, done_count
  ↓
  ├─ total = 0 → completed_at = NULL (0タスクのMSは自動完了しない)
  ├─ total = done_count AND completed_at IS NULL → completed_at = now()
  ├─ total ≠ done_count AND completed_at IS NOT NULL → completed_at = NULL
  └─ それ以外 → 変更なし (冪等)
```

**エッジケース対応**:

| ケース | 動作 |
|--------|------|
| タスクを `done` に変更 | `tasks.completed_at = now()`、マイルストーン再チェック |
| タスクを `done` → `in_progress` に戻す | `tasks.completed_at = NULL`、`milestones.completed_at = NULL` |
| タスクのマイルストーンを変更 | 旧・新の両方のマイルストーンを再チェック |
| マイルストーンからタスクを全削除 | `milestones.completed_at = NULL` |
| 2タスク同時に `done` 更新 | 各トリガーが `count()` で判定するため最終的に正しく収束 |

### 改修対象ファイル

| ファイル | 改修内容 |
|---------|----------|
| `src/types/database.ts` | tasks/milestones に `completed_at` 追加 |
| `src/lib/hooks/useTasks.ts` | 楽観更新に `completed_at` 追加 + `milestone.completed` 監査ログ発行 |
| `src/lib/hooks/useMilestones.ts` | 楽観更新に `completed_at: null` 追加、`useMemo` → `useRef` 修正 |
| `src/lib/risk/calculateRisk.ts` | velocity計算で `completed_at` を使用（`updated_at` フォールバック付き） |
| `src/lib/estimation/findSimilarTasks.ts` | 完了日に `completed_at` を使用 |
| `src/app/portal/page.tsx` | phantom `milestones.status` → `completed_at` ベースに修正 |
| `src/app/portal/history/page.tsx` | 完了タスク表示で `completed_at` を使用 |
| `src/components/task/MilestoneGroupHeader.tsx` | 完了マイルストーンに緑チェック + 「完了」バッジ |
| `src/components/task/TaskInspector.tsx` | `status='done'` 時に完了日を表示 |
| `src/app/.../settings/MilestonesSettings.tsx` | 設定画面に完了バッジ表示 |

### 監査ログ連携

タスクが `done` になった際、所属マイルストーンの `completed_at` を確認し、セットされていれば `milestone.completed` 監査ログを fire-and-forget で発行する。イベント定義は `src/lib/audit.ts` に既存。

### バックフィル

マイグレーション時に既存データをバックフィル:
- `tasks`: `status='done'` のレコードに `completed_at = updated_at` をセット
- `milestones`: 全タスクが `done` のマイルストーンに `completed_at = max(tasks.updated_at)` をセット

---

## Phase 3: 拡張（将来）

| 機能 | 説明 | 優先度 |
|------|------|--------|
| ストーリーポイント | `tasks.story_points` カラム追加、Y軸切替 | Medium |
| ベロシティチャート | マイルストーン間の消化速度比較 | Medium |
| バーンアップチャート | 完了数の累積表示（スコープ変更可視化） | Low |
| CSVエクスポート | チャートデータのダウンロード | Low |

---

## 画面設計

> **画面設計は `/sc:design` または `ui-ux-pro-max` skill を使用して実施する。**
> 本仕様書のワイヤーフレームは方向性の確認用であり、
> 最終的なUI/UXデザインは skill を通じて Linear/Notion 品質で仕上げる。

対象画面:
1. **MilestonesSettings** — 開始日フィールド追加
2. **BurndownPageClient** — チャート本体 + コントロール
3. **Views タブ切替** — Gantt ↔ Burndown ナビゲーション
4. **GanttMilestone** — 期間バー表示（任意）

---

## 実装順序

```
Phase 1: マイルストーン start_date
  Step 1: DB マイグレーション（start_date 追加 + CHECK制約）
    ↓
  Step 2: 型定義 + Hook 改修（useMilestones）
    ↓
  Step 3: MilestonesSettings UI（開始日入力）← skill で画面設計
    ↓
  Step 4: dateUtils + GanttMilestone 改修（期間対応）

Phase 1.5: 監査ログ整備
  Step 5: useTasks.ts にステータス変更 + MS付替の監査ログ追加
    ↓
  Step 6: 検証（手動でステータス変更 → audit_logs に記録確認）

Phase 2: バーンダウンチャート
  Step 7: バーンダウン API Route（/api/burndown）+ 集計ロジック
    ↓
  Step 8: 集計ロジックのユニットテスト（7シナリオ）
    ↓
  Step 9: useBurndown Hook
    ↓
  Step 10: BurndownChart SVG コンポーネント ← skill で画面設計
    ↓
  Step 11: BurndownPageClient + ルーティング
    ↓
  Step 12: Views タブ切替 UI
```

---

## 非機能要件

| 項目 | 要件 |
|------|------|
| パフォーマンス | API レスポンス p95 < 500ms（ベンチマーク: 200タスク × 60日、audit_logs 1万件以下） |
| レスポンシブ | チャートは横スクロールなし、コンテナ幅に追従 |
| アクセシビリティ | ツールチップはキーボードフォーカス対応 |
| タイムゾーン | `formatDateToLocalString` 使用（`toISOString()` 禁止） |
| 既存機能影響 | `start_date` は nullable、既存マイルストーンは無影響 |

---

## テスト方針

### ユニットテスト: 集計ロジック

`computeBurndown()` の純粋関数部分を抽出してテストする。

#### テストフィクスチャ（7シナリオ）

**Scenario 1: 正常バーンダウン**
```
タスク: A(todo), B(in_progress), C(done), D(todo) — 開始時 remaining=3
期間: 2/1〜2/7
イベント:
  2/2: A → done
  2/4: B → done
  2/6: D → done
期待: [3, 2, 2, 1, 1, 0, 0]
```

**Scenario 2: スコープ増加（タスク追加）**
```
タスク: A(todo), B(todo) — 開始時 remaining=2
期間: 2/1〜2/5
イベント:
  2/2: A → done
  2/3: タスクC 新規作成（milestone_id付き）
期待: remaining=[2, 1, 2, 2, 2], added=[0, 0, 1, 0, 0]
```

**Scenario 3: 再オープン**
```
タスク: A(todo), B(todo) — 開始時 remaining=2
期間: 2/1〜2/5
イベント:
  2/2: A → done
  2/4: A → in_progress（再オープン）
期待: remaining=[2, 1, 1, 2, 2], reopened=[0, 0, 0, 1, 0]
```

**Scenario 4: マイルストーン付け替え**
```
タスク: A(todo), B(todo) — 開始時 remaining=2
期間: 2/1〜2/5
イベント:
  2/3: タスクC の milestone_id が別 → 対象MS に変更
  2/4: タスクA の milestone_id が対象MS → 別 に変更
期待: remaining=[2, 2, 3, 2, 2]
```

**Scenario 5: MS OUT 後のステータス変更は無視**
```
タスク: A(todo), B(todo) — 開始時 remaining=2
期間: 2/1〜2/5
イベント:
  2/2: A の milestone_id が対象MS → 別MS（OUT）
  2/3: A → done（MS外でのステータス変更）
期待: remaining=[2, 1, 1, 1, 1]
  ※ 2/2 で A が OUT → remaining=1
  ※ 2/3 の A→done は membershipSet 外なので無視
```

**Scenario 6: done 状態で MS IN**
```
タスク: A(todo) — 開始時 remaining=1
タスク: B(done, 別MS所属)
期間: 2/1〜2/5
イベント:
  2/3: B の milestone_id が別MS → 対象MS（IN, done状態）
期待: remaining=[1, 1, 1, 1, 1]
  ※ B は done なので remaining に加算しない
```

**Scenario 7: イベントなし（空のスプリント）**
```
タスク: なし
期間: 2/1〜2/5
期待: remaining=[0, 0, 0, 0, 0], totalTasks=0
UI: 「タスクがありません」メッセージ表示
```

### その他のテスト

| 対象 | テスト種別 | 内容 |
|------|-----------|------|
| `toJSTDateString()` | Unit | UTC → JST 変換（日跨ぎケース含む） |
| useBurndown | Unit | データ取得・エラーハンドリング・milestoneId null |
| BurndownChart | Snapshot | SVG描画の一貫性 |
| MilestonesSettings | Integration | 開始日の CRUD、日付バリデーション |
| API Route 認証 | Integration | 未認証 → 401、別スペース → 空データ |

### 受入基準

| 基準 | 検証方法 |
|------|----------|
| マイルストーンに開始日を設定できる | Settings UI で開始日入力 → DB に保存される |
| start_date > due_date はエラー | フォームでバリデーションエラー表示 |
| バーンダウンチャートが表示される | Views → バーンダウンタブ → SVGチャート描画 |
| 理想線と実績線が正しい | Scenario 1〜4 のフィクスチャで期待値一致 |
| 再オープンが反映される | Scenario 3 で remaining が増加 |
| MS外ステータス変更が無視される | Scenario 5 で remaining 不変 |
| done流入が remaining に加算されない | Scenario 6 で remaining 不変 |
| タスク0件で空状態表示 | Scenario 7 でメッセージ表示 |
| API p95 < 500ms | 200タスク × 60日 × audit_logs 1万件のデータセットで `time curl` 計測、5回計測の p95 |
| 履歴制約が表示される | dataAvailableFrom 以前の期間に注釈表示 |
