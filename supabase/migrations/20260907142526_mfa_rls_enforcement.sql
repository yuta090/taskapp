-- 二要素認証（TOTP）を登録した利用者は、コード入力済み(aal2)でなければデータに触れない（Fable 裁定 2026-09-07）
--
-- これまでは画面の門番（src/proxy.ts）と運営 API でしか強制しておらず、パスワードを盗んだ攻撃者が
-- コード入力前(aal1)のトークンで Supabase REST / 一般 API を直接叩けば読み書きできた。
-- ここで DB 側（RLS）に「登録済みなら aal2 必須」を RESTRICTIVE ポリシーとして全テーブルに足す。
-- 未登録の利用者は従来どおり（何も変わらない）。service role は RLS の対象外（cron/webhook は影響なし）。
--
-- ⚠ 新しく RLS 付きテーブルを作ったら、同じポリシーを足すこと（下の DO ブロックを再実行すれば漏れ分だけ付く）。

-- 事前確認: 関数の所有者(postgres)が auth.mfa_factors を読めなければ、ここで止める（適用後に全クエリをエラーにしない）
do $$
begin
  perform 1 from auth.mfa_factors limit 1;
exception when insufficient_privilege then
  raise exception 'auth.mfa_factors を読めません。二要素認証の migration は適用できません';
end $$;

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- aal2（コード入力済み）なら OK。そうでなくても、確認済みの認証アプリを1つも登録していなければ OK
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      )
$$;

comment on function public.mfa_satisfied() is
  '二要素認証を登録済みの利用者は aal2 のときだけ true。未登録は常に true。RLS の RESTRICTIVE ポリシーから (select public.mfa_satisfied()) で呼ぶ';

revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and rowsecurity
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t.tablename and policyname = 'mfa_required_when_enrolled'
    ) then
      execute format(
        'create policy mfa_required_when_enrolled on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
        t.tablename
      );
    end if;
  end loop;
end $$;
