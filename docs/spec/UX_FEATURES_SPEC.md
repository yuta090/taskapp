# UX機能 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

ユーザー体験を向上させるクロスカッティング機能群。

## 1. キーボードショートカット

### 実装

`useKeyboardShortcuts` hook (`src/lib/hooks/useKeyboardShortcuts.ts`)

### 仕様

- 入力フィールド（input/textarea/[contenteditable]）にフォーカス中は無効
- `allowInInput: true` オプションで入力中も有効化可能
- `meta: true` で Ctrl/Cmd 修飾キーを要求

### ショートカットヘルプ

`KeyboardShortcutsHelp` コンポーネント（`src/components/shared/KeyboardShortcutsHelp.tsx`）で一覧表示。

## 2. コマンドパレット

### 実装

`CommandPalette` コンポーネント（`src/components/shared/CommandPalette.tsx`）

### 起動

- `/` キーまたは `Cmd+K`
- 設定ページ横断のインクリメンタル検索

## 3. フォーム下書き自動保存

### 実装

`useFormDraft<T>` hook (`src/lib/hooks/useFormDraft.ts`)

### 仕様

- `localStorage` にデバウンス（500ms）付き保存
- キー: `taskapp_draft_{key}`
- `enabled=true` 時に自動復元
- `clear()` で下書き削除（送信成功時に呼ぶ）

### 適用箇所

タスク作成シート、会議作成シート等のフォーム。

## 4. オンボーディングウォークスルー

### 実装

`InternalOnboardingWalkthrough` コンポーネント（`src/components/onboarding/InternalOnboardingWalkthrough.tsx`）

### 仕様

- 初回アクセス時に表示（`localStorage` key: `taskapp_internal_onboarded`）
- ステップ式ガイド:
  1. タスク作成の流れ
  2. ボールの概念
  3. インスペクターの使い方
  4. 次のステップ
- 前へ/次へボタンで遷移、スキップ可能
- UXヘルプ設定から再表示可能

## 5. 共通UIコンポーネント

| コンポーネント | パス | 用途 |
|--------------|------|------|
| `ConfirmDialog` | `src/components/shared/ConfirmDialog.tsx` | 確認ダイアログ |
| `AmberBadge` | `src/components/shared/AmberBadge.tsx` | クライアント可視バッジ |
| `Breadcrumb` | `src/components/shared/Breadcrumb.tsx` | パンくずリスト |
| `EmptyState` | `src/components/shared/EmptyState.tsx` | 空状態表示 |
| `ErrorFallback` | `src/components/shared/ErrorFallback.tsx` | エラー境界フォールバック |
| `ErrorRetry` | `src/components/shared/ErrorRetry.tsx` | エラーリトライUI |
| `LoadingState` | `src/components/shared/LoadingState.tsx` | ローディング表示 |
| `Skeleton` | `src/components/shared/Skeleton.tsx` | スケルトンローダー |
| `SkipLink` | `src/components/shared/SkipLink.tsx` | アクセシビリティ: スキップリンク |
| `TruncatedText` | `src/components/shared/TruncatedText.tsx` | テキスト省略+ツールチップ |
| `ViewsTabNav` | `src/components/shared/ViewsTabNav.tsx` | Gantt/Burndownタブ切替 |

## 6. レート制限

### 実装

`src/lib/rate-limit.ts`

### 仕様

- インメモリ・スライディングウィンドウ方式
- IPアドレスベースの制限
- 定期クリーンアップ（5分間隔）
- APIキー操作: 15分間に20リクエスト
- 単一インスタンス向け（マルチインスタンスはRedis/Upstash推奨）
