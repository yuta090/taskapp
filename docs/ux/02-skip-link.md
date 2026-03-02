# UX-02: スキップリンク追加

## 概要

キーボードユーザー / スクリーンリーダー向けに、ページ先頭でTabキーを押すと
「メインコンテンツへスキップ」リンクが表示される仕組みを追加する。

## 実装方針

1. `src/components/shared/SkipLink.tsx` を作成
2. `src/app/layout.tsx` の `<body>` 直後に配置
3. `AppShell` と `PortalShell` の `<main>` に `id="main-content"` を付与

## デザイン仕様

- 通常時: `sr-only`（視覚的に非表示）
- フォーカス時: 画面左上に固定表示
  - `bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md`
  - `z-[9999]` で最前面
  - `fixed top-2 left-2`

## アクセシビリティ

- `<a href="#main-content">` でメインコンテンツにフォーカス移動
- Tab → 表示 → Enter → メインコンテンツにジャンプ
