-- なりすましログイン対策: 新しい端末からの初回ログインを検知するための記録テーブル
--
-- 端末は httpOnly cookie（agentpm_device・ランダム32byte hex）で識別する。この cookie が
-- 無い/未知の device_id で来たら「新しい端末」と判定し、本人にメール通知する
-- （src/lib/auth/loginNotify.ts）。同じ端末からの2回目以降は送らない。
--
-- アクセス境界: 利用者本人の端末情報だが、突合や不正検知のための記録であり利用者自身が
-- 読み書きする画面は無いため、他の運営専用テーブル（email_templates 等）と同じ型で
-- RLS を有効にしてポリシーを一切作らない = service role 専用。
--   読み書きの経路: src/lib/auth/loginNotify.ts（createAdminClient 経由）

create table if not exists public.user_known_devices (
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_id     text not null,
  user_agent    text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, device_id)
);

comment on table public.user_known_devices is
  'ログイン端末の既知判定（新しい端末からの初回ログイン通知メール用）。service role 専用（RLS有効・ポリシー無し）';

alter table public.user_known_devices enable row level security;

-- 念のため既定 GRANT も落とす（RLS ポリシー無しでも到達させない）
revoke all on table public.user_known_devices from anon, authenticated;

-- TODO: last_seen_at が400日（cookie の有効期限）を超えた行の掃除は今回はやらない。
-- 効果は「端末が古くなったら再度『新しい端末』として通知される」程度で実害が小さいため、
-- 掃除バッチ（cron）は必要になった時点で別PRとして追加する。
