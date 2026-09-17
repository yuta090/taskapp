-- リモートMCP（ChatGPT 等の外部チャット）のためのログイン許可の仕組み。
--
-- ChatGPT のコネクタは、APIキーの貼り付けを受け付けず OAuth を要求する。そのため
-- AgentPM 自身が「許可を出す側」になる。ここではその3つの表を作る。
--
-- 設計の要点（Fable 裁定）:
--  * 登録(Dynamic Client Registration)は誰でもできるが、**登録しただけでは何の権限も付かない**。
--    できるのは許可を求める画面を開くことだけで、ログイン済み本人が同意しない限り何も出ない。
--  * 同意の結果は api_keys の行として表す（認可の正本は mcp_authorize のまま・入口を増やさない）。
--  * 生の文字列は保存しない。すべて SHA-256 の控えだけを持つ。
--  * どの表も service_role からしか触らない（RLS は有効にしてポリシーを作らない）。

-- =============================================================================
-- 1) つなぎ先（クライアント）の登録
-- =============================================================================

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  -- 公開される識別子。秘密ではない
  client_id text unique not null default encode(gen_random_bytes(16), 'hex'),
  -- 表示名。同意画面にそのまま出す（リンクにはしない）
  client_name text not null,
  -- 戻り先。完全一致でしか受け付けない
  redirect_uris text[] not null,
  -- 登録元の目印。同じ相手からの登録を数えてレート制限する（IPそのものは保存しない）
  registrant_ip_hash text,
  -- 実際に使われた最後の時刻。未使用のまま放置された登録を片づけるために使う
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_clients_name_len check (char_length(client_name) between 1 and 64),
  constraint oauth_clients_redirect_count check (array_length(redirect_uris, 1) between 1 and 5)
);

create index if not exists idx_oauth_clients_client_id on public.oauth_clients(client_id);
-- 片づけ用（未使用7日・最終使用90日で消す cron が使う）
create index if not exists idx_oauth_clients_cleanup on public.oauth_clients(last_used_at nulls first, created_at);
create index if not exists idx_oauth_clients_ip_created on public.oauth_clients(registrant_ip_hash, created_at desc);

alter table public.oauth_clients enable row level security;

comment on table public.oauth_clients is
  'リモートMCPにつなぐ相手（ChatGPT等）の登録。登録しただけでは権限は無く、本人の同意が要る';

-- =============================================================================
-- 2) 許可コード（同意画面 → つなぎ先 に一度だけ渡す引換券）
-- =============================================================================

create table if not exists public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text unique not null,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  redirect_uri text not null,
  -- PKCE。S256 のみ（plain は受け付けない）
  code_challenge text not null,
  -- 同意した操作の範囲。read だけか、read+write か
  allowed_actions text[] not null default array['read'],
  -- 使ったらここが埋まる。一度きり
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  constraint oauth_codes_actions check (allowed_actions <@ array['read', 'write'])
);

create index if not exists idx_oauth_codes_hash on public.oauth_authorization_codes(code_hash);
create index if not exists idx_oauth_codes_cleanup on public.oauth_authorization_codes(expires_at);

alter table public.oauth_authorization_codes enable row level security;

comment on table public.oauth_authorization_codes is
  '同意の引換券。5分・一度きり。使い回しを検知したら、そこから出たトークンを全部失効させる';

-- =============================================================================
-- 3) トークン（つなぎ先が毎回の呼び出しに使う合鍵）
-- =============================================================================

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- この同意に対応する api_keys の行。実際の権限判定はここ経由で mcp_authorize が行う
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  -- 付け替えの系列。1本でも使い回されたら、この系列を丸ごと失効させる
  family_id uuid not null default gen_random_uuid(),
  -- 元になった引換券。引換券の使い回しを検知したときに、ここから辿って失効させる
  authorization_code_id uuid references public.oauth_authorization_codes(id) on delete set null,
  revoked_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_tokens_hash on public.oauth_tokens(token_hash);
create index if not exists idx_oauth_tokens_family on public.oauth_tokens(family_id);
create index if not exists idx_oauth_tokens_api_key on public.oauth_tokens(api_key_id);
create index if not exists idx_oauth_tokens_cleanup on public.oauth_tokens(expires_at) where revoked_at is null;

alter table public.oauth_tokens enable row level security;

comment on table public.oauth_tokens is
  'リモートMCPの合鍵。控え(SHA-256)だけを保存する。access=1時間, refresh=30日で付け替え';

-- =============================================================================
-- 4) api_keys に「どうやって発行されたか」を足す
-- =============================================================================

alter table public.api_keys
  add column if not exists issued_via text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.api_keys'::regclass and conname = 'api_keys_issued_via_check'
  ) then
    alter table public.api_keys
      add constraint api_keys_issued_via_check check (issued_via in ('manual', 'oauth'));
  end if;
end $$;

alter table public.api_keys
  add column if not exists oauth_client_id text references public.oauth_clients(client_id) on delete cascade;

comment on column public.api_keys.issued_via is
  'manual=画面で発行した鍵, oauth=外部チャットの接続時に本人の同意でできた鍵';
comment on column public.api_keys.oauth_client_id is
  'issued_via=oauth のとき、どのつなぎ先（ChatGPT等）に出した鍵か';

create index if not exists idx_api_keys_oauth_client
  on public.api_keys(oauth_client_id) where oauth_client_id is not null;

-- ロールバック:
--   alter table public.api_keys drop column if exists oauth_client_id;
--   alter table public.api_keys drop constraint if exists api_keys_issued_via_check;
--   alter table public.api_keys drop column if exists issued_via;
--   drop table if exists public.oauth_tokens;
--   drop table if exists public.oauth_authorization_codes;
--   drop table if exists public.oauth_clients;
