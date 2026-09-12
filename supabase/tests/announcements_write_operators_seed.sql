-- =============================================================================
-- お知らせを作る・変える・消すのは運営だけ（*_announcements_write_operators.sql）の検証用データ
-- run_announcements_write_operators.sh が、本 migration の手前までの migrations のあと・本 migration の前に流す
-- （既にある行がそのまま残ることを確かめるため）。postgres で入れる（RLS は通らない）。
--
-- 組織: O1・O2
-- 人物（profiles は auth.users に入れると on_auth_user_created が作る）:
--   sa  = 運営（どの組織にも入っていない・二要素認証の登録なし）
--   sa2 = 運営（どの組織にも入っていない・確認済みの認証アプリあり）
--   own = O1 owner      mem = O1 member      cl = O1 client      out = どの組織にも入っていない
-- お知らせ:
--   g_pub  = 全体向け・公開中      g_draft  = 全体向け・非公開
--   o1_pub = O1 向け・公開中       o1_draft = O1 向け・非公開      o2_pub = O2 向け・公開中
-- =============================================================================

insert into public.organizations(id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'o1'),
  ('00000000-0000-0000-0000-00000000a002', 'o2');

insert into auth.users(id) values
  ('00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-00000000c003'),
  ('00000000-0000-0000-0000-00000000c004'),
  ('00000000-0000-0000-0000-00000000c005'),
  ('00000000-0000-0000-0000-00000000c006');

-- 運営の旗（postgres なので profiles_superadmin_guard を通る）
update public.profiles set is_superadmin = true
 where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002');

insert into auth.mfa_factors(user_id, status) values
  ('00000000-0000-0000-0000-00000000c002', 'verified');

insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c003', 'owner'),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c004', 'member'),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c005', 'client');

insert into public.announcements(id, org_id, title, published) values
  ('00000000-0000-0000-0000-00000000e001', null, 'g_pub', true),
  ('00000000-0000-0000-0000-00000000e002', null, 'g_draft', false),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000a001', 'o1_pub', true),
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-00000000a001', 'o1_draft', false),
  ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-00000000a002', 'o2_pub', true);

-- profiles が作られ、運営が2人いる（作られていないと、以降の確かめが別の理由で落ちる）
do $$
begin
  if (select count(*) from public.profiles where is_superadmin) <> 2 then
    raise exception 'seed: 運営が2人になっていません（profiles が作られていない?）';
  end if;
end $$;
