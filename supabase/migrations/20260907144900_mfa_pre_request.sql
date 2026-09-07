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

-- 事前確認: 関数の所有者(postgres)が auth.mfa_factors を読めなければ、ここで止める（適用後に全断させない）
do $$
begin
  perform 1 from auth.mfa_factors limit 1;
exception when insufficient_privilege then
  raise exception 'auth.mfa_factors を読めません。二要素認証の migration は適用できません';
end $$;

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
  blocked boolean := false;
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
    blocked := exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified');
  exception when others then
    -- 判定できないとき（権限・型・一時障害）は通す。RLS 側の mfa_satisfied が二重に守る。全断はさせない
    blocked := false;
  end;
  -- raise は例外ブロックの外で（自分の 42501 を上の handler に食われないように）
  if blocked then
    raise exception 'mfa_required' using errcode = '42501', hint = '二要素認証のコード入力が必要です';
  end if;
end $$;

comment on function public.mfa_pre_request() is
  'PostgREST db_pre_request: 二要素認証を登録済みの利用者が aal1 のままテーブル/RPC を叩いたら 42501。anon/service_role は素通り';

revoke all on function public.mfa_pre_request() from public;
grant execute on function public.mfa_pre_request() to authenticator, anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.mfa_pre_request';
notify pgrst, 'reload config';

-- 自己チェック: この設定はスキーマではなくロール設定（pg_db_role_setting）で、pg_dump に含まれず、
-- ブランチ作成・別プロジェクトへのリストア・ロール設定の再適用で消えうる。消えると rpc_* の二要素認証だけが
-- 黙って無効になるので、運営画面（admin layout）が毎回この関数で確認し、外れていれば赤い帯を出す。
create or replace function public.mfa_enforcement_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pre_request', exists (
      select 1 from pg_catalog.pg_db_role_setting s
      join pg_catalog.pg_roles r on r.oid = s.setrole
      where r.rolname = 'authenticator'
        and exists (select 1 from unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%mfa_pre_request%')
    ),
    'policy_missing', (
      select coalesce(jsonb_agg(t.tablename), '[]'::jsonb) from pg_catalog.pg_tables t
      where t.schemaname = 'public' and t.rowsecurity
        and not exists (
          select 1 from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename = t.tablename and p.policyname = 'mfa_required_when_enrolled'
        )
    )
  )
$$;
revoke all on function public.mfa_enforcement_status() from public;
grant execute on function public.mfa_enforcement_status() to service_role;

-- ついで（レビュー L2）: アプリ未使用の旧ビュー v_client_* は security_invoker が無く基テーブルの RLS を通らない。
-- authenticated/anon から読めないようにする（service role は影響なし）
do $$
declare v text;
begin
  foreach v in array array['v_client_tasks', 'v_client_wiki', 'v_client_milestones', 'v_client_discussion_items'] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end $$;
