-- =============================================================================
-- org 単位 自動期限リマインドトグル 検証セットアップ
--   20260721215120_org_due_reminders_toggle.sql を適用する「直前」の実DB状態を再現する。
--
-- 前提（runner が verbatim 適用済み）:
--   baseline → rls_helpers → channel chain → 092426(org_channel_policy) →
--   20260720223422(shared_bot_access) → org_billing stub → 20260720201858(quota trigger) →
--   20260721193407(on_exceed block ＋ resync)
--
-- ここで作るもの:
--   (A) org / メンバー（owner / admin / member / 他org owner）
--   (B) org_billing 投入 → quota トリガーが org_channel_policy 行を自動生成
--       ＝★HIGH-1 の前提「backfill 済みでほぼ全 org に policy 行が存在する」状態。
--       さらに entitlement 列に非デフォルト値を入れておき、トグル RPC がそれらを潰さないことを
--       検証できるようにする。
--   (C) policy 行が「無い」org（insert 経路の検証用・org_billing を持たせない）
--   (D) task_due_reminder_occurrences のスタブ＋既に materialize 済みの -1440 occurrence
--       （本体は 20260721133427 が作るが、その migration は tasks/connector_* に依存するため
--         ここでは列定義だけを最小再現する＝run_due_reminder_confirm.sh と同じ規律）
-- =============================================================================
set client_min_messages = warning;

-- 本番の権限状態を再現: Supabase の既定 GRANT により authenticated は org_memberships を
-- SELECT できる（20260703_000_rls_stage0_grants.sql は truncate/references/trigger しか剥がさない）。
-- baseline_stubs はスタブ表を作るだけで GRANT しないため、ここで揃える。
-- ※ 旧設計の RLS ポリシーは org_memberships をインライン参照するため、この GRANT の有無で
--   結果が変わる（＝呼び出し元権限に依存する）。SECURITY DEFINER ヘルパ経由なら依存しない。
grant select on public.org_memberships to authenticated;

-- (A) orgs -------------------------------------------------------------------
insert into public.organizations values
  ('00000000-0000-0000-0000-0000000d0001'),  -- O_ROW  : policy 行あり（HIGH-1 の的）
  ('00000000-0000-0000-0000-0000000d0002'),  -- O_NOROW: policy 行なし（insert 経路）
  ('00000000-0000-0000-0000-0000000d0003');  -- O_OTHER: 他org（越境拒否の的・行あり）

-- メンバー
--   U_OWNER  e0001 : O_ROW owner / O_NOROW owner
--   U_ADMIN  e0002 : O_ROW admin（前方互換ロール）
--   U_MEMBER e0003 : O_ROW member（設定変更は不可・読取のみ）
--   U_OTHER  e0004 : O_OTHER owner（O_ROW に対しては越境）
insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000e0001','owner'),
  ('00000000-0000-0000-0000-0000000d0002','00000000-0000-0000-0000-0000000e0001','owner'),
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000e0002','admin'),
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000e0003','member'),
  ('00000000-0000-0000-0000-0000000d0003','00000000-0000-0000-0000-0000000e0004','owner');

-- (B) org_billing → quota トリガーで org_channel_policy 行が自動生成される（free: quota=50 / on_exceed='block'）
insert into public.org_billing(org_id, plan_id, status) values
  ('00000000-0000-0000-0000-0000000d0001', 'free', 'active'),
  ('00000000-0000-0000-0000-0000000d0003', 'free', 'active');

-- entitlement 列に非デフォルト値を仕込む（トグル RPC がこれらを潰したら検証で落ちる）。
-- ※ これは service role 相当（postgres）による当社運用の書込を模したもの。
update public.org_channel_policy
  set allow_code_only = true,
      shared_bot_access = 'granted',
      state = 'soft',
      granted_at = now()
  where org_id = '00000000-0000-0000-0000-0000000d0001';

-- (C) O_NOROW は org_billing を持たない＝policy 行が無い（暗黙デフォルト運用の org）。
--     ここで行が無いことを明示的に確認しておく（前提が崩れたら以降の insert 経路検証が無意味になる）。
do $$
begin
  if exists (select 1 from public.org_channel_policy where org_id = '00000000-0000-0000-0000-0000000d0002') then
    raise exception 'setup broken: O_NOROW must not have an org_channel_policy row';
  end if;
  if not exists (select 1 from public.org_channel_policy where org_id = '00000000-0000-0000-0000-0000000d0001') then
    raise exception 'setup broken: O_ROW must have an org_channel_policy row (backfill 済み前提)';
  end if;
end $$;

-- (D) task_due_reminder_occurrences スタブ ＋ 既存 occurrence -------------------
--     20260721133427_due_reminder_pr0.sql の定義から、本 migration の掃除 DELETE が使う列を再現。
create table if not exists public.task_due_reminder_occurrences (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null,
  kind           text not null check (kind in ('due_soon', 'due_today', 'overdue_confirm')),
  offset_minutes int  not null,
  due_snapshot   date not null,
  scheduled_at   timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'leased', 'sent', 'suppressed', 'canceled')),
  leased_until   timestamptz,
  attempt        int  not null default 0,
  send_count     int  not null default 0,
  sent_at        timestamptz,
  suppress_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (task_id, due_snapshot, offset_minutes)
);

-- 既定オフセット変更(-1440 廃止)の前に materialize 済みの occurrence 群。
--   削除されるべき: -1440 × pending（2件・別タスク）
--   残るべき:       -1440 × sent / -1440 × leased / -1440 × suppressed / 0 × pending / +1440 × pending
insert into public.task_due_reminder_occurrences
  (task_id, kind, offset_minutes, due_snapshot, scheduled_at, status) values
  ('00000000-0000-0000-0000-0000000f0001','due_soon',       -1440, current_date + 1, now(), 'pending'),
  ('00000000-0000-0000-0000-0000000f0002','due_soon',       -1440, current_date + 1, now(), 'pending'),
  ('00000000-0000-0000-0000-0000000f0003','due_soon',       -1440, current_date + 1, now(), 'sent'),
  ('00000000-0000-0000-0000-0000000f0004','due_soon',       -1440, current_date + 1, now(), 'leased'),
  ('00000000-0000-0000-0000-0000000f0005','due_soon',       -1440, current_date + 1, now(), 'suppressed'),
  ('00000000-0000-0000-0000-0000000f0001','due_today',          0, current_date,     now(), 'pending'),
  ('00000000-0000-0000-0000-0000000f0001','overdue_confirm', 1440, current_date - 1, now(), 'pending');
