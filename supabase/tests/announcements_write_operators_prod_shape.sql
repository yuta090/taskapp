-- =============================================================================
-- お知らせを作る・変える・消すのは運営だけ（*_announcements_write_operators.sql）の検証用: 本番の形
-- 本番で 2026-09-12 に読んだ、announcements の書き込みのポリシーと表の権限を再現する（postgres で流す）。
-- run_announcements_write_operators.sh が seed のあと、複製の片方（prod）にだけ流す
-- （本 migration が、空の DB から流した形と本番の形のどちらからでも、同じ形に着くことを確かめるため）。
-- 条件の md5（空白をつめて public. を外した文字列）が本番と同じことは、ハーネスが確かめる。
-- =============================================================================

drop policy if exists "Admins can manage announcements" on public.announcements;
create policy "Admins can manage announcements" on public.announcements
  for all
  using ( org_id is null or org_id in (select org_id from public.org_memberships where user_id = auth.uid() and role = 'admin') )
  with check ( org_id is null or org_id in (select org_id from public.org_memberships where user_id = auth.uid() and role = 'admin') );

grant all on table public.announcements to anon, authenticated, service_role;
