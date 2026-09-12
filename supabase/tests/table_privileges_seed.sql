-- =============================================================================
-- public の表・ビュー・シーケンスの権限（*_table_privileges.sql）の検証用データと、当てる前の形の控え
-- run_table_privileges.sh が、本 migration の手前までの migrations のあと・本 migration の前に流す。postgres で入れる。
--
-- 組織 O1・space S1（プロジェクト）。人物: own = O1 owner・S1 admin（タスクを作れる人）
-- 公開中のブログ記事 1・表示中の案内枠 1・料金表 1 行
-- 当てる前の形の控え（schema snap。public ではないので migration の対象外）:
--   snap.authenticated_rw   authenticated の表とビューの select / insert / update / delete・シーケンスの usage
--   snap.column_grants      列ごとの付与
--   snap.service_role       service_role の表・ビュー・シーケンスの権限
-- =============================================================================

insert into public.organizations(id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'o1');

insert into auth.users(id) values
  ('00000000-0000-0000-0000-00000000c001');

insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', 'owner');

insert into public.spaces(id, org_id, type, name) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'project', 's1');

insert into public.space_memberships(space_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'admin');

insert into public.cta_blocks(id, key, name, heading, button_label, button_url) values
  ('00000000-0000-0000-0000-00000000f001', 'cta-1', 'cta', 'heading', 'go', '/signup');

insert into public.blog_posts(id, slug, title, status, published_at) values
  ('00000000-0000-0000-0000-00000000f002', 'post-1', 'post', 'published', now() - interval '1 day');

insert into public.plans(id, name) values
  ('probe-plan', 'probe');

create schema if not exists snap;

create table snap.authenticated_rw as
select c.relname::text as relname, a.privilege_type::text as privilege_type
  from pg_class c, aclexplode(c.relacl) a
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
   and a.grantee = 'authenticated'::regrole
   and ((c.relkind <> 'S' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
     or (c.relkind = 'S' and a.privilege_type = 'USAGE'));

create table snap.column_grants as
select c.relname::text as relname, at.attname::text as attname, x.grantee::regrole::text as grantee,
       x.privilege_type::text as privilege_type
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid,
       aclexplode(at.attacl) x
 where c.relnamespace = 'public'::regnamespace
   and at.attnum > 0 and not at.attisdropped;

create table snap.service_role as
select c.relname::text as relname, a.privilege_type::text as privilege_type
  from pg_class c, aclexplode(c.relacl) a
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
   and a.grantee = 'service_role'::regrole;
