-- ブログCMS: cta_blocks（CTAマスタ）＋ blog_posts（記事）
-- 公開ページ /blog は anon（未ログイン）で published 記事のみ読める。
-- 書き込みは API ルート（verifySuperadmin → service role）で行うため、書き込みRLSは作らない。
-- 参照: docs/spec/BLOG_CMS_SPEC.md

-- ── cta_blocks（blog_posts が FK 参照するため先に作る） ──
create table if not exists public.cta_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9-]+$' and char_length(key) between 1 and 60),
  name text not null check (char_length(name) between 1 and 120),
  heading text not null check (char_length(heading) between 1 and 200),
  body text check (char_length(body) <= 500),
  button_label text not null check (char_length(button_label) between 1 and 60),
  -- 相対パス(/...) か https:// のみ許可（javascript: 等のスキームを排除）
  button_url text not null check (button_url ~ '^(/|https://)'),
  variant text not null default 'inline' check (variant in ('inline', 'band', 'card')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── blog_posts ──
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$' and char_length(slug) between 1 and 120),
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 200),
  body_md text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  cover_image_url text check (cover_image_url is null or cover_image_url ~ '^(/|https://)'),
  tags text[] not null default '{}',
  author_name text check (author_name is null or char_length(author_name) <= 60),
  inline_cta_id uuid references public.cta_blocks(id) on delete set null,
  footer_cta_id uuid references public.cta_blocks(id) on delete set null,
  noindex boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_posts_status_published_idx
  on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_tags_idx
  on public.blog_posts using gin (tags);

-- ── RLS: 公開読み取りのみ。書き込みは service role（RLSバイパス）。 ──
alter table public.cta_blocks enable row level security;
alter table public.blog_posts enable row level security;

drop policy if exists "anyone can view enabled cta blocks" on public.cta_blocks;
create policy "anyone can view enabled cta blocks" on public.cta_blocks
  for select using (enabled = true);

drop policy if exists "anyone can view published posts" on public.blog_posts;
create policy "anyone can view published posts" on public.blog_posts
  for select using (
    status = 'published'
    and published_at is not null
    and published_at <= now()
  );

-- Stage0 で anon から権限剥奪済みのため、公開読みには明示 grant が必要
grant select on public.cta_blocks to anon, authenticated;
grant select on public.blog_posts to anon, authenticated;

-- ── updated_at 自動更新(既存テーブル群と同じ方式) ──
create or replace function public.update_cta_blocks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cta_blocks_updated_at on public.cta_blocks;
create trigger trg_cta_blocks_updated_at
  before update on public.cta_blocks
  for each row execute function public.update_cta_blocks_updated_at();

create or replace function public.update_blog_posts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_blog_posts_updated_at on public.blog_posts;
create trigger trg_blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.update_blog_posts_updated_at();

-- ── 初期CTA: /contact 1本で走り出す（診断が公開されたら管理画面から追加） ──
insert into public.cta_blocks (key, name, heading, body, button_label, button_url, variant)
values (
  'contact',
  '無料相談（デフォルト）',
  '資料回収の悩み、一度話してみませんか',
  '御社の状況をうかがって、AI秘書で何をどこまで肩代わりできるかをお伝えします。',
  '無料で相談する',
  '/contact',
  'band'
)
on conflict (key) do nothing;
