-- TASK6 テンプレ配布（中間CV）のリード保存テーブル + 配布用の非公開Storageバケット。
-- 書き込みは /api/task6/leads (service role) のみ。lp_leads と同じ流儀:
-- RLS有効化のうえポリシーを一切作らない + anon/authenticated から REVOKE。
-- 閲覧は当面 Supabase ダッシュボード or 管理パネル(将来)から。

create table if not exists public.template_leads (
  id uuid primary key default gen_random_uuid(),
  -- API側で小文字化して保存する（重複判定を大文字小文字で割らないため）
  email text not null check (char_length(email) <= 254),
  -- カタログ(src/lib/task6/leadMagnets.ts)のkeyと同じ形式
  template_key text not null check (template_key ~ '^[a-z0-9-]{1,64}$'),
  -- お知らせ配信の同意（特定電子メール法対応: 明示チェックのみtrue）
  newsletter_opt_in boolean not null default false,
  -- どの記事から来たか（サイト内パスのみ）
  source_path text check (char_length(source_path) <= 200),
  user_agent text,
  referer text,
  created_at timestamptz not null default now(),
  -- 再申込（リンク失効後など）のたびに更新
  last_requested_at timestamptz not null default now()
);

-- 同じメール×同じテンプレは1行（再申込はUPDATE扱い）
create unique index if not exists template_leads_email_key_uq
  on public.template_leads (email, template_key);
create index if not exists template_leads_created_idx
  on public.template_leads (created_at desc);
create index if not exists template_leads_key_idx
  on public.template_leads (template_key, created_at desc);

alter table public.template_leads enable row level security;

revoke all on table public.template_leads from anon, authenticated;

-- テンプレ配布物の非公開バケット。DLは署名URL（service role発行）のみ。
-- storage.objects にポリシーは付与しない（意図的・files_feature と同方針）
insert into storage.buckets (id, name, public, file_size_limit)
values ('task6-templates', 'task6-templates', false, 26214400) -- 25MB
on conflict (id) do nothing;
