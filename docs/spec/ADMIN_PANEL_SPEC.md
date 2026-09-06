# 管理パネル 仕様書

> **Version**: 1.1
> **Last Updated**: 2026-09-06
> **Status**: 実装済み

## 概要

スーパー管理者向けの運用管理パネル。ユーザー・組織・スペース・課金・ログ等をGUIで管理する。

## アクセス制御

- `profiles.is_superadmin = true` のユーザーのみアクセス可能
- `/admin/login` でスーパー管理者認証（メール+パスワード / **Google ログイン**。Google の場合は
  `/auth/callback?next=/admin/dashboard` で戻り、`(panel)/layout.tsx` の superadmin ゲートが旗を確認する。
  旗が無ければ `/admin/login` に戻され、「管理者権限がありません」＋ログアウト導線を表示する）
- 全APIエンドポイントで `verifySuperadmin()` チェック（`src/lib/admin/verify-superadmin.ts`）
- **`is_superadmin` の変更は service role 限定**（DBトリガー `profiles_superadmin_guard`、
  `supabase/migrations/20260906082330_profiles_superadmin_guard.sql`）。
  一般ユーザーは RLS 上「自分の行を更新可」だが、この列だけは authenticated/anon から変更できない
  （2026-09-06 に本番で自己昇格できることを確認して是正。検証: `supabase/tests/profiles_superadmin_guard_assert.sql`）
- 運営の追加・削除は `/admin/users` の「管理者にする／管理者を外す」（→ `PATCH /api/admin/users`
  → `rpc_admin_set_superadmin(p_actor, p_target, p_flag)`）。RPC は service_role 専用・SECURITY DEFINER で、
  advisory lock により直列化し、同一トランザクション内で actor が運営であることを再確認する
  （A と B が同時に互いを外して運営 0 人になる競合を防ぐ）。自分自身の旗は API・RPC の両方で拒否（AD001）

## ページ構成

| パス | 機能 |
|------|------|
| `/admin/login` | 管理者ログイン |
| `/admin/dashboard` | ダッシュボード（統計概要） |
| `/admin/analytics` | 利用分析（登録トレンド＋登録後のファネル・流入経路別の到達・全節目。詳細: `ADMIN_FUNNEL_ANALYTICS.md`） |
| `/admin/users` | ユーザー管理（作成・一覧） |
| `/admin/organizations` | 組織管理 |
| `/admin/organizations/[id]` | 組織の詳細（メンバー・課金・連携・流入経路の手動登録・到達した節目） |
| `/admin/spaces` | スペース管理 |
| `/admin/reviews` | レビュー管理 |
| `/admin/billing` | 課金管理 |
| `/admin/invites` | 招待管理 |
| `/admin/logs` | 監査ログ閲覧 |
| `/admin/notifications` | 通知管理 |
| `/admin/api-keys` | APIキー管理 |
| `/admin/tables` | DBテーブルビューア |
| `/admin/tables/[tableName]` | テーブル詳細 |
| `/admin/sitemap` | サイトマップ確認 |
| `/admin/design-system` | デザインシステムプレビュー |

## 共通コンポーネント

| コンポーネント | パス | 用途 |
|--------------|------|------|
| `AdminSidebar` | `src/components/admin/AdminSidebar.tsx` | サイドバーナビ |
| `AdminPageHeader` | `src/components/admin/AdminPageHeader.tsx` | ページヘッダー |
| `AdminDataTable` | `src/components/admin/AdminDataTable.tsx` | 汎用データテーブル |
| `AdminFilterBar` | `src/components/admin/AdminFilterBar.tsx` | フィルター検索バー |
| `AdminStatCard` | `src/components/admin/AdminStatCard.tsx` | 統計カード |
| `AdminBadge` | `src/components/admin/AdminBadge.tsx` | ステータスバッジ |
| `AdminJsonViewer` | `src/components/admin/AdminJsonViewer.tsx` | JSON表示 |

## API

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/admin/users` | ユーザー作成（スーパー管理者のみ） |
| PATCH | `/api/admin/users` | 運営（superadmin）の付与・剥奪 `{ userId, isSuperadmin }`（スーパー管理者のみ・自分自身の剥奪は400） |
| PATCH | `/api/admin/organizations/[id]/acquisition` | 流入経路の手動登録 `{ channel, note? }`（スーパー管理者のみ） |
| POST | `/api/admin/milestones/reconcile` | 節目の再集計 `{ orgId? }`（スーパー管理者のみ・冪等） |

## セキュリティ

- 全エンドポイントで `is_superadmin` 検証
- admin配下のページは `(panel)/layout.tsx` の superadmin ゲートで保護（service role で読むページは
  データ取得の直前でも `verifySuperadmin()` を通すのが望ましい。`users/page.tsx` が例）
- `is_superadmin` 列は DB トリガーで service role / postgres 以外から変更不可（自己昇格防止）
- ユーザー作成はサービスロールキーを使用（Supabase Admin API）
