# 管理パネル 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

スーパー管理者向けの運用管理パネル。ユーザー・組織・スペース・課金・ログ等をGUIで管理する。

## アクセス制御

- `profiles.is_superadmin = true` のユーザーのみアクセス可能
- `/admin/login` でスーパー管理者認証
- 全APIエンドポイントで `verifySuperadmin()` チェック

## ページ構成

| パス | 機能 |
|------|------|
| `/admin/login` | 管理者ログイン |
| `/admin/dashboard` | ダッシュボード（統計概要） |
| `/admin/analytics` | 利用分析 |
| `/admin/users` | ユーザー管理（作成・一覧） |
| `/admin/organizations` | 組織管理 |
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

## セキュリティ

- 全エンドポイントで `is_superadmin` 検証
- admin配下のページは認証ミドルウェアで保護
- ユーザー作成はサービスロールキーを使用（Supabase Admin API）
