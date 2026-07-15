-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — 手順4b / org_channel_policy
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §2 / §3 / §6-4b / §7-7,9
--
-- 目的: org 単位の権限（code_only 開放 entitlement）とクォータ/縮退ポリシーの「器」を
--   用意する。共有botは LINE無料枠（月200通/account）を全相乗りorgで共有するため
--   超過が当社に集中する（設計正本 §0）。ここではポリシー器のみ。
--
--   メータリング集計本体・cron・送信境界の quota チェック・縮退実行は PR4 で扱う
--   （真実の源 = channel_messages からの導出。独立記録経路は作らない・設計正本 §3）。
--
-- ★書込は service role のみ（allow_code_only の付与は当社の運用判断）。
--   authenticated への書込ポリシーは作らない。既定は全org false / none / ok。
-- =============================================================================

create table if not exists public.org_channel_policy (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- code_only 紐付けの entitlement。既定 false（当社が信頼確認したorgにのみ true を付与）。
  allow_code_only boolean not null default false,
  granted_by uuid,
  granted_at timestamptz,
  -- 月間 push クォータ（共有bot無料枠監視）。NULL=無制限。
  monthly_push_quota int,
  -- 超過時の挙動。none=素通し（当面の既定）/ degrade=縮退 / block=停止。
  on_exceed text not null default 'none' check (on_exceed in ('none', 'degrade', 'block')),
  -- cron が集計で更新する現在の縮退状態。
  state text not null default 'ok' check (state in ('ok', 'soft', 'hard')),
  updated_at timestamptz not null default now()
);

comment on table public.org_channel_policy is
  '共有bot の org 単位ポリシー（entitlement＋クォータ／縮退）。書込は service role のみ（allow_code_only 付与は当社運用判断）。集計・執行は PR4';
comment on column public.org_channel_policy.allow_code_only is
  'code_only 紐付けの entitlement。既定 false。発行APIはこれが false の org の code_only 発行を拒否する（設計正本 §3 (k)）';
comment on column public.org_channel_policy.state is
  'cron が (org_id, account_id, 月) 集計で更新: ok / soft(縮退) / hard(停止)。送信境界のみが読んで分岐（inbound記録・webhook 200 は不可侵）';

-- -----------------------------------------------------------------------------
-- RLS: 読取=内部メンバー（自org のクォータ/state をコンソールで見る）。書込ポリシー無し。
-- -----------------------------------------------------------------------------
alter table public.org_channel_policy enable row level security;
revoke all on table public.org_channel_policy from anon, authenticated;
grant select on table public.org_channel_policy to authenticated;

drop policy if exists org_channel_policy_select_internal on public.org_channel_policy;
create policy org_channel_policy_select_internal
  on public.org_channel_policy
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) 明示行の無い org は「暗黙 false / none / ok」として扱われること（PR3/PR4 のアプリ側で
--      左外部結合＋coalesce する前提。ここでは行を強制作成しない）。
--   2) authenticated が自org の行を SELECT でき、他org の行は 0行であること。
--   3) authenticated が INSERT/UPDATE/DELETE できない（書込ポリシー無し＝service role のみ）。
-- ロールバック:
--   drop table public.org_channel_policy;
-- =============================================================================
