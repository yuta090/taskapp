-- ファイルを誰の分でも消せる人の判定（組織の owner、または社内メンバーでこのプロジェクトの admin）。
-- 画面の判定は canManageSpaceFiles（src/lib/roles/spaceRoles.ts）と同じ規則。
-- API（DELETE /api/files/[id]）と次の migration のポリシーの両方がこれを使う。
--
-- ポリシーを締める migration とは分けて当てる。今の本番コードは自前の確認を通したあと
-- Storage の実体を消してから行を消すので、コードより先にポリシーだけ締まると、
-- 編集者が他人のファイルを消したときに「実体だけ消えて行が残る」状態になる。
create or replace function public.app_can_manage_space_files(p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
     and (
       exists (
         select 1 from public.org_memberships om
         where om.org_id = p_org and om.user_id = auth.uid() and om.role = 'owner'
       )
       or (
         public.app_is_org_internal(p_org)
         and public.app_space_role_of_caller(p_space) = 'admin'
       )
     );
$$;

comment on function public.app_can_manage_space_files(uuid, uuid) is
  'ファイルを誰の分でも消せるか（組織の owner、または社内メンバーでこのプロジェクトの admin）';

revoke all on function public.app_can_manage_space_files(uuid, uuid) from public, anon;
grant execute on function public.app_can_manage_space_files(uuid, uuid) to authenticated, service_role;

-- ロールバック:
--   drop function if exists public.app_can_manage_space_files(uuid, uuid);
