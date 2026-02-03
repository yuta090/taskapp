# Implementation Workflow: Billing & Auth Feature Completion

## Overview
TODO項目を順に実装するワークフロー計画

**実装対象:**
1. 課金ページの`org_id`取得
2. OAuth認証（後日予定のため今回はスキップ）
3. Stripeカスタマーポータル
4. 請求履歴の実装

---

## Phase 1: org_id取得の実装

### 1.1 useCurrentOrg フック作成
**ファイル:** `src/lib/hooks/useCurrentOrg.ts`

**目的:** 現在のユーザーの組織IDを取得するフック

**実装内容:**
- Supabaseからユーザーセッション取得
- `org_memberships`テーブルから所属組織を取得
- 最初に作成された組織をプライマリとして返す

**依存関係:** なし

### 1.2 課金ページの修正
**ファイル:** `src/app/settings/billing/page.tsx`

**目的:** ハードコードされた`'TODO'`を実際のorg_idに置換

**実装内容:**
- `useCurrentOrg`フックを使用
- org_id取得中のローディング状態
- org_idが取得できない場合のエラーハンドリング
- BillingUsageCardにorg_idを渡す

**依存関係:** 1.1完了後

### 1.3 テスト作成
**ファイル:** `src/__tests__/lib/hooks/useCurrentOrg.test.ts`

**実装内容:**
- 正常系: org_id取得成功
- 異常系: 未ログイン状態
- 異常系: 組織未所属
- ローディング状態の確認

**依存関係:** 1.1完了後

---

## Phase 2: Stripeカスタマーポータル

### 2.1 ポータルセッションAPI作成
**ファイル:** `src/app/api/stripe/portal/route.ts`

**目的:** Stripeカスタマーポータルへのリダイレクト用セッション作成

**実装内容:**
- org_idからstripe_customer_id取得
- `stripe.billingPortal.sessions.create()`でセッション作成
- リダイレクトURL返却

**依存関係:** Phase 1完了後

### 2.2 課金ページにポータルリンク追加
**ファイル:** `src/app/settings/billing/page.tsx`

**目的:** 有料プラン契約中ユーザー向けのサブスク管理リンク

**実装内容:**
- 「サブスクリプション管理」ボタン追加
- `/api/stripe/portal`呼び出し
- Stripeポータルへリダイレクト

**依存関係:** 2.1完了後

### 2.3 テスト作成
**ファイル:** `src/__tests__/app/api/stripe/portal/route.test.ts`

**実装内容:**
- 正常系: ポータルURL取得
- 異常系: 未契約ユーザー
- 異常系: Stripe未設定

**依存関係:** 2.1完了後

---

## Phase 3: 請求履歴の実装

### 3.1 請求履歴取得API作成
**ファイル:** `src/app/api/stripe/invoices/route.ts`

**目的:** Stripeから請求履歴を取得

**実装内容:**
- org_idからstripe_customer_id取得
- `stripe.invoices.list()`で請求書一覧取得
- 必要なフィールドのみ返却（金額、日付、ステータス、PDF URL）

**依存関係:** Phase 1完了後

### 3.2 請求履歴コンポーネント作成
**ファイル:** `src/components/billing/InvoiceHistory.tsx`

**目的:** 請求履歴の表示UI

**実装内容:**
- 請求書一覧テーブル
- 日付、金額、ステータス表示
- PDF/領収書ダウンロードリンク
- ローディング/空状態のハンドリング

**依存関係:** 3.1完了後

### 3.3 useBillingInvoices フック作成
**ファイル:** `src/lib/hooks/useBillingInvoices.ts`

**目的:** 請求履歴取得用フック

**実装内容:**
- `/api/stripe/invoices`からデータ取得
- ローディング/エラー状態管理
- AbortControllerによるクリーンアップ

**依存関係:** 3.1完了後

### 3.4 課金ページに請求履歴統合
**ファイル:** `src/app/settings/billing/page.tsx`

**目的:** 請求履歴セクションを実データで表示

**実装内容:**
- InvoiceHistoryコンポーネント使用
- 静的表示を動的表示に置換

**依存関係:** 3.2, 3.3完了後

### 3.5 テスト作成
**ファイル群:**
- `src/__tests__/app/api/stripe/invoices/route.test.ts`
- `src/__tests__/components/billing/InvoiceHistory.test.tsx`
- `src/__tests__/lib/hooks/useBillingInvoices.test.ts`

**依存関係:** 3.1-3.3完了後

---

## Execution Order (依存関係順)

```
Phase 1: org_id取得
├─ 1.1 useCurrentOrg フック作成
├─ 1.2 課金ページ修正 (depends: 1.1)
└─ 1.3 テスト作成 (depends: 1.1)

Phase 2: Stripeカスタマーポータル (depends: Phase 1)
├─ 2.1 ポータルセッションAPI作成
├─ 2.2 課金ページにリンク追加 (depends: 2.1)
└─ 2.3 テスト作成 (depends: 2.1)

Phase 3: 請求履歴 (depends: Phase 1)
├─ 3.1 請求履歴取得API作成
├─ 3.2 InvoiceHistoryコンポーネント (depends: 3.1)
├─ 3.3 useBillingInvoices フック (depends: 3.1)
├─ 3.4 課金ページ統合 (depends: 3.2, 3.3)
└─ 3.5 テスト作成 (depends: 3.1-3.3)
```

---

## Quality Gates

### 各Phase完了時チェック
- [ ] TypeScript型エラーなし (`npm run lint`)
- [ ] 全テスト通過 (`npm run test:run`)
- [ ] ビルド成功 (`npm run build`)

### 最終チェック
- [ ] Stripe未設定時の graceful degradation
- [ ] エラーハンドリング完備
- [ ] ローディング状態の適切な表示
- [ ] セキュリティ: org所属確認

---

## Notes

- **OAuth認証**は後日実装予定のためこのワークフローには含めない
- Stripe APIキーが未設定の場合でもUIが破綻しないことを確認
- 既存のパターン（`useBillingLimits`等）に倣って実装

---

## Completion Status

### Phase 1: org_id取得 ✅
- `useCurrentOrg.ts`フック作成完了
- 課金ページ修正完了
- テスト8件追加

### Phase 2: Stripeカスタマーポータル ✅
- `/api/stripe/portal`エンドポイント作成完了
- 「サブスクリプション管理」ボタン追加完了
- テスト7件追加

### Phase 3: 請求履歴 ✅
- `/api/stripe/invoices`エンドポイント作成完了
- `InvoiceHistory.tsx`コンポーネント作成完了
- `useBillingInvoices.ts`フック作成完了
- 課金ページ統合完了
- テスト25件追加

### Codex Code Review ✅ (2026-02-02)
**レビュー指摘事項と対応:**
1. **Critical: Owner role check** → `/api/stripe/invoices`にownerロールチェック追加
2. **Error handling** → membershipクエリに明示的エラーハンドリング追加
3. **URL encoding** → `useBillingInvoices`でorgIdをURLエンコード
4. **Abort signal** → finallyブロックでabortチェック追加

### 品質チェック結果
- ✅ 115 tests passed
- ✅ Build successful

---

**作成日:** 2026-02-02
**完了日:** 2026-02-02
