-- =============================================================================
-- github_installations に許可範囲の記録列を追加する（列追加のみ・破壊的変更なし）
-- 確定設計: GITHUB_ISSUES_LINK_SPEC.md §5・§7.6（Fable 裁定 2026-09-10）
--
-- 目的: 導入先ごとに GitHub App が実際にどの許可範囲（permissions）を持っているか、
--   いつ更新されたかを記録する。インストール完了時のコールバックと、
--   `installation.new_permissions_accepted` webhook の両方から書く
--   （src/app/api/github/callback/route.ts, src/lib/github/handlers.ts）。
--
-- 範囲: 列の追加のみ。RLS ポリシーは変更しない（20260910212804_rls_github_internal_only.sql の
--   ままで、select は社内メンバーに限定済み。書込は既存の "org owners can manage installations" の
--   ままで、この2列も同じポリシーの対象になる＝オーナーのみ書ける）。
-- 冪等: add column if not exists。再実行安全。
-- 互換: このコード（callback/webhook handler）は本 migration の適用前に本番へ出ても、
--   列への書き込みが失敗してもログのみで処理を止めない（呼び出し側で try/catch 済み）。
-- =============================================================================

alter table public.github_installations
  add column if not exists permissions jsonb null,
  add column if not exists permissions_updated_at timestamptz null;

comment on column public.github_installations.permissions is
  'GitHub App がそのインストールで実際に持っている許可範囲（installation.permissions のスナップショット）';
comment on column public.github_installations.permissions_updated_at is
  '上記 permissions を最後に更新した時刻';

-- =============================================================================
-- 検証:
--   1) select column_name, data_type from information_schema.columns
--        where table_schema = 'public' and table_name = 'github_installations'
--        and column_name in ('permissions', 'permissions_updated_at');
--      → 2行とも存在すること。
--   2) 既存の GitHub 連携画面（設定・タスク詳細の PR 紐づけ）が従来どおり動くこと
--      （列追加のみで既存の読み書きに影響しないため、確認は形式的）。
--
-- ロールバック（データは失われる。列に保存した許可範囲の記録が消える）:
--   alter table public.github_installations drop column if exists permissions;
--   alter table public.github_installations drop column if exists permissions_updated_at;
-- =============================================================================
