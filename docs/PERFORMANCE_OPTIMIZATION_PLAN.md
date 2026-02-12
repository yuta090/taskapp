# TaskApp ページ表示速度 最適化計画

## Context

議事録ページのパフォーマンス調査をきっかけに、アプリ全体のページ表示速度を最速化するための包括的な分析・改善計画。Claude（3エージェント調査）とCodex Architectの双方が独立に分析し、見解を突き合わせた結果をもとに優先順位を策定。

---

## 1. パフォーマンス目標値

| 指標 | 目標（内部p75） | 現状推定 |
|------|-----------------|----------|
| FCP | < 1.0s | ~2.0s |
| LCP | < 1.8s | ~3.5s |
| TTI | < 2.5s | ~4.0s |
| INP | < 150ms | ~300ms |
| CLS | < 0.05 | ~0.1 |
| ナビゲーション（warm） | < 300ms | ~800ms |
| オプティミスティック応答 | < 100ms | ~200ms |

---

## 2. 双方の分析結果 比較表

| # | 問題 | Claude | Codex | 合意 |
|---|------|--------|-------|------|
| 1 | LP全体が'use client' | CRITICAL | Agree | **合意** |
| 2 | QueryProviderがroot layout全体をラップ | CRITICAL | **部分同意** - App Routerでは自動的に全CSRにはならない。影響はグローバルJS増加 | 修正 |
| 3 | next/image未使用 | CRITICAL | Agree | **合意** |
| 4 | データフェッチの直列化（useTasks等） | CRITICAL | Agree | **合意** |
| 5 | Middlewareが毎リクエスト1-3 DBクエリ | CRITICAL | Agree | **合意** |
| 6 | AppShell 'use client'が高すぎる | HIGH | **部分同意** - 真の問題は内部ルートが即座にクライアントページに委譲すること | 修正 |
| 7 | ミューテーション後の冗長な全件再取得 | HIGH | Agree | **合意** |
| 8 | 複数hookでSupabaseクライアント再生成 | HIGH | Agree | **合意** |
| 9 | InspectorContextの再レンダー | HIGH | 部分同意 - データ/境界修正後が効果的 | **合意** |
| 10 | 大型コンポーネント未分割 | HIGH | Agree | **合意** |
| 11 | BlockNote(~950KB)常時ロード | MEDIUM | **反論** - WikiEditorDynamic.tsxで既にdynamic import済み | 要確認 |
| 12 | Phosphor Icons(~130KB) 74ファイル | MEDIUM | **反論** - named ESMインポートはtree-shake済み | 過大評価 |
| 13 | TaskRowにReact.memo未使用 | MEDIUM | Agree（仮想化と組み合わせ） | **合意** |
| 14 | select('*')で不要カラム取得 | MEDIUM | Agree | **合意** |
| 15 | useTasks/useReviewsにページネーションなし | MEDIUM | Agree | **合意** |
| 16 | framer-motion(~80KB) LP専用 | MEDIUM | Agree | **合意** |
| 17 | インラインコールバックがメモ化を無効化 | MEDIUM | Agree（優先度は低め） | **合意** |
| 18 | 60秒aurora CSS無限アニメーション | MEDIUM | - | Claude単独 |
| 19 | prefers-reduced-motion未実装 | LOW | - | **合意** |
| 20 | searchParamsオブジェクト参照不安定 | LOW | 速度影響は小 | 低優先 |
| 21 | toISOString()タイムゾーンバグ | LOW | 正確性の問題、速度影響は小 | 別途修正 |

---

## 3. Codexが指摘した追加問題（Claudeが見落としていた項目）

| # | 問題 | 重要度 | 詳細 |
|---|------|--------|------|
| A | **リスト仮想化なし** | HIGH | TasksPageClient:573でタスク行を全件レンダー。100+タスクでUIがブロック |
| B | **クライアントhookで重複auth.getUser()** | HIGH | useTasks:152, useTaskComments:129 + middleware で同じ認証を何度も実行 |
| C | **loading.tsx が主要セグメントにない** | MEDIUM | ナビゲーション時のローディング表示なし。体感速度に影響 |
| D | **共有キャッシュ層がない** | HIGH | 各hookがマウント時に独立フェッチ。React Queryの活用が不十分 |
| E | **Linkのprefetchが積極的すぎる** | MEDIUM | LeftNavの多数リンクが帯域/CPUを消費 |

---

## 4. 見解の相違点（重要な議論）

### QueryProvider問題（#2）
- **Claude**: root layoutでQueryProviderが全ページをクライアント化
- **Codex**: App Routerでは'use client'コンポーネントのchildrenもServer Componentのまま。影響はグローバルJSバンドルサイズ増加であり、SSR無効化ではない
- **結論**: Codexが正しい。ただしQueryProvider自体のJS（~50KB）は不要なページにもロードされるため、内部ルート限定に移動する価値はある

### BlockNote問題（#11）
- **Claude**: 常時ロードされている（~950KB）
- **Codex**: WikiEditorDynamic.tsxで既にdynamic import済み
- **結論**: 要検証。WikiEditorは対策済みだが、TaskCommentsでのBlockNote使用が未確認

### Phosphor Icons問題（#12）
- **Claude**: 74ファイルで使用、~130KB
- **Codex**: named ESMインポートはbundlerがtree-shake。実際の影響は小さい
- **結論**: Codexが正しい可能性が高い。バンドル分析で実測すべき

### 最適化の順序（根本的アプローチの違い）
- **Claude**: ボトムアップ（個別hook修正 → コンポーネント最適化 → アーキテクチャ変更）
- **Codex**: トップダウン（server-first boundary reset → fetch最適化 → UIチューニング）
- **結論**: Codexのアプローチがより効果的。境界を正しく設定してからディテール最適化すべき

---

## 5. 統合優先実行計画

Codexの「server-first shell + client islands」アプローチを基軸に、Claudeの個別修正を組み合わせる。

### Phase 1: Quick Wins（即効性、1-2日）

| # | 修正内容 | 対象ファイル | 工数 | 影響 |
|---|---------|-------------|------|------|
| 1-1 | **LP画像をnext/imageに置換** | `src/components/lp/*.tsx` | 2h | LCPの即時改善 |
| 1-2 | **useTasks/useReviewsにlimit(50)追加** | `src/lib/hooks/useTasks.ts`, `useReviews.ts` | 30min | 大規模プロジェクトの初期ロード改善 |
| 1-3 | **全hookのSupabaseクライアントをuseRef化** | `useConsidering.ts`, `useSpecTasks.ts`, `useReviews.ts`, `useNotifications.ts` | 1h | 不要な再フェッチ防止 |
| 1-4 | **ミューテーション後の冗長refetch削除** | `useTasks.ts`, `useReviews.ts`, `useConsidering.ts`, `useSpecTasks.ts` | 2h | クエリ数40-60%削減 |
| 1-5 | **主要セグメントにloading.tsx追加** | `src/app/(internal)/[orgId]/project/[spaceId]/loading.tsx` 等 | 1h | 体感速度向上 |
| 1-6 | **Middleware matcher最適化** | `middleware.ts` | 1h | 静的アセット/APIへのDB不要クエリ排除 |

### Phase 2: データ取得最適化（2-3日）

| # | 修正内容 | 対象ファイル | 工数 | 影響 |
|---|---------|-------------|------|------|
| 2-1 | **useTasks: tasks+owners を1クエリ化** | `src/lib/hooks/useTasks.ts` | 3h | 直列→並列で100ms+短縮 |
| 2-2 | **useTaskComments: comments+profiles を1クエリ化** | `src/lib/hooks/useTaskComments.ts` | 2h | 同上 |
| 2-3 | **select('*') → 必要カラムのみに絞り込み** | `useTasks.ts`, `useReviews.ts`, `useNotifications.ts` | 2h | 転送量削減 |
| 2-4 | **重複auth.getUser()の排除** | `useTasks.ts:152`, `useTaskComments.ts:129` 等 | 3h | リクエスト毎の認証往復削減 |
| 2-5 | **ポータルServer Componentクエリ並列化** | `src/app/portal/*/page.tsx` | 2h | サーバーレイテンシ削減 |

### Phase 3: レンダリング最適化（2-3日）

| # | 修正内容 | 対象ファイル | 工数 | 影響 |
|---|---------|-------------|------|------|
| 3-1 | **TaskRow, GanttRow等にReact.memo追加** | `TaskRow.tsx`, `GanttRow.tsx` 等 | 2h | リスト選択時の再レンダー削減 |
| 3-2 | **InspectorContextを分離（data/callback）** | `AppShell.tsx` | 1h | コンテキスト変更時の再レンダー範囲縮小 |
| 3-3 | **TaskInspector/TaskCreateSheet dynamic import** | `TasksPageClient.tsx` | 2h | 初期バンドル~850行分削減 |
| 3-4 | **タスクリストの仮想化** | `TasksPageClient.tsx` | 4h | 100+タスクでのスクロール性能 |
| 3-5 | **インラインコールバックをuseCallback化** | `TasksPageClient.tsx` | 1h | メモ化の有効化 |

### Phase 4: アーキテクチャ改善（3-5日）

| # | 修正内容 | 対象ファイル | 工数 | 影響 |
|---|---------|-------------|------|------|
| 4-1 | **LP → Server Component化（client islands分離）** | `src/app/page.tsx`, `src/components/lp/*.tsx` | 4h | LPのJS量を大幅削減 |
| 4-2 | **QueryProviderを内部ルート限定に移動** | `layout.tsx`, `(internal)/layout.tsx` | 2h | LP/ポータルの不要JSバンドル削除 |
| 4-3 | **内部ルートのserver-first data passing** | `(internal)/[orgId]/project/[spaceId]/page.tsx` 等 | 1-2d | 初回ロードでサーバーデータ注入 |
| 4-4 | **framer-motion をLP限定dynamic import** | `src/components/lp/Hero.tsx` 等 | 3h | 内部ページからframer-motion除外 |
| 4-5 | **Linkのprefetch制御** | `LeftNav.tsx` | 1h | 不要プリフェッチの帯域節約 |

---

## 6. 計測・検証方法

### ビルド後の確認
```bash
npm run build                    # ビルドサイズ確認
npx @next/bundle-analyzer        # バンドル分析
```

### Lighthouse計測
- 内部タスクページ（メイン導線）
- LPページ（初回訪問）
- ポータルページ（クライアント視点）

### 実測項目
- Chrome DevTools Performance タブで FCP/LCP/TTI 計測
- Network タブで Supabase クエリ数・レスポンスサイズ確認
- React DevTools Profiler で再レンダー回数確認

---

## 7. 修正済み項目（今回対応完了）

### 初期調査（議事録ページ）
- [x] useMeetings: Supabaseクライアント useRef化
- [x] useMeetings: 2クエリ→1クエリ統合（ネストselect）
- [x] useMeetings: limit(50)追加
- [x] useMeetings: minutes_md除外 + fetchMeetingDetailオンデマンド化
- [x] useMeetings: ミューテーション後の冗長refetch削除
- [x] useMeetings: レース条件対策（fetchIdRef）
- [x] useMeetings: endMeeting後のsummaryローカル更新
- [x] Portal meetings: クエリ並列化（Promise.all）

### Phase 1: Quick Wins
- [x] 1-2: useTasks/useReviewsにlimit(50)追加
- [x] 1-3: 全hookのSupabaseクライアントをuseRef化（useTasks, useReviews, useNotifications等）
- [x] 1-4: ミューテーション後の冗長refetch削除（useTasks, useReviews, useConsidering, useSpecTasks）

### Phase 2: データ取得最適化
- [x] 2-1: useTasks — tasks+owners を1クエリ化（ネストselect `*, task_owners(*)`）
- [x] 2-2: useTaskComments — comments+profiles を1クエリ化
- [x] 2-4: 重複auth.getUser()の排除（userIdRef + onAuthStateChange パターン）
- [x] 2-5: ポータルServer Componentクエリ並列化（Promise.all — 7ページ対応）

### Phase 3: レンダリング最適化
- [x] 3-1: TaskRow, GanttRow等にReact.memo追加
- [x] 3-3: TaskInspector/TaskCreateSheet を next/dynamic でコード分割
- [x] 3-5: インラインコールバックをuseCallback化（useRefパターンで安定化）

### Phase 4: アーキテクチャ改善
- [x] 4-1: LP → Server Component化（page.tsxから'use client'除去、client islands維持）
- [x] 4-2: QueryProviderを内部ルート限定に移動（root layout → (internal)/layout.tsx）
- [x] 4-5: Linkのprefetch制御（LeftNav全リンクにprefetch={false}追加）

### Codex最終レビュー対応
- [x] useTasks: stale closure修正（per-item rollbackパターンに変更）
- [x] LP画像: 全`<img>`を`next/image`に移行（Hero, Problem, DayInLife, Workflow, FeatureBall）

---

## 対象ファイル一覧（変更予定）

### Phase 1
- `src/components/lp/Hero.tsx`, `FeatureBall.tsx`, `DayInLife.tsx`, `Workflow.tsx`
- `src/lib/hooks/useTasks.ts`
- `src/lib/hooks/useReviews.ts`
- `src/lib/hooks/useConsidering.ts`
- `src/lib/hooks/useSpecTasks.ts`
- `src/lib/hooks/useNotifications.ts`
- `src/app/(internal)/[orgId]/project/[spaceId]/loading.tsx` (新規)
- `middleware.ts`

### Phase 2
- `src/lib/hooks/useTasks.ts`
- `src/lib/hooks/useTaskComments.ts`
- `src/app/portal/*/page.tsx`

### Phase 3
- `src/components/task/TaskRow.tsx`
- `src/components/layout/AppShell.tsx`
- `src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx`

### Phase 4
- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/app/(internal)/layout.tsx`
- `src/components/lp/*.tsx`
- `src/components/layout/LeftNav.tsx`

---

*分析実施: 2026-02-12*
*分析者: Claude (3 Explore agents) + Codex Architect (GPT)*
