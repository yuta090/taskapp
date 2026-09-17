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

-- 「自分の接続」の一覧（/settings/連携画面）と、org の接続数の数え上げ（プランの枠）に効かせる
create index if not exists idx_api_keys_oauth_user
  on public.api_keys(user_id) where issued_via = 'oauth' and is_active;
create index if not exists idx_api_keys_oauth_org
  on public.api_keys(org_id) where issued_via = 'oauth' and is_active;

-- =============================================================================
-- 5) 合鍵から「誰の・どの範囲か」を引く
-- =============================================================================

-- rpc_validate_api_key と同じ形を返す。違いは、引数が生の鍵ではなく合鍵の控えであること。
-- これにより OAuth の合鍵は /api/mcp でしか通らない（/api/tools は生のAPIキーしか見ない）。
create or replace function public.rpc_validate_oauth_token(p_token_hash text)
returns table (
  org_id uuid,
  space_id uuid,
  key_id uuid,
  user_id uuid,
  scope text,
  allowed_space_ids uuid[],
  allowed_actions text[]
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  select
    ak.org_id,
    ak.space_id,
    ak.id,
    ak.user_id,
    ak.scope,
    ak.allowed_space_ids,
    ak.allowed_actions
  from public.oauth_tokens ot
  join public.api_keys ak on ak.id = ot.api_key_id
  where ot.token_hash = p_token_hash
    and ot.kind = 'access'
    and ot.revoked_at is null
    and ot.expires_at > now()
    and ak.is_active = true
    and (ak.expires_at is null or ak.expires_at > now());

  -- 最後に使われた時刻を残す（放置された接続を片づけるため）
  update public.oauth_clients c
     set last_used_at = now()
    from public.oauth_tokens ot
   where ot.token_hash = p_token_hash
     and c.client_id = ot.client_id;
end;
$function$;

revoke execute on function public.rpc_validate_oauth_token(text) from public, anon, authenticated;
grant execute on function public.rpc_validate_oauth_token(text) to service_role;

-- 引換券・合鍵の使い回しを見つけたら、その系列を丸ごと失効させる。
-- 1本でも使い回されたら、盗まれたと見なして全部止めるのが安全側。
create or replace function public.revoke_oauth_token_family(p_family_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  update public.oauth_tokens
     set revoked_at = now()
   where family_id = p_family_id
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke execute on function public.revoke_oauth_token_family(uuid) from public, anon, authenticated;
grant execute on function public.revoke_oauth_token_family(uuid) to service_role;

-- =============================================================================
-- 6) 放置された登録・期限切れの控えを片づける
-- =============================================================================

-- 登録は誰でもできるので、使われないまま溜まる。溜めても権限は増えないが、
-- 名簿が膨らむと運用で見づらくなるため定期的に消す。
-- HTTP を呼ばずSQLだけで済むので、pg_cron から直接回す。
create or replace function public.cleanup_oauth_clients()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  -- 使われたことがないまま7日たった登録／最後に使われてから90日たった登録
  delete from public.oauth_clients
   where (last_used_at is null and created_at < now() - interval '7 days')
      or (last_used_at is not null and last_used_at < now() - interval '90 days');
  get diagnostics v_count = row_count;

  -- 期限切れの引換券・合鍵（cascade で消えない分）
  delete from public.oauth_authorization_codes where expires_at < now() - interval '1 day';
  delete from public.oauth_tokens where expires_at < now() - interval '7 days';

  return v_count;
end;
$function$;

revoke all on function public.cleanup_oauth_clients() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'cleanup-oauth-clients') then
      -- 毎日 4:23（他の定期処理と時刻をずらす）
      perform cron.schedule('cleanup-oauth-clients', '23 4 * * *', 'select public.cleanup_oauth_clients()');
    end if;
  end if;
end $$;

-- =============================================================================
-- 7) 二要素認証の関門（RLS を有効にした表には必ず要る）
-- =============================================================================

-- RLS を有効にした表には、認証アプリを登録済みの人がコード未入力のまま触れないよう
-- RESTRICTIVE ポリシーを必ず1本置く（20260907142526_mfa_rls_enforcement.sql の約束）。
-- この3表は service_role からしか触らない想定だが、**表を足したら必ずここも足す**。
-- 空DBからの再生の検査（scripts/verify-migrations-from-scratch.sh）が抜けを見つける。
do $$
declare
  t text;
begin
  foreach t in array array['oauth_clients', 'oauth_authorization_codes', 'oauth_tokens']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'mfa_required_when_enrolled'
    ) then
      execute format(
        'create policy mfa_required_when_enrolled on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
        t
      );
    end if;
  end loop;
end $$;

-- ロールバック:
--   select cron.unschedule('cleanup-oauth-clients');
--   drop function if exists public.cleanup_oauth_clients();
--   drop index if exists public.idx_api_keys_oauth_org;
--   drop index if exists public.idx_api_keys_oauth_user;
--   alter table public.api_keys drop column if exists oauth_client_id;
--   alter table public.api_keys drop constraint if exists api_keys_issued_via_check;
--   alter table public.api_keys drop column if exists issued_via;
--   drop table if exists public.oauth_tokens;
--   drop table if exists public.oauth_authorization_codes;
--   drop table if exists public.oauth_clients;
