-- 二要素認証: PostgREST の全リクエスト前に走る関数（pre-request）で「登録済み × コード未入力(aal1)」を弾く
--
-- 前の migration（mfa_rls_enforcement）の RESTRICTIVE ポリシーはテーブル直接アクセスには効くが、
-- SECURITY DEFINER の rpc_* は所有者権限で RLS を通らず素通りしていた（レビューで実測）。
-- PostgREST の db_pre_request はテーブルも RPC も含む全リクエストの前に呼ばれるので、ここで1か所止める。
-- RLS 側のポリシーは Realtime（PostgREST を通らない）と多重防御のために残す。
--
-- 挙動: role=authenticated かつ aal≠aal2 かつ 確認済み factor あり → 42501（PostgREST は 403）。
--       anon / service_role / 未登録 は何もしない。factor 参照に失敗しても全断させない（RLS 側が二重に守る）。
-- 反映: authenticator ロール設定 + NOTIFY pgrst で即時。戻すときは `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`

create or replace function public.mfa_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  uid uuid;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return;
  end;
  if claims is null or coalesce(claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  if coalesce(claims ->> 'aal', '') = 'aal2' then
    return;
  end if;
  begin
    uid := (claims ->> 'sub')::uuid;
    if exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified') then
      raise exception 'mfa_required' using errcode = '42501', hint = '二要素認証のコード入力が必要です';
    end if;
  exception
    when insufficient_privilege then
      -- 自分の raise（42501）だけは通す
      raise;
    when others then
      -- 判定できないときは全断させない（RLS の mfa_satisfied が二重に守る）
      return;
  end;
end $$;

comment on function public.mfa_pre_request() is
  'PostgREST db_pre_request: 二要素認証を登録済みの利用者が aal1 のままテーブル/RPC を叩いたら 42501。anon/service_role は素通り';

revoke all on function public.mfa_pre_request() from public;
grant execute on function public.mfa_pre_request() to authenticator, anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.mfa_pre_request';
notify pgrst, 'reload config';

-- ついで（レビュー L2）: アプリ未使用の旧ビュー v_client_* は security_invoker が無く基テーブルの RLS を通らない。
-- authenticated/anon から読めないようにする（service role は影響なし）
revoke all on public.v_client_tasks, public.v_client_wiki, public.v_client_milestones, public.v_client_discussion_items from anon, authenticated;
