-- =============================================================================
-- org_free_cap_nudge: 無料50通到達時のアップグレード促しを org×月で1回に冪等化するガード
-- 設計正本: 無料50実停止(20260721193407)の後続。docs/sales/BUNDLE_ECONOMICS.md
--
-- 無料orgが共通LINEの月間auto-push上限(50)に達し digest が抑止されたとき、
--   ・事務所(内部owner/admin)へ アプリ内通知＋メールで Proアップグレード導線
--   ・相手先グループへ 中立の1行（営業文言なし・月1回）
-- を出す。抑止は毎日起きうるので、この促しは **org×月で1回だけ** にする必要がある。
-- その先着1件ガードを担う最小テーブル（PKの一意制約で二重実行を弾く）。
-- =============================================================================

create table if not exists public.org_free_cap_nudge (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month text not null,               -- 'YYYY-MM'（JST基準）
  created_at timestamptz not null default now(),
  primary key (org_id, month)
);

comment on table public.org_free_cap_nudge is
  '無料50通到達アップグレード促しの org×月 冪等ガード。行が有れば当月は促し済み（PK一意で先着1件のみ通す）。';

alter table public.org_free_cap_nudge enable row level security;
-- policy は置かない（service role のみ。cron/サーバー側からのみ書く）。

-- =============================================================================
-- ロールバック:
--   drop table if exists public.org_free_cap_nudge;
-- =============================================================================
