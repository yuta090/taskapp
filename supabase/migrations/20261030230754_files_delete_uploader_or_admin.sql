-- ファイルを消せるのは、アップロードした本人と管理者だけにする。
-- これまでは社内メンバーなら（閲覧者でも）他人のファイルを消せた。
--
-- 新しいコード（API が app_can_manage_space_files で確かめる版）が本番に出てから当てる。
-- 理由は 20261030230753_files_delete_admin_helper.sql を参照。
drop policy if exists "internal members or uploader can delete files" on public.files;
drop policy if exists "uploader or admin can delete files" on public.files;
create policy "uploader or admin can delete files" on public.files for delete using (
  uploaded_by = auth.uid()
  or public.app_can_manage_space_files(space_id, org_id)
);

-- ロールバック:
--   drop policy if exists "uploader or admin can delete files" on public.files;
--   create policy "internal members or uploader can delete files" on public.files for delete using (
--     uploaded_by = auth.uid()
--     or exists (
--       select 1 from public.space_memberships sm
--       where sm.space_id = files.space_id
--         and sm.user_id = auth.uid()
--         and sm.role not in ('client', 'vendor')
--     )
--   );
