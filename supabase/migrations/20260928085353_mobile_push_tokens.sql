-- スマホアプリ（apps/mobile）のプッシュ通知の宛先
-- - mobile_push_tokens: 端末（アプリの入れ直しごと）の Expo プッシュトークン。利用者は自分の行だけ見る・消す。
-- - 書き込みは rpc_register_mobile_push_token だけ（同じ端末を別の人が使ったときに所有者を移すため。
--   他人の行は RLS で見えないので、利用者の insert/upsert では移せない。Web の /api/push/subscribe と同じ考え方）。
-- - 送信は /api/push/dispatch（notifications の INSERT トリガーから呼ばれる既存の経路）が Web Push と一緒に行う。
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/MIGRATION_AUDIT_2026-07-05.md 参照）

create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$' and length(token) <= 200),
  platform text not null check (platform in ('ios', 'android')),
  app_version text null check (app_version is null or length(app_version) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz null
);

create index if not exists mobile_push_tokens_user_idx on public.mobile_push_tokens(user_id);

alter table public.mobile_push_tokens enable row level security;

drop policy if exists "users can view own mobile push tokens" on public.mobile_push_tokens;
create policy "users can view own mobile push tokens" on public.mobile_push_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "users can delete own mobile push tokens" on public.mobile_push_tokens;
create policy "users can delete own mobile push tokens" on public.mobile_push_tokens
  for delete to authenticated using (user_id = auth.uid());

-- 2段階認証を登録した人は aal2 のときだけ（20260907142526_mfa_rls_enforcement.sql の一括付与は
-- 当時あった表にしか付いていないので、新しい表には自分で付ける）
drop policy if exists mfa_required_when_enrolled on public.mobile_push_tokens;
create policy mfa_required_when_enrolled on public.mobile_push_tokens
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- insert/update は渡さない（書き込みは下の RPC だけ）。service_role（dispatch）は RLS の外
grant select, delete on table public.mobile_push_tokens to authenticated;

create or replace function public.rpc_register_mobile_push_token(
  p_token text,
  p_platform text,
  p_app_version text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  -- SECURITY DEFINER は RLS（mfa_required_when_enrolled）を素通りするので、ここで確かめる
  if not public.mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$' or length(p_token) > 200 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  -- 同じ端末を別の人が使ったら、前の人の行を消して移す（前の人の通知をこの端末に届けない）
  delete from public.mobile_push_tokens where token = p_token and user_id <> v_uid;

  insert into public.mobile_push_tokens (user_id, token, platform, app_version)
  values (v_uid, p_token, p_platform, left(p_app_version, 32))
  on conflict (token) do update
    set platform = excluded.platform,
        app_version = excluded.app_version,
        updated_at = now();
end;
$$;

revoke all on function public.rpc_register_mobile_push_token(text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_register_mobile_push_token(text, text, text) to authenticated;
