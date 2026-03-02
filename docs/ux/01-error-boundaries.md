# UX-01: Error Boundary (error.tsx) 追加

## 概要

API障害やレンダリングエラー発生時の白画面を防止するため、各ルートグループに `error.tsx` を配置する。

## 配置箇所

| # | パス | カバー範囲 |
|---|------|-----------|
| 1 | `src/app/error.tsx` | ルートキャッチオール |
| 2 | `src/app/(internal)/error.tsx` | 社内画面全般 |
| 3 | `src/app/(auth)/error.tsx` | ログイン/サインアップ |
| 4 | `src/app/portal/error.tsx` | クライアントポータル |
| 5 | `src/app/settings/error.tsx` | 設定画面 |

## 共通コンポーネント

`src/components/shared/ErrorFallback.tsx` に共通UIを配置し、各 `error.tsx` から呼び出す。

### Props

```typescript
interface ErrorFallbackProps {
  error: Error & { digest?: string }
  reset: () => void
  variant?: 'full' | 'inline'  // full=ページ全体, inline=ペイン内
}
```

## デザイン仕様

- 背景: `bg-gray-25`
- カード: `bg-white border border-gray-200 rounded-lg shadow-subtle`
- アイコン: `WarningCircle` (Phosphor) `text-red-500` 48px
- 見出し: `text-gray-900 font-semibold text-lg`
- 説明文: `text-gray-500 text-sm`
- リトライボタン: `bg-indigo-600 text-white rounded-md px-4 py-2`
- ホームに戻る: `text-indigo-600 underline text-sm`
- `error.digest` は開発環境のみ `text-2xs text-gray-400` で表示

## 振る舞い

1. `reset()` でコンポーネント再レンダリングを試みる
2. リトライで解消しない場合、ホームへのリンクを提供
3. `console.error(error)` でエラーをコンソール出力（将来Sentry等に接続可能）
4. 各 `error.tsx` は `'use client'` 必須（Next.js要件）

## テスト観点

- ビルド成功確認 (`npm run build`)
- 各error.tsxが正しいexport defaultを持つこと
