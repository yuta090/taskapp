# クライアントダッシュボード実装ワークフロー

> 作成日: 2024-02-08
> ステータス: 実装待ち

## 概要

クライアントがログイン直後に表示されるダッシュボードページを実装する。
プロジェクトの進捗状況、アクション必要なタスク、マイルストーンを一目で把握できるUIを提供。

---

## ナビゲーション構造

### 決定事項: トップナビゲーション（サイドバーなし）

**理由**:
- クライアントは非技術者（結果志向）
- 選択肢が少ないほど不安が減る
- モバイルファーストで折りたたみやすい
- 「作業場所」ではなく「受信箱」のような体験

### ナビゲーション構成

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [TaskApp]  [プロジェクト ▼]  │  ダッシュボード  要対応  履歴  │  [?] [👤] │
└─────────────────────────────────────────────────────────────────────────────┘

モバイル:
┌─────────────────────────────────────────┐
│ [TaskApp]  [プロジェクト名 ▼]    [≡]   │
└─────────────────────────────────────────┘
```

### メニュー項目

| 項目 | パス | 説明 |
|-----|------|------|
| ダッシュボード | `/portal` | 進捗・アクション・マイルストーン |
| 要対応 | `/portal/tasks` | 確認待ちタスク一覧 |
| 履歴 | `/portal/history` | 承認・フィードバック履歴 |

### プロジェクト切り替え

- 複数プロジェクトに参加している場合のみドロップダウン表示
- 1プロジェクトのみの場合はプロジェクト名のみ表示（切り替えUI不要）

---

## ダッシュボード機能一覧

### 表示順序（決定済み）

| 順位 | 要素 | 目的 |
|-----|------|------|
| 1 | プロジェクトヘルス | 「順調/注意/要対応」を一目で |
| 2 | リスク/期限アラート | 緊急度の理解 |
| 3 | アクション Required | 今やるべきこと（インライン入力付き） |
| 4 | 全体進捗バー | 完了度の把握 |
| 5 | マイルストーン | 今後の見通し |
| 6 | ボール所有レーダー | チームも動いてる安心感 |
| 7 | 最近のアクティビティ | 動きの証拠 |
| 8 | 承認履歴 | 過去の確認（折りたたみ） |

### 遅延表示（責めない表現）

```
📌 ご確認待ちのタスク
以下をご確認いただくと、開発を再開できます
```

---

## デザイントークン（決定済み）

### カラー

| 用途 | Hex | Tailwind |
|-----|-----|----------|
| テキスト | `#0B1220` | `slate-900` |
| サブテキスト | `#4B5563` | `gray-600` |
| ボーダー | `#E5E7EB` | `gray-200` |
| 背景 | `#F7F7F5` | カスタム |
| アクセント | `#F59E0B` | `amber-500` |
| 成功 | `#16A34A` | `green-600` |
| 警告 | `#D97706` | `amber-600` |
| 危険 | `#DC2626` | `red-600` |

### コンポーネント

| 要素 | スタイル |
|-----|---------|
| カード | `border border-gray-200 rounded-xl shadow-sm` |
| アクションカード | `border-l-3 border-l-amber-500` |
| 進捗バー | 6px高さ、pill型 |
| バッジ | 24px高さ、999px角丸 |

### タイポグラフィ

| 用途 | サイズ | ウェイト |
|-----|-------|---------|
| H1 | 24px | 700 |
| H2 | 18px | 600 |
| Body | 14px | 400 |
| Small | 12px | 400 |

---

## 実装フェーズ

### Phase 1: 基盤整備（1日目）

#### Task 1.1: ナビゲーションコンポーネント作成
- [ ] `src/components/portal/PortalHeader.tsx` 作成
- [ ] プロジェクト切り替えドロップダウン
- [ ] モバイル対応メニュー
- [ ] 依存: なし

#### Task 1.2: レイアウトコンポーネント作成
- [ ] `src/components/portal/PortalLayout.tsx` 作成
- [ ] ヘッダー + メインコンテンツ構造
- [ ] 背景色（#F7F7F5）適用
- [ ] 依存: Task 1.1

#### Task 1.3: 共通UIコンポーネント作成
- [ ] `src/components/portal/ui/HealthBadge.tsx` - ヘルスバッジ
- [ ] `src/components/portal/ui/ProgressBar.tsx` - 進捗バー
- [ ] `src/components/portal/ui/ActionCard.tsx` - アクションカード
- [ ] 依存: なし

### Phase 2: ダッシュボードコア（2日目）

#### Task 2.1: ヘルスバッジセクション
- [ ] プロジェクトヘルス計算ロジック
- [ ] 「順調/注意/要対応」判定条件
- [ ] 次のマイルストーン表示
- [ ] 依存: Task 1.3

#### Task 2.2: アラートセクション
- [ ] 期限切れカウント
- [ ] 次の期限表示
- [ ] 「ご確認待ち」表示（責めない表現）
- [ ] 依存: なし

#### Task 2.3: アクション Requiredセクション
- [ ] ball=client タスク取得
- [ ] インラインコメント入力
- [ ] 承認/修正依頼ボタン
- [ ] 依存: Task 1.3

### Phase 3: 進捗・マイルストーン（3日目）

#### Task 3.1: 全体進捗バー
- [ ] 完了タスク / 全タスク 計算
- [ ] 6px プログレスバー実装
- [ ] アニメーション（初回ロード時）
- [ ] 依存: Task 1.3

#### Task 3.2: マイルストーンタイムライン
- [ ] マイルストーン一覧取得
- [ ] 横スクロールタイムライン
- [ ] 完了/進行中/予定のドット表示
- [ ] 依存: なし

#### Task 3.3: ボール所有レーダー
- [ ] クライアント vs チーム タスク数計算
- [ ] スプリットピル UI
- [ ] 依存: なし

### Phase 4: アクティビティ・履歴（4日目）

#### Task 4.1: 最近のアクティビティ
- [ ] クライアント関連の更新のみ抽出
- [ ] 3件表示 + 「もっと見る」
- [ ] 依存: なし

#### Task 4.2: 承認履歴
- [ ] 過去の承認一覧
- [ ] デフォルト折りたたみ
- [ ] 依存: なし

### Phase 5: 追加ページ（5日目）

#### Task 5.1: 要対応ページ（/portal/tasks）
- [ ] ball=client タスク全件表示
- [ ] フィルター（期限、ステータス）
- [ ] 依存: Phase 2完了

#### Task 5.2: 履歴ページ（/portal/history）
- [ ] 承認・コメント履歴
- [ ] 日付フィルター
- [ ] 依存: Task 4.2

### Phase 6: 最終調整（6日目）

#### Task 6.1: レスポンシブ対応
- [ ] モバイル表示確認（320px, 375px, 414px）
- [ ] タブレット表示確認（768px, 1024px）
- [ ] 依存: 全Phase完了

#### Task 6.2: パフォーマンス最適化
- [ ] React Query キャッシュ設定
- [ ] 不要な再レンダリング削減
- [ ] 依存: 全Phase完了

#### Task 6.3: アクセシビリティ
- [ ] キーボードナビゲーション
- [ ] スクリーンリーダー対応
- [ ] prefers-reduced-motion 対応
- [ ] 依存: 全Phase完了

---

## ファイル構成

```
src/
├── app/
│   └── portal/
│       ├── layout.tsx          # ポータルレイアウト
│       ├── page.tsx            # ダッシュボード（リファクタ）
│       ├── tasks/
│       │   └── page.tsx        # 要対応タスク一覧
│       └── history/
│           └── page.tsx        # 承認履歴
│
├── components/
│   └── portal/
│       ├── PortalHeader.tsx    # ヘッダー・ナビ
│       ├── PortalLayout.tsx    # レイアウトラッパー
│       ├── dashboard/
│       │   ├── HealthSection.tsx
│       │   ├── AlertSection.tsx
│       │   ├── ActionSection.tsx
│       │   ├── ProgressSection.tsx
│       │   ├── MilestoneTimeline.tsx
│       │   ├── BallOwnershipRadar.tsx
│       │   ├── ActivityFeed.tsx
│       │   └── ApprovalHistory.tsx
│       └── ui/
│           ├── HealthBadge.tsx
│           ├── ProgressBar.tsx
│           ├── ActionCard.tsx
│           ├── MilestoneDot.tsx
│           └── SplitPill.tsx
│
└── lib/
    └── hooks/
        └── usePortalDashboard.ts  # ダッシュボードデータ取得
```

---

## API / データ取得

### 必要なクエリ

```typescript
// ダッシュボード用データ
interface PortalDashboardData {
  // ヘルス計算用
  health: 'on_track' | 'at_risk' | 'needs_attention'
  healthReason: string

  // アラート
  overdueCount: number
  nextDueDate: string | null
  waitingDays: number // 最長待機日数

  // アクションタスク
  actionTasks: Task[]

  // 進捗
  completedCount: number
  totalCount: number
  progressPercent: number

  // マイルストーン
  milestones: Milestone[]
  currentMilestone: Milestone | null

  // ボール所有
  clientBallCount: number
  teamBallCount: number

  // アクティビティ
  recentActivity: Activity[]

  // 承認履歴
  approvalHistory: Approval[]
}
```

### ヘルス判定ロジック

```typescript
function calculateHealth(data): 'on_track' | 'at_risk' | 'needs_attention' {
  // 要対応: 期限切れが3件以上 or 5日以上待機中のタスクあり
  if (data.overdueCount >= 3 || data.waitingDays >= 5) {
    return 'needs_attention'
  }

  // 注意: 期限切れが1件以上 or 3日以上待機中
  if (data.overdueCount >= 1 || data.waitingDays >= 3) {
    return 'at_risk'
  }

  // 順調
  return 'on_track'
}
```

---

## チェックポイント

### Phase 1 完了条件
- [ ] PortalHeader がレンダリングされる
- [ ] プロジェクト切り替えが動作する
- [ ] モバイルメニューが開閉する

### Phase 2 完了条件
- [ ] ヘルスバッジが正しく表示される
- [ ] アクションカードにインライン入力ができる
- [ ] コメント送信が動作する

### Phase 3 完了条件
- [ ] 進捗バーが正しいパーセントを表示
- [ ] マイルストーンが横並びで表示される
- [ ] ボール所有が正しくカウントされる

### Phase 4 完了条件
- [ ] アクティビティが時系列で表示される
- [ ] 承認履歴が折りたたみで動作する

### Phase 5 完了条件
- [ ] /portal/tasks ページが表示される
- [ ] /portal/history ページが表示される

### Phase 6 完了条件
- [ ] モバイルで崩れない
- [ ] Lighthouse Performance 90+
- [ ] axe アクセシビリティエラー 0

---

## 次のステップ

このワークフローを承認後、`/sc:implement` で Phase 1 から順次実装を開始します。

---

## 参考ドキュメント

- [GitHub連携設計書](../design/GITHUB_MILESTONE_INTEGRATION.md)
- [UI仕様書](../spec/UI_RULES_AND_SCREENS.md)
