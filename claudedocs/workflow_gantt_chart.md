# Implementation Workflow: ガントチャートビュー

## Overview

タスクのタイムライン表示を行うガントチャートビューの実装ワークフロー

**機能:**
- タスクの期間表示（created_at → due_date）
- マイルストーンマーカー表示
- ボール所有状態の可視化（client: amber / internal: blue）
- ステータス別の色分け
- ドラッグによる期日変更（将来）

---

## Phase 1: 基盤構築

### 1.1 Views ページ作成
**ファイル:** `src/app/(internal)/[orgId]/project/[spaceId]/views/page.tsx`

**目的:** Viewsランディングページ（ガントチャートへのエントリーポイント）

**実装内容:**
- ビュータイプ選択UI（現時点はガントのみ）
- ガントチャートページへのリンク/リダイレクト

**依存関係:** なし

### 1.2 ガントチャートページ作成
**ファイル:** `src/app/(internal)/[orgId]/project/[spaceId]/views/gantt/page.tsx`

**目的:** ガントチャートビューのページコンポーネント

**実装内容:**
- useTasks, useMilestones フック使用
- GanttChart コンポーネント呼び出し
- ローディング/エラー状態

**依存関係:** 1.1完了後

---

## Phase 2: コアコンポーネント

### 2.1 GanttChart コンポーネント
**ファイル:** `src/components/gantt/GanttChart.tsx`

**目的:** ガントチャートのメインコンポーネント

**Props:**
```typescript
interface GanttChartProps {
  tasks: Task[]
  milestones: Milestone[]
  startDate: Date    // 表示開始日
  endDate: Date      // 表示終了日
  onTaskClick?: (taskId: string) => void
  onDateChange?: (taskId: string, newDueDate: string) => void
}
```

**実装内容:**
- SVGベースのタイムライン描画
- 日付ヘッダー（日/週/月表示切替）
- タスク行レンダリング
- マイルストーンマーカー
- 今日の線（Today Line）

**依存関係:** なし

### 2.2 GanttRow コンポーネント
**ファイル:** `src/components/gantt/GanttRow.tsx`

**目的:** 単一タスクのガントバー表示

**Props:**
```typescript
interface GanttRowProps {
  task: Task
  startDate: Date
  endDate: Date
  rowIndex: number
  onClick?: () => void
}
```

**実装内容:**
- タスクバー描画（SVG rect）
- 色分け:
  - ball=client → Amber-500
  - ball=internal → Blue-500
  - done → Gray-400
- ホバー時のツールチップ
- クリックでInspector連携

**依存関係:** 2.1と並行

### 2.3 GanttHeader コンポーネント
**ファイル:** `src/components/gantt/GanttHeader.tsx`

**目的:** 日付ヘッダー部分

**Props:**
```typescript
interface GanttHeaderProps {
  startDate: Date
  endDate: Date
  viewMode: 'day' | 'week' | 'month'
}
```

**実装内容:**
- 日/週/月の目盛り描画
- 月名/週番号表示
- 土日の背景色

**依存関係:** 2.1と並行

### 2.4 GanttMilestone コンポーネント
**ファイル:** `src/components/gantt/GanttMilestone.tsx`

**目的:** マイルストーンのダイヤモンドマーカー

**Props:**
```typescript
interface GanttMilestoneProps {
  milestone: Milestone
  startDate: Date
  endDate: Date
  yPosition: number
}
```

**実装内容:**
- ダイヤモンド形状のSVGマーカー
- ラベル表示
- ホバーツールチップ

**依存関係:** 2.1と並行

---

## Phase 3: ユーティリティ

### 3.1 日付計算ユーティリティ
**ファイル:** `src/lib/gantt/dateUtils.ts`

**目的:** ガントチャート用の日付計算

**関数:**
```typescript
// 日付からX座標を計算
export function dateToX(date: Date, startDate: Date, endDate: Date, width: number): number

// X座標から日付を計算（ドラッグ用）
export function xToDate(x: number, startDate: Date, endDate: Date, width: number): Date

// 表示範囲の自動計算
export function calcDateRange(tasks: Task[], milestones: Milestone[]): { start: Date; end: Date }

// 日付フォーマット
export function formatDateLabel(date: Date, viewMode: 'day' | 'week' | 'month'): string
```

**依存関係:** なし

### 3.2 ガントチャート設定
**ファイル:** `src/lib/gantt/constants.ts`

**目的:** ガントチャートの定数定義

**内容:**
```typescript
export const GANTT_CONFIG = {
  ROW_HEIGHT: 36,
  HEADER_HEIGHT: 48,
  BAR_HEIGHT: 24,
  BAR_PADDING: 6,
  MIN_BAR_WIDTH: 4,
  COLORS: {
    CLIENT: '#F59E0B',    // Amber-500
    INTERNAL: '#3B82F6',  // Blue-500
    DONE: '#9CA3AF',      // Gray-400
    TODAY: '#EF4444',     // Red-500
    WEEKEND: '#F3F4F6',   // Gray-100
    MILESTONE: '#8B5CF6', // Violet-500
  },
}
```

**依存関係:** なし

---

## Phase 4: 統合

### 4.1 LeftNav更新
**ファイル:** `src/components/layout/LeftNav.tsx`

**目的:** ビューリンクをガントチャートに直接リンク

**変更内容:**
- `/views` → `/views/gantt` に変更（または両方対応）

**依存関係:** Phase 1完了後

### 4.2 Inspectorとの連携
**ファイル:** `src/app/(internal)/[orgId]/project/[spaceId]/views/gantt/page.tsx`

**目的:** タスククリック時にInspectorを開く

**実装内容:**
- URL params `?task=<id>` でInspector連携
- 3ペインレイアウト対応（オプション）

**依存関係:** Phase 2完了後

---

## Phase 5: テスト

### 5.1 ユニットテスト
**ファイル:** `src/__tests__/lib/gantt/dateUtils.test.ts`

**テスト内容:**
- dateToX: 日付→座標変換
- xToDate: 座標→日付変換
- calcDateRange: 範囲自動計算
- エッジケース（空配列、due_date未設定等）

### 5.2 コンポーネントテスト
**ファイル:** `src/__tests__/components/gantt/GanttChart.test.tsx`

**テスト内容:**
- タスクバーの正しいレンダリング
- マイルストーンマーカー表示
- クリックイベント
- 空状態の表示

---

## Execution Order

```
Phase 1: 基盤構築
├─ 1.1 Views ページ作成
└─ 1.2 ガントチャートページ作成

Phase 2: コアコンポーネント (並列可)
├─ 2.1 GanttChart メインコンポーネント
├─ 2.2 GanttRow タスクバー
├─ 2.3 GanttHeader 日付ヘッダー
└─ 2.4 GanttMilestone マーカー

Phase 3: ユーティリティ (Phase 2と並列可)
├─ 3.1 dateUtils
└─ 3.2 constants

Phase 4: 統合
├─ 4.1 LeftNav更新
└─ 4.2 Inspector連携

Phase 5: テスト
├─ 5.1 ユニットテスト
└─ 5.2 コンポーネントテスト
```

---

## 技術仕様

### SVG構造
```
<svg width={totalWidth} height={totalHeight}>
  <!-- 背景グリッド -->
  <g class="grid">
    <rect /> <!-- 週末背景 -->
    <line /> <!-- 縦線（日区切り） -->
  </g>

  <!-- 今日の線 -->
  <line class="today-line" />

  <!-- タスクバー -->
  <g class="tasks">
    <GanttRow /> × n
  </g>

  <!-- マイルストーン -->
  <g class="milestones">
    <GanttMilestone /> × n
  </g>
</svg>
```

### レスポンシブ対応
- 横スクロール対応
- ズームイン/アウト（日/週/月表示切替）
- 最小幅: 800px

### パフォーマンス考慮
- 仮想化は初期実装では不要（100タスク程度を想定）
- 将来的にreact-windowやreact-virtualizedを検討

---

## Quality Gates

### 各Phase完了時チェック
- [ ] TypeScript型エラーなし
- [ ] 全テスト通過
- [ ] ビルド成功

### 最終チェック
- [ ] 3ペインレイアウトとの整合性
- [ ] Amber-500ルール遵守（client visible）
- [ ] ローディング/空状態の表示
- [ ] 横スクロールの動作確認

---

## 将来拡張（Phase 6以降）

### ドラッグ＆ドロップ（準備済み）
- ✅ リサイズハンドル表示（ホバー時）
- ✅ onDragStart/isDraggingコールバック準備
- ⏳ 実際のドラッグ操作でのonDateChange呼び出し（未接続）
- ⏳ onMouseMove/onMouseUp でのリアルタイム更新

### ボール所有時間トラッキング
- task_eventsから所有時間を計算
- バー内での色分け表示

### エクスポート
- PNG/SVGダウンロード
- PDF出力

---

## Files to Create/Modify

| Phase | File | Action |
|-------|------|--------|
| 1.1 | `src/app/(internal)/[orgId]/project/[spaceId]/views/page.tsx` | 新規作成 |
| 1.2 | `src/app/(internal)/[orgId]/project/[spaceId]/views/gantt/page.tsx` | 新規作成 |
| 2.1 | `src/components/gantt/GanttChart.tsx` | 新規作成 |
| 2.2 | `src/components/gantt/GanttRow.tsx` | 新規作成 |
| 2.3 | `src/components/gantt/GanttHeader.tsx` | 新規作成 |
| 2.4 | `src/components/gantt/GanttMilestone.tsx` | 新規作成 |
| 3.1 | `src/lib/gantt/dateUtils.ts` | 新規作成 |
| 3.2 | `src/lib/gantt/constants.ts` | 新規作成 |
| 4.1 | `src/components/layout/LeftNav.tsx` | 修正 |
| 5.1 | `src/__tests__/lib/gantt/dateUtils.test.ts` | 新規作成 |
| 5.2 | `src/__tests__/components/gantt/GanttChart.test.tsx` | 新規作成 |

---

**作成日:** 2026-02-02
**完了日:** 2026-02-02

## Completion Status

### Phase 1: 基盤構築 ✅
- `views/page.tsx` - ガントチャートへリダイレクト
- `views/gantt/page.tsx` - ガントチャートページ
- `views/gantt/GanttPageClient.tsx` - クライアントコンポーネント

### Phase 2: コアコンポーネント ✅
- `GanttChart.tsx` - メインコンポーネント（ツールバー、サイドバー、凡例含む）
  - マイルストーン別グループ表示切り替え機能追加
  - ドラッグ準備（onDragStart/isDraggingコールバック）
  - ヘッダーとボディ分離で垂直方向のズレ修正
- `GanttRow.tsx` - タスクバー（ball色分け、ステータス表示）
  - リサイズハンドル（ホバー時表示）
  - ツールチップ表示
- `GanttHeader.tsx` - 日付ヘッダー（月/日表示、週末背景）
- `GanttMilestone.tsx` - マイルストーンマーカー

### Phase 3: ユーティリティ ✅
- `dateUtils.ts` - 日付計算関数群
- `constants.ts` - 色・サイズ定数

### Phase 4: 統合 ✅
- LeftNav更新（ビュー→ガントチャートリンク）

### Phase 5: テスト ✅
- `dateUtils.test.ts` - 26テスト
- `GanttChart.test.tsx` - 10テスト

### 品質チェック結果
- ✅ 151 tests passed
- ✅ Build successful
