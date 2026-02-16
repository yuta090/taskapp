# Sentry エラー監視導入仕様書

**Version**: 1.0
**Status**: Draft
**Priority**: CRITICAL
**Estimated Effort**: 2-4時間
**Branch**: `fix/sentry-monitoring`

---

## 1. 目的

TaskAppにSentryを導入し、エラー検知率を0% → 90%に引き上げる。
現状`console.error`が250箇所あるが全てブラウザコンソールで消失しており、本番障害に気づけない。

## 2. スコープ

### やること
- @sentry/nextjs のインストールと初期設定
- クライアント側エラーキャプチャ（React Error Boundary）
- サーバー側エラーキャプチャ（API Routes、Server Components）
- 環境変数による有効/無効切り替え
- ソースマップのアップロード設定

### やらないこと
- パフォーマンスモニタリング（tracing）— 後日Phase 2で追加
- LogRocket等のセッションリプレイ — コスト検討後
- Slack通知連携 — Sentry側ダッシュボードで設定

## 3. 技術仕様

### 3.1 パッケージ

```bash
npm install @sentry/nextjs
```

### 3.2 設定ファイル

| ファイル | 用途 |
|---------|------|
| `sentry.client.config.ts` | ブラウザ側SDK初期化 |
| `sentry.server.config.ts` | サーバー側SDK初期化 |
| `sentry.edge.config.ts` | Edge Runtime用（middleware等） |
| `next.config.ts` | withSentryConfig ラッパー追加 |
| `.env.local` | SENTRY_DSN, SENTRY_AUTH_TOKEN |

### 3.3 SDK初期化（共通設定）

```typescript
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0, // Phase 1ではトレース無効
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PII（個人情報）をSentryに送信しない
  beforeSend(event) {
    // ユーザーのメールアドレス・IPアドレスを除去
    if (event.user) {
      delete event.user.email
      delete event.user.ip_address
      delete event.user.username
    }
    // リクエストヘッダーからCookie・Authorizationを除去
    if (event.request?.headers) {
      delete event.request.headers['cookie']
      delete event.request.headers['authorization']
    }
    return event
  },
})
```

> **PII非送信の要件**: `beforeSend` フックにより、email・IP・Cookie・Authorizationヘッダーをイベント送信前に除去する。将来的にキャプチャするユーザー属性が増えた場合も、この関数を必ず更新すること。

### 3.4 環境変数

| 変数 | 用途 | 必須 |
|------|------|------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | Yes（本番のみ） |
| `SENTRY_AUTH_TOKEN` | ソースマップアップロード用 | Yes（CI/CDのみ） |
| `SENTRY_ORG` | Sentry組織名 | Yes（CI/CDのみ） |
| `SENTRY_PROJECT` | Sentryプロジェクト名 | Yes（CI/CDのみ） |

### 3.5 next.config.ts 変更

```typescript
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig = { /* 既存設定 */ }

export default withSentryConfig(nextConfig, {
  silent: true,
  hideSourceMaps: true,
})
```

**注意**: 既存のセキュリティヘッダー設定を壊さないこと。

### 3.6 Error Boundary

`src/app/global-error.tsx` を作成し、App Router のグローバルエラーをキャプチャ:

```typescript
'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-semibold">エラーが発生しました</h2>
            <p className="mt-2 text-sm text-gray-500">
              問題を確認しています。しばらくしてからお試しください。
            </p>
            <button
              onClick={reset}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              再試行
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
```

## 4. 制約

- DSN未設定時（開発環境）はSentryを無効化する
- ビルド時間への影響を最小化（ソースマップはCI/CDでのみアップロード）
- ユーザーの個人情報（メールアドレス等）はSentryに送信しない
- `any`型は使用しない
- 既存のnext.config.ts設定（セキュリティヘッダー等）を破壊しない

## 5. 検証方法

- [ ] `npm run build` が成功する
- [ ] `npm run lint` がエラーなし
- [ ] DSN未設定時にエラーが出ない
- [ ] 意図的にエラーを発生させ、Sentryダッシュボードに表示される
- [ ] ソースマップが正しくマッピングされる
- [ ] **Server Component例外**: Server Componentで`throw new Error('test')`を実行し、Sentryにキャプチャされることを確認
- [ ] **API Route例外**: API Routeハンドラで`throw new Error('test')`を実行し、Sentryにキャプチャされることを確認
- [ ] **Edge Runtime例外**: Middleware等Edge Runtime内でエラーを発生させ、Sentryにキャプチャされることを確認
- [ ] `beforeSend`によりemail・IP等のPIIがSentryイベントに含まれないことを確認

## 6. 影響ファイル

| ファイル | 変更内容 |
|---------|---------|
| `next.config.ts` | withSentryConfig追加 |
| `sentry.client.config.ts` | 新規作成 |
| `sentry.server.config.ts` | 新規作成 |
| `sentry.edge.config.ts` | 新規作成 |
| `src/app/global-error.tsx` | 新規作成 |
| `src/instrumentation.ts` | 新規作成（Next.js instrumentation hook） |
| `.env.local.example` | SENTRY_DSN追加 |

### 6.1 `src/instrumentation.ts` と `sentry.*.config.ts` の責務分離

| ファイル | 責務 | 実行タイミング |
|---------|------|---------------|
| `sentry.client.config.ts` | ブラウザ側SDK初期化（`Sentry.init`）、`beforeSend`によるPIIフィルタリング、React Error Boundary連携 | ブラウザ起動時 |
| `sentry.server.config.ts` | Node.jsランタイム側SDK初期化、Server Component・API Route例外のキャプチャ設定 | サーバープロセス起動時 |
| `sentry.edge.config.ts` | Edge Runtime用SDK初期化、Middleware例外のキャプチャ設定 | Edge Worker起動時 |
| `src/instrumentation.ts` | Next.js Instrumentation Hook。**Sentry SDK の遅延登録のみ**を担当。`register()` 関数内で `import('./sentry.server.config')` / `import('./sentry.edge.config')` をランタイム判定で動的インポートする。SDK設定自体は各 `sentry.*.config.ts` に委譲し、instrumentation.ts には `Sentry.init` を直接書かない。 | Next.js サーバー初期化時（`register()` hook） |

```typescript
// src/instrumentation.ts — 実装例
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
```

> **設計意図**: `instrumentation.ts` はランタイム判定と動的インポートのみに徹し、Sentry固有の設定（DSN、サンプルレート、beforeSend等）は `sentry.*.config.ts` に集約する。これにより設定の一元管理と各ランタイムの独立テストが可能になる。
| `package.json` | @sentry/nextjs追加 |
