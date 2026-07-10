-- LP/contactフォームのリード保存テーブル。
-- 書き込みは /api/leads (service role) のみ。クライアント(anon/authenticated)からは
-- 読み書きさせないため、RLS有効化のうえポリシーを一切作らない + 権限をREVOKEする。
-- 閲覧は当面 Supabase ダッシュボード or 管理パネル(将来)から。

create table if not exists public.lp_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(source) between 1 and 32),
  email text not null check (char_length(email) <= 254),
  name text check (char_length(name) <= 100),
  company text check (char_length(company) <= 200),
  message text check (char_length(message) <= 2000),
  extra jsonb,
  user_agent text,
  referer text,
  created_at timestamptz not null default now()
);

create index if not exists lp_leads_created_idx on public.lp_leads (created_at desc);
create index if not exists lp_leads_source_idx on public.lp_leads (source, created_at desc);

alter table public.lp_leads enable row level security;

revoke all on table public.lp_leads from anon, authenticated;
