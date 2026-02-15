# ポータルモバイル対応仕様書

**Version**: 1.0
**Status**: Draft
**Priority**: HIGH
**Estimated Effort**: 1-2日
**Branch**: `feat/portal-mobile-responsive`

---

## 1. 目的

クライアントポータルをモバイル端末で快適に使用可能にする。
現状、Inspector（400px固定幅）がスマホ画面をはみ出し、操作不能になっている。

## 2. 現状分析

### 問題のあるレイアウト

```
デスクトップ（正常）:
[LeftNav 240px] [Main flex-1] [Inspector 400px]

モバイル（問題）:
[LeftNav 240px][Main flex-1][Inspector 400px] ← 画面幅(375px)を大幅超過
```

### 対象コンポーネント
- `src/components/portal/PortalShell.tsx` — メインレイアウト
- `src/components/portal/PortalLayout.tsx` — ラッパー
- Inspector関連コンポーネント

## 3. 技術仕様

### 3.1 ブレイクポイント定義

| ブレイクポイント | 幅 | レイアウト |
|----------------|-----|-----------|
| mobile | < 768px | 1カラム + Inspector overlay |
| tablet | 768px - 1024px | 2カラム（LeftNavなし + Inspector overlay） |
| desktop | > 1024px | 3カラム（現行通り） |

### 3.2 モバイルレイアウト（< 768px）

> **基本方針**: 既存の `PortalShell.tsx` の `InspectorContext`、スライドイン/アウトアニメーション制御（`isVisible` / `shouldRender` / `animationRef` / `timeoutRef`）を保持したまま、モバイル時の分岐を **追加** する。既存コードの置換ではなく、レスポンシブ分岐の追加として実装する。

#### PortalLeftNav（既存構成を維持）
- デスクトップ: 現行通り `<PortalLeftNav>` を常時表示（240px固定）
- モバイル: `PortalLeftNav` を非表示にし、ハンバーガーメニュー経由でオーバーレイ表示
- **`PortalSidebar` への置換は行わない** — 現行の `PortalLeftNav` コンポーネントをそのまま使用
- メニュー展開時はオーバーレイ（`fixed inset-0 z-40`）+ スライドイン
- 背景タップで閉じる

#### Inspector
- デスクトップ: 現行通りサイドパネル（400px / 440px）でスライドインアニメーション
- モバイル: **全画面オーバーレイ方式**（`fixed inset-0 z-50`）
- 上部に「← 戻る」ボタン
- 既存の `InspectorContext` (`usePortalInspector`) はそのまま利用
- 既存アニメーション制御（`isVisible` / `shouldRender`）はデスクトップ用に保持し、モバイルでは即時表示/非表示

```tsx
// モバイル時のInspector表示（PortalShell.tsx 内の分岐追加例）
// 既存の shouldRender / isVisible / resolvedInspector をそのまま使用
{shouldRender && isMobile ? (
  // モバイル: 全画面オーバーレイ
  <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
    <div className="flex items-center gap-2 border-b px-4 py-3">
      <button
        onClick={() => setInspectorNode(null)}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="戻る"
      >
        <ArrowLeft size={20} />
      </button>
      <span className="text-sm font-medium">タスク詳細</span>
    </div>
    {resolvedInspector}
  </div>
) : shouldRender ? (
  // デスクトップ: 既存のサイドパネル（アニメーション付き）
  <aside className={`w-[400px] 2xl:w-[440px] flex-shrink-0 ... transition-all duration-300 ${
    isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
  }`}>
    {resolvedInspector}
  </aside>
) : null}
```

#### メインコンテンツ
- モバイルでInspectorが開いている間は非表示（`hidden` or `aria-hidden`）
- LeftNavはモバイルで常に非表示（ハンバーガー経由のみ）

#### フォーカストラップ
- モバイルInspector表示中はフォーカスをInspector内に閉じ込める
- Tabキーでの巡回がInspector外に出ないようにする
- 実装: `useEffect` で最初のフォーカス可能要素にフォーカスを移動し、`keydown` イベントで`Tab`キーを監視

#### スクロールロック
- モバイルでInspector/LeftNavオーバーレイ表示中は背景の `body` スクロールを無効化
- 実装: `document.body.style.overflow = 'hidden'` / `useEffect` のクリーンアップで復元

#### 戻る操作
- ブラウザの「戻る」ボタンでInspectorを閉じる（`history.pushState` / `popstate` イベント連携）
- モバイルでInspectorを開く際に `history.pushState` で履歴エントリを追加
- `popstate` イベントで `setInspectorNode(null)` を呼び出してInspectorを閉じる

### 3.3 タッチ最適化

| 要素 | 現状 | 改善 |
|------|------|------|
| タップターゲット | 未統一 | 最低44x44px（iOS HIG準拠） |
| タスク行 | クリック | タップ対応 + hover無効化 |
| アクションボタン | 小さい可能性 | padding: 12px以上 |

### 3.4 レスポンシブユーティリティ

```typescript
// src/lib/hooks/useMediaQuery.ts
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])

  return matches
}

export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}
```

### 3.5 PortalShell.tsx の変更方針

> **既存構造の保持が必須**。以下の要素は変更禁止:
> - `InspectorContext` / `usePortalInspector` の仕組み
> - `isVisible` / `shouldRender` / `animationRef` / `timeoutRef` によるアニメーション制御
> - `PortalLeftNav` コンポーネントの使用（`PortalSidebar` への置換禁止）
> - Aurora Background Layer（glassmorphism背景）
> - props: `inspector`, `currentProject`, `projects`, `actionCount`

**追加する変更のみ**:

```tsx
// 既存の PortalShell 関数内に追加する差分のみ示す

// 1. useIsMobile フックを追加
const isMobile = useIsMobile()

// 2. モバイル用サイドバー開閉状態を追加
const [isSidebarOpen, setIsSidebarOpen] = useState(false)

// 3. スクロールロック（モバイルオーバーレイ表示時）
useEffect(() => {
  if (isMobile && (isSidebarOpen || resolvedInspector)) {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }
}, [isMobile, isSidebarOpen, resolvedInspector])

// 4. PortalLeftNav 部分にモバイル分岐を追加
//    デスクトップ: 既存の <PortalLeftNav ... /> をそのまま表示
//    モバイル: PortalLeftNav を非表示 + ハンバーガーボタン + オーバーレイ表示

// モバイル時のLeftNavオーバーレイ
{isMobile && isSidebarOpen && (
  <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
    <div className="absolute inset-0 bg-black/30" onClick={() => setIsSidebarOpen(false)} />
    <aside className="relative z-50 w-60 h-full bg-white shadow-xl overflow-y-auto">
      <PortalLeftNav
        currentProject={currentProject}
        projects={projects}
        actionCount={actionCount}
      />
    </aside>
  </div>
)}

// 5. Inspector 部分はセクション3.2の分岐を適用
//    (既存の shouldRender / isVisible ロジックを保持)
```

> **禁止事項**: PortalShell全体をモバイル用に書き直す実装は不可。既存のJSX構造に対して `isMobile` 分岐を **差分で追加** すること。

## 4. 制約

- 内部管理画面（/internal）は対象外（ポータルのみ）
- Tailwind CSSのレスポンシブプレフィックス（md:, lg:）を活用
- 新規CSSライブラリの追加なし
- 既存のデスクトップレイアウトを壊さない
- `any`型は使わない
- **PortalShellの既存構造（InspectorContext、アニメーション制御、PortalLeftNav）を保持すること**
- **PortalLeftNav → PortalSidebar の置換は禁止**
- フォーカストラップ: モバイルInspector/LeftNavオーバーレイ表示中はフォーカスを閉じ込める
- スクロールロック: モバイルオーバーレイ表示中は`body`スクロールを無効化
- 戻るボタン: ブラウザ戻るでInspectorを閉じる（`popstate`連携）

## 5. 受け入れ基準

### 5.1 既存機能非退行（必須）
- [ ] **全Portalページで既存機能が非退行であること**（ダッシュボード、タスク一覧、タスク詳細、日程調整、履歴）
- [ ] デスクトップ（1024px以上）で3ペインレイアウトが変わっていないこと
- [ ] `InspectorContext` / `usePortalInspector` が正常に動作すること
- [ ] Inspectorのスライドイン/アウトアニメーションがデスクトップで維持されていること
- [ ] `PortalLeftNav` が使用されていること（`PortalSidebar`ではないこと）

### 5.2 モバイル対応
- [ ] iPhone SE (375px), iPhone 14 (390px), iPad (768px) でレイアウト確認
- [ ] Inspector開閉がスムーズに動作する
- [ ] タップターゲットが44x44px以上
- [ ] LeftNavのハンバーガーメニューが動作する

### 5.3 アクセシビリティ・操作性
- [ ] モバイルInspector表示中にフォーカスがInspector内に閉じ込められること
- [ ] モバイルオーバーレイ表示中に背景がスクロールしないこと
- [ ] ブラウザの「戻る」ボタンでモバイルInspectorが閉じること
- [ ] Escキーでモバイルオーバーレイ（LeftNav / Inspector）が閉じること

### 5.4 ビルド
- [ ] `npm run build` / `npm run lint` が成功する
