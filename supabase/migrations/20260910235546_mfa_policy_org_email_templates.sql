-- 二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）の付け忘れを補う
--
-- 20260907142526_mfa_rls_enforcement.sql は「その時点で RLS の付いた全テーブル」にポリシーを足した。
-- その後に作った org_email_templates（20260909080528）には付いていなかった
-- （scripts/verify-migrations-from-scratch.sh の点検で発見。2026-09-10 時点で本番も同じ状態）。
-- 元の DO ブロックと同じもの。すでに付いているテーブルは触らないので、何度流しても同じ結果になる。
--
-- ⚠ 新しく RLS 付きテーブルを作ったら、同じポリシーを足すこと（このブロックを新しい migration で再実行すればよい）。

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
