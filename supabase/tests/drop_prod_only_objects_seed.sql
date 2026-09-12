-- =============================================================================
-- 本番にだけある物を無くす（*_drop_prod_only_objects.sql）の検証用データ
-- run_drop_prod_only_objects.sh が、本 migration の手前までの migrations のあと・本 migration の前に流す。
-- postgres で入れる（RLS は通らない）。1トランザクション。
--
-- 空の DB には「本番にだけある物」が無いので、本番の形（2026-09-12 の点検で記録した形）をここで作り、
-- 本 migration がそれを無くすところを確かめる:
--   public.user_preferences 表（列8・CHECK 2・ポリシー4〈読み / 追加 / 更新＋二要素〉・索引・更新日時のトリガーと関数・権限）
--   public.milestones.status 列（text・空を許す・既定 'backlog'）
-- そのうえで、無くならない物として組織・space・マイルストーン3行（status は既定値）を入れる。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 本番にだけある物（本 migration が無くす物）
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  font_size text not null default 'default' check (font_size in ('small', 'default', 'large')),
  week_starts_on text not null default 'monday' check (week_starts_on in ('sunday', 'monday')),
  default_home_view text not null default 'inbox',
  auto_assign_on_start boolean not null default false,
  auto_assign_to_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
create policy users_read_own_preferences on public.user_preferences for select using (auth.uid() = user_id);
create policy users_upsert_own_preferences on public.user_preferences for insert with check (auth.uid() = user_id);
create policy users_update_own_preferences on public.user_preferences for update using (auth.uid() = user_id);
create policy mfa_required_when_enrolled on public.user_preferences as restrictive to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create or replace function public.update_user_preferences_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;
create trigger trg_user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.update_user_preferences_updated_at();
-- 権限は本番の今の形（20260912143750_table_privileges.sql のあと）: anon には付かない
grant select, insert, update, delete on table public.user_preferences to authenticated, service_role;

alter table public.milestones add column if not exists status text default 'backlog';

-- ---------------------------------------------------------------------------
-- 無くならない物（組織 O1・space S1・マイルストーン3行・社内の編集者 ed）
-- ---------------------------------------------------------------------------
insert into public.organizations(id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'o1');

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000c001', 'own@example.com'),
  ('00000000-0000-0000-0000-00000000c002', 'ed@example.com');

insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', 'owner'),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c002', 'member');

insert into public.spaces(id, org_id, type, name) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'project', 's1');

insert into public.space_memberships(space_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'admin'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c002', 'editor');

insert into public.milestones(id, org_id, space_id, name, due_date, order_key) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b001',
   'm1', '2026-10-01', 1),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b001',
   'm2', '2026-11-01', 2),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b001',
   'm3', '2026-12-01', 3);
