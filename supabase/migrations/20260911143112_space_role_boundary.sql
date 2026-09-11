-- =============================================================================
-- space の役割ごとの権限（社内の編集者 / 社内の閲覧者 / 相手先 client / vendor）を DB で定める
-- 確定設計: Fable 裁定 2026-09-11
-- 依存: 20260703_001_rls_helpers.sql（app_is_org_member / app_is_org_internal / app_can_access_space）,
--       20260703_002 / 004 / 007 / 010（space 単位・親参照の表の RLS）, 20240208_000_task_comments.sql,
--       20260907142526_mfa_rls_enforcement.sql（二要素認証の RESTRICTIVE）を先に適用。
--
-- 役割の呼び名（このファイルのコメントでの呼び方）:
--   社内         = org の役割が owner / admin / member で、その space の役割が client / vendor でない人
--   社内の編集者 = 社内のうち、space の役割が admin / editor の人（space の役割が無い社内メンバーも editor として扱う）
--   社内の閲覧者 = 社内のうち、space の役割が viewer の人
--   相手先       = space の役割が client の人 / vendor = space の役割が vendor の人
--
-- 役割ごとの権限（authenticated = ログインした利用者。service_role は RLS を通らず、ここでは変えない）:
--   書く
--     tasks / milestones / meetings / reviews / task_owners / task_events / task_relations / wiki_pages /
--     discussion_items / meeting_participants / spaces の insert / update / delete
--       … 社内の編集者だけ（新しい space を作る spaces の insert だけは、その組織の社内メンバー）。
--         閲覧者・相手先・vendor はログインのセッションからは書けない
--         （相手先・vendor の操作はサーバー側で、呼んだ人を確かめてから service role で行う）
--     task_comments … 自分の名前で、見えるタスクにだけ。社内（閲覧者を含む）はどの visibility でも、
--       相手先は 'client'・vendor は 'vendor' だけ。直す・消すのは自分のコメントだけ
--     wiki_page_versions / wiki_page_publications … 元の wiki のページの space で書ける人（社内の編集者）だけ
--     meetings.notes（社内向けの事前メモ）… authenticated は列ごと読めない・書けない（service role だけ）
--   読む
--     tasks / milestones / spaces … 変えない（tasks は app_task_visible_to_caller のまま）
--     meetings … 社内は全件。相手先・vendor は自分の space の進行中（in_progress）・終了（ended）だけ
--     meeting_participants / discussion_items / task_relations / task_owners / task_events … 社内だけ
--     reviews … 社内は全件。相手先・vendor は見えるタスクの分だけ
--     wiki_pages … 社内は全件。相手先・vendor は自分の space のページで、公開済みのマイルストーンに公開した分だけ
--     task_comments … 社内は全件。相手先は 'client'・vendor は 'vendor' の、見えるタスクの分だけ
--     wiki_page_versions / meeting_transcripts / meeting_drafts / task_publications … 社内だけ
--     milestone_publications … 社内は全件。相手先・vendor は自分の space のマイルストーンの、公開済みの分だけ
--     wiki_page_publications … 社内は全件。相手先・vendor は、上の milestone_publications が見えて公開済みの分だけ
--     review_approvals … 社内は全件。相手先・vendor は見えるレビューの分だけ
--   RPC
--     変更系の RPC 15 本（節 7）… 社内の編集者だけ
--     _create_task_notification … search_path を public に固定する（本文と実行権は変えない）
--   トリガー関数（enforce_review_gate / trg_check_milestone_completion / check_and_update_milestone /
--     enforce_personal_task_rules）… SECURITY DEFINER で動かす（呼んだ人の見え方に左右されずに、
--     レビューの確認・マイルストーンの完了・個人 space の確認をする）
--   変えない表: audit_logs / space_memberships / org_memberships（ポータルのサーバー側は相手先のセッションのまま、
--     監査ログを書き、同じ space のメンバーの役割を読む）
--   space と組織の対応: space_id の space が org_id の組織のものでない行は、社内としては読まない・書かない
--   マイルストーン: tasks / meetings の milestone_id は同じ space のものだけ。wiki_page_publications は、マイルストーンと
--     元のページ（source_page_id）がどちらも行の組織のもので、同じ space にあるときだけ（トリガーなので service role にも効く）
--   適用前の確認（節 0）: space と組織・マイルストーン・元のページが食い違う行が1件でもあれば止まる（何も変えない）
--
-- 適用の順番（重要）: 画面・API の変更（ポータルの書き込みを service role に移す・meetings の notes を読まない書かない・
--   meetings を select('*') で読まない）が本番に出たあとで適用する。先に適用すると、それらの画面の読み書きが権限エラーになる。
-- 冪等: create or replace / drop policy if exists → create / revoke → grant / alter function。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック節（後ろの節から順に流す。表・関数ごとに戻せる）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 適用前の確認 — space と組織・マイルストーン・元のページが食い違う行があれば止める（何も変えない）
--   本 migration の判定（space がその組織のものか・マイルストーンは同じ space か）は、行の組み合わせが
--   正しいことを前提にしている。食い違う行が1件でもあれば、その行を直してから流す。
-- =============================================================================

do $$
declare
  v_bad text := '';
  v_n bigint;
  t text;
begin
  -- 11 表（spaces を除く）と task_comments: space の組織 = 行の org_id
  foreach t in array array['tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_events', 'task_relations',
                           'wiki_pages', 'discussion_items', 'meeting_participants', 'task_comments'] loop
    execute format(
      'select count(*) from public.%I x join public.spaces s on s.id = x.space_id where s.org_id <> x.org_id', t)
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' %s(space と組織)=%s', t, v_n);
    end if;
  end loop;

  -- tasks / meetings: マイルストーンの space と組織 = 行の space と組織
  foreach t in array array['tasks', 'meetings'] loop
    execute format(
      'select count(*) from public.%I x join public.milestones m on m.id = x.milestone_id '
      'where m.space_id <> x.space_id or m.org_id <> x.org_id', t)
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' %s(マイルストーン)=%s', t, v_n);
    end if;
  end loop;

  -- wiki_page_publications: マイルストーンと元のページがどちらも行の組織のもので、同じ space にある
  select count(*)
    into v_n
    from public.wiki_page_publications p
    join public.milestones m on m.id = p.milestone_id
    join public.wiki_pages w on w.id = p.source_page_id
   where m.org_id <> p.org_id
      or w.org_id <> p.org_id
      or w.space_id <> m.space_id;
  if v_n > 0 then
    v_bad := v_bad || format(' wiki_page_publications(マイルストーン・元のページ)=%s', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'space role boundary: space と組織（またはマイルストーン・元のページ）が食い違う行があります。直してから流してください:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 節 1: 役割を見る関数
--   SECURITY DEFINER で space_memberships / org_memberships / spaces / wiki_pages を直接読む
--   （RLS を通らない＝ポリシーの再帰を作らない）。既存の app_is_org_internal / app_can_access_space は変えない。
-- =============================================================================

-- 呼んだ人の、その space の役割（space_memberships に行が無ければ NULL）
create or replace function public.app_space_role_of_caller(p_space uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.role
  from space_memberships s
  where s.space_id = p_space
    and s.user_id = auth.uid();
$$;

-- 社内として読めるか（space がその組織のもので、社内メンバーで、その space の役割が client / vendor でない。viewer を含む）
create or replace function public.app_is_space_internal(p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
     and public.app_is_org_internal(p_org)
     and coalesce(public.app_space_role_of_caller(p_space), 'editor') not in ('client', 'vendor');
$$;

-- 書けるか（space がその組織のもので、社内メンバーで、その space の役割が admin / editor。
--   space の役割が無い社内メンバーは editor として扱う）
create or replace function public.app_can_write_space(p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
     and public.app_is_org_internal(p_org)
     and coalesce(public.app_space_role_of_caller(p_space), 'editor') in ('admin', 'editor');
$$;

-- その wiki のページの space で書けるか（wiki_page_versions / wiki_page_publications の書き込みの判定）
--   ページを RLS を通らずに読む。wiki_pages の読み取りのポリシーは wiki_page_publications を読むので、
--   wiki_page_publications のポリシーから RLS を通して wiki_pages を読むと、ポリシーが互いを読み合う形になり
--   PostgreSQL が「infinite recursion detected in policy」で止める。そのためこの関数で確かめる。
create or replace function public.app_can_write_wiki_page(p_page uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from wiki_pages w
    where w.id = p_page
      and public.app_can_write_space(w.space_id, w.org_id)
  );
$$;

comment on function public.app_space_role_of_caller(uuid) is
  'RLS補助: 呼んだ人の、その space の役割（admin / editor / viewer / client / vendor。行が無ければ NULL）';
comment on function public.app_is_space_internal(uuid, uuid) is
  'RLS補助: 社内として読めるか（space がその組織のもので、org の役割が owner / admin / member で、space の役割が client / vendor でない）';
comment on function public.app_can_write_space(uuid, uuid) is
  'RLS補助: 書けるか（space がその組織のもので、org の役割が owner / admin / member で、space の役割が admin / editor。space の役割が無い社内メンバーは editor 扱い）';
comment on function public.app_can_write_wiki_page(uuid) is
  'RLS補助: その wiki のページの space で書けるか（app_can_write_space。ページは RLS を通らずに読む）';

revoke all on function public.app_space_role_of_caller(uuid) from public, anon;
revoke all on function public.app_is_space_internal(uuid, uuid) from public, anon;
revoke all on function public.app_can_write_space(uuid, uuid) from public, anon;
revoke all on function public.app_can_write_wiki_page(uuid) from public, anon;
grant execute on function public.app_space_role_of_caller(uuid) to authenticated, service_role;
grant execute on function public.app_is_space_internal(uuid, uuid) to authenticated, service_role;
grant execute on function public.app_can_write_space(uuid, uuid) to authenticated, service_role;
grant execute on function public.app_can_write_wiki_page(uuid) to authenticated, service_role;

-- ロールバック（節 1。節 2〜5 のポリシーと節 7 の RPC を戻したあとに流す）:
--   drop function if exists public.app_can_write_wiki_page(uuid);
--   drop function if exists public.app_can_write_space(uuid, uuid);
--   drop function if exists public.app_is_space_internal(uuid, uuid);
--   drop function if exists public.app_space_role_of_caller(uuid);
-- =============================================================================
-- 節 2: 11 表の insert / update / delete は社内の編集者だけ（app_can_write_space）
--   ポリシーの名前は 20260703_002 / 004 と同じ <表>_{insert,update,delete}_member。
--   spaces は space_id 列を持たないので id を渡す。spaces の insert だけは組織の社内メンバー（app_is_org_internal）。
--   tasks の select（app_task_visible_to_caller）は変えない。
-- =============================================================================

-- tasks
drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
  on public.tasks
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
  on public.tasks
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists tasks_delete_member on public.tasks;
create policy tasks_delete_member
  on public.tasks
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- milestones
drop policy if exists milestones_insert_member on public.milestones;
create policy milestones_insert_member
  on public.milestones
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists milestones_update_member on public.milestones;
create policy milestones_update_member
  on public.milestones
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists milestones_delete_member on public.milestones;
create policy milestones_delete_member
  on public.milestones
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- meetings
drop policy if exists meetings_insert_member on public.meetings;
create policy meetings_insert_member
  on public.meetings
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists meetings_update_member on public.meetings;
create policy meetings_update_member
  on public.meetings
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists meetings_delete_member on public.meetings;
create policy meetings_delete_member
  on public.meetings
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- reviews
drop policy if exists reviews_insert_member on public.reviews;
create policy reviews_insert_member
  on public.reviews
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists reviews_update_member on public.reviews;
create policy reviews_update_member
  on public.reviews
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists reviews_delete_member on public.reviews;
create policy reviews_delete_member
  on public.reviews
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- task_owners
drop policy if exists task_owners_insert_member on public.task_owners;
create policy task_owners_insert_member
  on public.task_owners
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_owners_update_member on public.task_owners;
create policy task_owners_update_member
  on public.task_owners
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_owners_delete_member on public.task_owners;
create policy task_owners_delete_member
  on public.task_owners
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- task_events
drop policy if exists task_events_insert_member on public.task_events;
create policy task_events_insert_member
  on public.task_events
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_events_update_member on public.task_events;
create policy task_events_update_member
  on public.task_events
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_events_delete_member on public.task_events;
create policy task_events_delete_member
  on public.task_events
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- task_relations
drop policy if exists task_relations_insert_member on public.task_relations;
create policy task_relations_insert_member
  on public.task_relations
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_relations_update_member on public.task_relations;
create policy task_relations_update_member
  on public.task_relations
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_relations_delete_member on public.task_relations;
create policy task_relations_delete_member
  on public.task_relations
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- wiki_pages
drop policy if exists wiki_pages_insert_member on public.wiki_pages;
create policy wiki_pages_insert_member
  on public.wiki_pages
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists wiki_pages_update_member on public.wiki_pages;
create policy wiki_pages_update_member
  on public.wiki_pages
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists wiki_pages_delete_member on public.wiki_pages;
create policy wiki_pages_delete_member
  on public.wiki_pages
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- discussion_items
drop policy if exists discussion_items_insert_member on public.discussion_items;
create policy discussion_items_insert_member
  on public.discussion_items
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists discussion_items_update_member on public.discussion_items;
create policy discussion_items_update_member
  on public.discussion_items
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists discussion_items_delete_member on public.discussion_items;
create policy discussion_items_delete_member
  on public.discussion_items
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- meeting_participants
drop policy if exists meeting_participants_insert_member on public.meeting_participants;
create policy meeting_participants_insert_member
  on public.meeting_participants
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists meeting_participants_update_member on public.meeting_participants;
create policy meeting_participants_update_member
  on public.meeting_participants
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists meeting_participants_delete_member on public.meeting_participants;
create policy meeting_participants_delete_member
  on public.meeting_participants
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- spaces（id 自体が space）
--   insert だけは組織の社内メンバー（新しい space の行はまだ無く、app_can_write_space の「space がその組織のものか」を
--   満たせないため）。update / delete は app_can_write_space。
drop policy if exists spaces_insert_member on public.spaces;
create policy spaces_insert_member
  on public.spaces
  for insert
  to authenticated
  with check ( public.app_is_org_internal(org_id) );

drop policy if exists spaces_update_member on public.spaces;
create policy spaces_update_member
  on public.spaces
  for update
  to authenticated
  using ( public.app_can_write_space(id, org_id) )
  with check ( public.app_can_write_space(id, org_id) );

drop policy if exists spaces_delete_member on public.spaces;
create policy spaces_delete_member
  on public.spaces
  for delete
  to authenticated
  using ( public.app_can_write_space(id, org_id) );

-- ロールバック（節 2。表ごとに戻せる＝その表の分だけ流してもよい）:
--   -- tasks（insert は 20260703_002、update / delete は 20260703_010 の形）
--   drop policy if exists tasks_insert_member on public.tasks;
--   create policy tasks_insert_member on public.tasks for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists tasks_update_member on public.tasks;
--   create policy tasks_update_member on public.tasks for update to authenticated using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) ) with check ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );
--   drop policy if exists tasks_delete_member on public.tasks;
--   create policy tasks_delete_member on public.tasks for delete to authenticated using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );
--   -- milestones（ここから spaces まで 20260703_004 の形）
--   drop policy if exists milestones_insert_member on public.milestones;
--   create policy milestones_insert_member on public.milestones for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists milestones_update_member on public.milestones;
--   create policy milestones_update_member on public.milestones for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists milestones_delete_member on public.milestones;
--   create policy milestones_delete_member on public.milestones for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- meetings
--   drop policy if exists meetings_insert_member on public.meetings;
--   create policy meetings_insert_member on public.meetings for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists meetings_update_member on public.meetings;
--   create policy meetings_update_member on public.meetings for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists meetings_delete_member on public.meetings;
--   create policy meetings_delete_member on public.meetings for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- reviews
--   drop policy if exists reviews_insert_member on public.reviews;
--   create policy reviews_insert_member on public.reviews for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists reviews_update_member on public.reviews;
--   create policy reviews_update_member on public.reviews for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists reviews_delete_member on public.reviews;
--   create policy reviews_delete_member on public.reviews for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- task_owners
--   drop policy if exists task_owners_insert_member on public.task_owners;
--   create policy task_owners_insert_member on public.task_owners for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_owners_update_member on public.task_owners;
--   create policy task_owners_update_member on public.task_owners for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_owners_delete_member on public.task_owners;
--   create policy task_owners_delete_member on public.task_owners for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- task_events
--   drop policy if exists task_events_insert_member on public.task_events;
--   create policy task_events_insert_member on public.task_events for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_events_update_member on public.task_events;
--   create policy task_events_update_member on public.task_events for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_events_delete_member on public.task_events;
--   create policy task_events_delete_member on public.task_events for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- task_relations
--   drop policy if exists task_relations_insert_member on public.task_relations;
--   create policy task_relations_insert_member on public.task_relations for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_relations_update_member on public.task_relations;
--   create policy task_relations_update_member on public.task_relations for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_relations_delete_member on public.task_relations;
--   create policy task_relations_delete_member on public.task_relations for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- wiki_pages
--   drop policy if exists wiki_pages_insert_member on public.wiki_pages;
--   create policy wiki_pages_insert_member on public.wiki_pages for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists wiki_pages_update_member on public.wiki_pages;
--   create policy wiki_pages_update_member on public.wiki_pages for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists wiki_pages_delete_member on public.wiki_pages;
--   create policy wiki_pages_delete_member on public.wiki_pages for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- discussion_items
--   drop policy if exists discussion_items_insert_member on public.discussion_items;
--   create policy discussion_items_insert_member on public.discussion_items for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists discussion_items_update_member on public.discussion_items;
--   create policy discussion_items_update_member on public.discussion_items for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists discussion_items_delete_member on public.discussion_items;
--   create policy discussion_items_delete_member on public.discussion_items for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- meeting_participants
--   drop policy if exists meeting_participants_insert_member on public.meeting_participants;
--   create policy meeting_participants_insert_member on public.meeting_participants for insert to authenticated with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists meeting_participants_update_member on public.meeting_participants;
--   create policy meeting_participants_update_member on public.meeting_participants for update to authenticated using ( public.app_can_access_space(space_id, org_id) ) with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists meeting_participants_delete_member on public.meeting_participants;
--   create policy meeting_participants_delete_member on public.meeting_participants for delete to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   -- spaces
--   drop policy if exists spaces_insert_member on public.spaces;
--   create policy spaces_insert_member on public.spaces for insert to authenticated with check ( public.app_can_access_space(id, org_id) );
--   drop policy if exists spaces_update_member on public.spaces;
--   create policy spaces_update_member on public.spaces for update to authenticated using ( public.app_can_access_space(id, org_id) ) with check ( public.app_can_access_space(id, org_id) );
--   drop policy if exists spaces_delete_member on public.spaces;
--   create policy spaces_delete_member on public.spaces for delete to authenticated using ( public.app_can_access_space(id, org_id) );
-- =============================================================================
-- 節 3: 読み取り（select）
--   milestones / spaces / tasks は変えない。
-- =============================================================================

-- meetings: 社内は全件。相手先・vendor は自分の space の進行中・終了だけ
drop policy if exists meetings_select_member on public.meetings;
create policy meetings_select_member
  on public.meetings
  for select
  to authenticated
  using (
    public.app_is_space_internal(space_id, org_id)
    or (public.app_can_access_space(space_id, org_id) and status in ('in_progress', 'ended'))
  );

-- meeting_participants / discussion_items / task_relations / task_owners / task_events: 社内だけ
drop policy if exists meeting_participants_select_member on public.meeting_participants;
create policy meeting_participants_select_member
  on public.meeting_participants
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists discussion_items_select_member on public.discussion_items;
create policy discussion_items_select_member
  on public.discussion_items
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists task_relations_select_member on public.task_relations;
create policy task_relations_select_member
  on public.task_relations
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists task_owners_select_member on public.task_owners;
create policy task_owners_select_member
  on public.task_owners
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists task_events_select_member on public.task_events;
create policy task_events_select_member
  on public.task_events
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

-- reviews: 社内は全件。相手先・vendor は見えるタスク（tasks の RLS を通る）の分だけ
drop policy if exists reviews_select_member on public.reviews;
create policy reviews_select_member
  on public.reviews
  for select
  to authenticated
  using (
    public.app_is_space_internal(space_id, org_id)
    or exists (select 1 from public.tasks t where t.id = reviews.task_id)
  );

-- wiki_pages: 社内は全件。相手先・vendor は自分の space のページで、公開済みのマイルストーンに公開した分だけ
--   （wiki_page_publications / milestone_publications も RLS を通って読む）
drop policy if exists wiki_pages_select_member on public.wiki_pages;
create policy wiki_pages_select_member
  on public.wiki_pages
  for select
  to authenticated
  using (
    public.app_is_space_internal(space_id, org_id)
    or (
      public.app_can_access_space(space_id, org_id)
      and exists (
        select 1
        from public.wiki_page_publications p
        join public.milestone_publications mp on mp.milestone_id = p.milestone_id
        where p.source_page_id = wiki_pages.id
          and mp.is_published
      )
    )
  );

-- ロールバック（節 3。表ごとに戻せる。どれも 20260703_004 の形）:
--   drop policy if exists meetings_select_member on public.meetings;
--   create policy meetings_select_member on public.meetings for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists meeting_participants_select_member on public.meeting_participants;
--   create policy meeting_participants_select_member on public.meeting_participants for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists discussion_items_select_member on public.discussion_items;
--   create policy discussion_items_select_member on public.discussion_items for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_relations_select_member on public.task_relations;
--   create policy task_relations_select_member on public.task_relations for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_owners_select_member on public.task_owners;
--   create policy task_owners_select_member on public.task_owners for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists task_events_select_member on public.task_events;
--   create policy task_events_select_member on public.task_events for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists reviews_select_member on public.reviews;
--   create policy reviews_select_member on public.reviews for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists wiki_pages_select_member on public.wiki_pages;
--   create policy wiki_pages_select_member on public.wiki_pages for select to authenticated using ( public.app_can_access_space(space_id, org_id) );
-- =============================================================================
-- 節 4: task_comments（20240208_000_task_comments.sql の4本を置き換える）
--   読む・書く: 社内（閲覧者を含む）はどの visibility でも。相手先は 'client'・vendor は 'vendor' だけ。
--     相手先・vendor は見えるタスク（tasks の RLS を通る）のコメントだけ。書くのは自分の名前で、見えるタスクにだけ。
--   直す: 自分のコメントだけ（直したあとも書く条件を満たすこと）。消す: 自分のコメントだけ。
-- =============================================================================

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select
  on public.task_comments
  for select
  to authenticated
  using (
    public.app_is_space_internal(space_id, org_id)
    or (
      exists (select 1 from public.tasks t where t.id = task_comments.task_id)
      and (
        (public.app_space_role_of_caller(space_id) = 'client' and visibility = 'client')
        or (public.app_space_role_of_caller(space_id) = 'vendor' and visibility = 'vendor')
      )
    )
  );

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert
  on public.task_comments
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
    and (
      public.app_is_space_internal(space_id, org_id)
      or (public.app_space_role_of_caller(space_id) = 'client' and visibility = 'client')
      or (public.app_space_role_of_caller(space_id) = 'vendor' and visibility = 'vendor')
    )
  );

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update
  on public.task_comments
  for update
  to authenticated
  using ( actor_id = auth.uid() )
  with check (
    actor_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
    and (
      public.app_is_space_internal(space_id, org_id)
      or (public.app_space_role_of_caller(space_id) = 'client' and visibility = 'client')
      or (public.app_space_role_of_caller(space_id) = 'vendor' and visibility = 'vendor')
    )
  );

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete
  on public.task_comments
  for delete
  to authenticated
  using ( actor_id = auth.uid() );

-- ロールバック（節 4。20240208_000_task_comments.sql の形＝対象ロールの指定なし）:
--   drop policy if exists task_comments_select on public.task_comments;
--   create policy task_comments_select on public.task_comments for select using ( exists ( select 1 from space_memberships sm where sm.space_id = task_comments.space_id and sm.user_id = auth.uid() ) );
--   drop policy if exists task_comments_insert on public.task_comments;
--   create policy task_comments_insert on public.task_comments for insert with check ( exists ( select 1 from space_memberships sm where sm.space_id = task_comments.space_id and sm.user_id = auth.uid() ) and actor_id = auth.uid() );
--   drop policy if exists task_comments_update on public.task_comments;
--   create policy task_comments_update on public.task_comments for update using ( actor_id = auth.uid() );
--   drop policy if exists task_comments_delete on public.task_comments;
--   create policy task_comments_delete on public.task_comments for delete using ( actor_id = auth.uid() );
-- =============================================================================
-- 節 5: 親参照の表（20260703_007 の org 単位の表）
--   書き込みのポリシーが無い表（review_approvals / meeting_transcripts / meeting_drafts / task_publications /
--   milestone_publications）は、authenticated は書けないまま（書き込みは SECURITY DEFINER の RPC と service role）。
-- =============================================================================

-- review_approvals: 社内は全件。相手先・vendor は見えるレビュー（reviews の RLS を通る）の分だけ
drop policy if exists review_approvals_select_member on public.review_approvals;
create policy review_approvals_select_member
  on public.review_approvals
  for select
  to authenticated
  using (
    public.app_is_org_internal(org_id)
    or exists (select 1 from public.reviews r where r.id = review_approvals.review_id)
  );

-- meeting_transcripts / meeting_drafts / task_publications: 社内だけ
drop policy if exists meeting_transcripts_select_member on public.meeting_transcripts;
create policy meeting_transcripts_select_member
  on public.meeting_transcripts
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists meeting_drafts_select_member on public.meeting_drafts;
create policy meeting_drafts_select_member
  on public.meeting_drafts
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists task_publications_select_member on public.task_publications;
create policy task_publications_select_member
  on public.task_publications
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- milestone_publications: 社内は全件。相手先・vendor は自分の space のマイルストーン（milestones の RLS を通る）の、公開済みの分だけ
drop policy if exists milestone_publications_select_member on public.milestone_publications;
create policy milestone_publications_select_member
  on public.milestone_publications
  for select
  to authenticated
  using (
    public.app_is_org_internal(org_id)
    or (
      public.app_is_org_member(org_id)
      and is_published
      and exists (select 1 from public.milestones m where m.id = milestone_publications.milestone_id)
    )
  );

-- wiki_page_versions: 読むのは社内だけ。書くのは元のページの space で書ける人だけ（app_can_write_wiki_page）
drop policy if exists wiki_page_versions_select_member on public.wiki_page_versions;
create policy wiki_page_versions_select_member
  on public.wiki_page_versions
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists wiki_page_versions_insert_member on public.wiki_page_versions;
create policy wiki_page_versions_insert_member
  on public.wiki_page_versions
  for insert
  to authenticated
  with check ( public.app_can_write_wiki_page(page_id) );

drop policy if exists wiki_page_versions_update_member on public.wiki_page_versions;
create policy wiki_page_versions_update_member
  on public.wiki_page_versions
  for update
  to authenticated
  using ( public.app_can_write_wiki_page(page_id) )
  with check ( public.app_can_write_wiki_page(page_id) );

drop policy if exists wiki_page_versions_delete_member on public.wiki_page_versions;
create policy wiki_page_versions_delete_member
  on public.wiki_page_versions
  for delete
  to authenticated
  using ( public.app_can_write_wiki_page(page_id) );

-- wiki_page_publications: 読む = 社内は全件。相手先・vendor は、公開済みのマイルストーン
--   （上の milestone_publications を RLS を通って読む＝自分の space の分）の分だけ。
--   書く = 元のページの space で書ける人だけ（app_can_write_wiki_page）
drop policy if exists wiki_page_publications_select_member on public.wiki_page_publications;
create policy wiki_page_publications_select_member
  on public.wiki_page_publications
  for select
  to authenticated
  using (
    public.app_is_org_internal(org_id)
    or (
      public.app_is_org_member(org_id)
      and exists (
        select 1
        from public.milestone_publications mp
        where mp.milestone_id = wiki_page_publications.milestone_id
          and mp.is_published
      )
    )
  );

drop policy if exists wiki_page_publications_insert_member on public.wiki_page_publications;
create policy wiki_page_publications_insert_member
  on public.wiki_page_publications
  for insert
  to authenticated
  with check ( public.app_can_write_wiki_page(source_page_id) );

drop policy if exists wiki_page_publications_update_member on public.wiki_page_publications;
create policy wiki_page_publications_update_member
  on public.wiki_page_publications
  for update
  to authenticated
  using ( public.app_can_write_wiki_page(source_page_id) )
  with check ( public.app_can_write_wiki_page(source_page_id) );

drop policy if exists wiki_page_publications_delete_member on public.wiki_page_publications;
create policy wiki_page_publications_delete_member
  on public.wiki_page_publications
  for delete
  to authenticated
  using ( public.app_can_write_wiki_page(source_page_id) );

-- 相手先の wiki_pages の読み（公開された分か）で、ページごとに wiki_page_publications を引く索引
create index if not exists wiki_page_publications_source_page_id_idx
  on public.wiki_page_publications (source_page_id);

-- ロールバック（節 5。表ごとに戻せる。どれも 20260703_007 の形）:
--   drop index if exists public.wiki_page_publications_source_page_id_idx;
--   drop policy if exists review_approvals_select_member on public.review_approvals;
--   create policy review_approvals_select_member on public.review_approvals for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists meeting_transcripts_select_member on public.meeting_transcripts;
--   create policy meeting_transcripts_select_member on public.meeting_transcripts for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists meeting_drafts_select_member on public.meeting_drafts;
--   create policy meeting_drafts_select_member on public.meeting_drafts for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists task_publications_select_member on public.task_publications;
--   create policy task_publications_select_member on public.task_publications for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists milestone_publications_select_member on public.milestone_publications;
--   create policy milestone_publications_select_member on public.milestone_publications for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_versions_select_member on public.wiki_page_versions;
--   create policy wiki_page_versions_select_member on public.wiki_page_versions for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_versions_insert_member on public.wiki_page_versions;
--   create policy wiki_page_versions_insert_member on public.wiki_page_versions for insert to authenticated with check ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_versions_update_member on public.wiki_page_versions;
--   create policy wiki_page_versions_update_member on public.wiki_page_versions for update to authenticated using ( public.app_is_org_member(org_id) ) with check ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_versions_delete_member on public.wiki_page_versions;
--   create policy wiki_page_versions_delete_member on public.wiki_page_versions for delete to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_publications_select_member on public.wiki_page_publications;
--   create policy wiki_page_publications_select_member on public.wiki_page_publications for select to authenticated using ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_publications_insert_member on public.wiki_page_publications;
--   create policy wiki_page_publications_insert_member on public.wiki_page_publications for insert to authenticated with check ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_publications_update_member on public.wiki_page_publications;
--   create policy wiki_page_publications_update_member on public.wiki_page_publications for update to authenticated using ( public.app_is_org_member(org_id) ) with check ( public.app_is_org_member(org_id) );
--   drop policy if exists wiki_page_publications_delete_member on public.wiki_page_publications;
--   create policy wiki_page_publications_delete_member on public.wiki_page_publications for delete to authenticated using ( public.app_is_org_member(org_id) );
-- =============================================================================
-- 節 6: meetings.notes（社内向けの事前メモ）は authenticated から列ごと読めない・書けない
--   表の select / insert / update が残っていると列ごとの権限は意味を持たないので、表の分を外してから
--   notes 以外の全列を authenticated に許可する（delete は表のまま）。service_role は変えない。
--   列ごとの権限の注意（将来 meetings に列を足すとき）: 後から足した列は authenticated に自動では付かない。
--     見せてよい・書いてよい列を足したら、明示的に grant select / insert / update する。
--   冪等: 表の権限を外すと列ごとの権限も一緒に外れるので、何度流しても同じ状態になる。
-- =============================================================================

revoke select, insert, update on table public.meetings from authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.meetings'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'notes';

  execute format(
    'grant select (%1$s), insert (%1$s), update (%1$s) on table public.meetings to authenticated',
    v_cols
  );
end $$;

-- 確認: notes が anon / authenticated にまだ読める・書ける、または notes 以外の列が authenticated に
--   読めない・書けない状態なら、適用を止める（表の権限が別の付与者から残っている等）
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s:%s.%s', r.rol, a.attname, p.priv), ', ' order by r.rol, a.attnum, p.priv)
    into v_bad
    from pg_attribute a
   cross join (values ('select'), ('insert'), ('update')) as p(priv)
   cross join (values ('anon'), ('authenticated')) as r(rol)
   where a.attrelid = 'public.meetings'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and (
       (a.attname = 'notes' and has_column_privilege(r.rol, 'public.meetings', a.attname, p.priv))
       or (a.attname <> 'notes' and r.rol = 'authenticated'
           and not has_column_privilege(r.rol, 'public.meetings', a.attname, p.priv))
     );

  if v_bad is not null then
    raise exception 'space role boundary: meetings の列ごとの権限が想定と違います: %', v_bad;
  end if;
end $$;

-- ロールバック（節 6。表の権限を外すと列ごとの権限も外れるので、外してから表の権限を付け直す。適用前に控えた権限と違えばそれに合わせる）:
--   revoke select, insert, update on table public.meetings from authenticated;
--   grant select, insert, update on table public.meetings to authenticated;
-- =============================================================================
-- 節 7: 変更系の RPC 15 本は社内の編集者だけ（app_can_write_space）・_create_task_notification の search_path を固定する
--   各 RPC は、migrations にある今の最新の定義をそのまま写し、呼んだ人を確かめる所だけを変えた:
--     rpc_pass_ball                           … 20260706003903_ball_client_scope_invariant.sql
--     rpc_review_approve / rpc_review_block   … 20260706013654_review_integrity.sql
--     rpc_review_cancel                       … 20260706171339_review_cancel_notification.sql
--     rpc_meeting_start / rpc_set_spec_state  … 20260703_009_rpc_authz_hardening.sql
--       ↑ 6 本: 確認の app_can_access_space を app_can_write_space に置き換えた（すぐ上のコメントの言い方も合わせた）
--     rpc_meeting_end / rpc_generate_meeting_minutes     … 20240204_000_meeting_notifications.sql
--     rpc_parse_meeting_minutes / rpc_get_minutes_preview … 20240206_000_minutes_parser.sql
--     rpc_invoke_meeting_minutes_email        … 20240205_000_meeting_end_trigger.sql
--     rpc_confirm_proposal_slot               … 20260217_000_scheduling_security_fixes.sql
--     rpc_decide_considering                  … 20240102_000_rpc_functions.sql（search_path = public も付けた）
--     rpc_review_open                         … 20260705133733_rpc_review_open_internal_reviewers.sql（search_path = public も付けた）
--     rpc_apply_preset_to_space               … 20260705222754_fix_preset_rpc_milestones_columns.sql
--       ↑ 9 本: 今ある確認（参加者か・space のメンバーか・作成者か・space の admin / editor か 等）はそのまま残し、
--         そのあとに「書き込める役割（社内の admin / editor）だけが通る」確認を足した
--         （rpc_generate_meeting_minutes は、service role からの呼び出し＝呼んだ人が無い場合をこれまでどおり通す）。
--   誰が呼べるか（権限）は create or replace では変わらない。
-- =============================================================================

-- 確認: 15 本の今の定義が、上の土台の定義（または本 migration の定義）と1文字でも違えば止める
--   （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('rpc_apply_preset_to_space(uuid,text,jsonb,jsonb,boolean)', '5f2a446b8d1b1d8479054ad9a6f93cca', '0c0aeb4922289afcecb005b75bee828a'),
      ('rpc_confirm_proposal_slot(uuid,uuid)',                     'e3f0fa9d0547a13672b8de2420af0320', 'fe23a2ba7b510dde48f9d64b325af4c2'),
      ('rpc_decide_considering(uuid,text,text,text,uuid,uuid)',    '04657259a80ddbe63a4f05c08bb721df', '8f0671279da236cf92eb2c69cf863176'),
      ('rpc_generate_meeting_minutes(uuid)',                       'd811b0a74e646a55974945864a627a4f', 'e48c3ab15bd15a8e2f1a5aaac8f56383'),
      ('rpc_get_minutes_preview(uuid,text)',                       '0ca2d33d3ec1d6077156438ec1119861', '222100e8f1ee6290b526ee4eecf57806'),
      ('rpc_invoke_meeting_minutes_email(uuid)',                   '7145f670d310eaf2aa441770374c3e29', 'bb6ef8ef02a79dea011577fb8046baf5'),
      ('rpc_meeting_end(uuid)',                                    'afb2cbc07c960c3ede96dd92087aa117', 'e21e06bd815e35995bc47180aac20789'),
      ('rpc_meeting_start(uuid)',                                  '2b4395c4a201915ce3bc47e32cc720be', 'fe8ea5ed53f1bdcf7685e1277d9a59f2'),
      ('rpc_parse_meeting_minutes(uuid,text)',                     '52b8c253309446df9e8afd368bb9b217', 'c7b8984e45c2a004b61fed657f251439'),
      ('rpc_pass_ball(uuid,text,uuid[],uuid[],text,uuid)',         '83e538016c2fe00f72973e20e3934b82', '977bcc108b1d6f581ca9a16b4dff00ea'),
      ('rpc_review_approve(uuid,uuid)',                            '8bab4f9e78147ccd6270a99056b45dd1', 'e9518cd1eaa8a8a6d15ae73612a32352'),
      ('rpc_review_block(uuid,text,uuid)',                         'ca8b3f5040ea0d2316a6217c35909b6d', '3465dc3fdaafd35270079e7334deb886'),
      ('rpc_review_cancel(uuid)',                                  '41931addcf5e924e9500cebbab1c2b96', '93251f39196268918a8c80da2395003a'),
      ('rpc_review_open(uuid,uuid[],uuid)',                        '2a7980727ca1b583b9b8d8890a1c22d6', 'ecda4542ba423efc1adb5e48afd70370'),
      ('rpc_set_spec_state(uuid,text,uuid,text)',                  '33d87034254257b151f30167579ef6b7', '881f22f93949b024f21aedfa7aaeddf3')
    ) as e(fn, base_md5, new_md5)
    left join pg_proc p on p.oid = to_regprocedure('public.' || e.fn)
   where p.oid is null
      or md5(p.prosrc) not in (e.base_md5, e.new_md5);

  if v_bad is not null then
    raise exception 'space role boundary: 次の関数の今の定義が、土台にした migration の定義と違います: %', v_bad;
  end if;
end $$;

-- rpc_pass_ball（土台: 20260706003903_ball_client_scope_invariant.sql）
CREATE OR REPLACE FUNCTION rpc_pass_ball(
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[] DEFAULT '{}',
  p_internal_owner_ids uuid[] DEFAULT '{}',
  p_reason text DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_org_id uuid;
  v_space_id uuid;
  v_actor_name text;
  v_recipient_ids uuid[];
  v_recipient uuid;
BEGIN
  -- Get current user
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task info
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  v_org_id := v_task.org_id;
  v_space_id := v_task.space_id;

  -- Validate: ball='client' requires at least one client owner
  IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Client owner required when ball=client';
  END IF;

  -- 不変条件: ball='client' へ渡す＝クライアントに見せる意思とみなし、
  -- client_scope が 'deliverable' でなければ同一UPDATEで揃える（エラーにしない）。
  UPDATE tasks
  SET
    ball = p_ball,
    client_scope = CASE
      WHEN p_ball = 'client' AND client_scope IS DISTINCT FROM 'deliverable'
        THEN 'deliverable'
      ELSE client_scope
    END,
    updated_at = now()
  WHERE id = p_task_id;

  -- Delete existing owners and insert new ones
  DELETE FROM task_owners WHERE task_id = p_task_id;

  -- Insert client owners
  IF array_length(p_client_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids);
  END IF;

  -- Insert internal owners
  IF array_length(p_internal_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids);
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_org_id,
    v_space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'PASS_BALL',
    jsonb_build_object(
      'ball', p_ball,
      'clientOwnerIds', p_client_owner_ids,
      'internalOwnerIds', p_internal_owner_ids,
      'reason', p_reason
    )
  );

  -- Notify the owners on the receiving side (the side that must now act).
  -- This is what closes the "confirm / act next" loop for internal↔internal too.
  v_recipient_ids := CASE WHEN p_ball = 'client' THEN p_client_owner_ids ELSE p_internal_owner_ids END;
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF array_length(v_recipient_ids, 1) > 0 THEN
    FOREACH v_recipient IN ARRAY v_recipient_ids LOOP
      IF v_recipient <> v_actor_id THEN
        PERFORM _create_task_notification(
          v_org_id,
          v_space_id,
          v_recipient,
          'ball_passed',
          format('ball_passed:%s:%s', p_task_id, v_recipient),
          jsonb_build_object(
            'task_id', p_task_id,
            'task_title', v_task.title,
            'title', format('「%s」があなたの番です', v_task.title),
            'message', COALESCE(p_reason, 'ボールがあなたに渡されました。対応を開始してください。'),
            'from_user_name', v_actor_name,
            'ball', p_ball
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_review_approve（土台: 20260706013654_review_integrity.sql）
CREATE OR REPLACE FUNCTION rpc_review_approve(
  p_task_id uuid,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_all_approved boolean;
  v_updated_rows int;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ space/org for the authorization anchor) and LOCK the row.
  -- Bug 1: without this lock, two reviewers approving the last two pending
  -- approvals concurrently can both observe v_all_approved=false under READ
  -- COMMITTED (each transaction reads review_approvals before the other's
  -- commit), leaving reviews.status stuck at 'open' even though every
  -- approval is 'approved'. FOR UPDATE serializes the two transactions so
  -- the second one re-reads a consistent state.
  SELECT id, space_id, org_id
  INTO v_review_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_write_space(v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval. `AND state <> 'approved'` makes a
  -- re-run against an already-approved reviewer a no-op (Bug 4: idempotency).
  UPDATE review_approvals
  SET state = 'approved', updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id AND state <> 'approved';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    -- Either the caller is not a reviewer on this review, or they already
    -- approved. Disambiguate to preserve the original error for the former.
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- Already approved: return current state without re-logging to
    -- task_events (Bug 4).
    SELECT NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND state != 'approved'
    ) INTO v_all_approved;

    RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved, 'alreadyApproved', true);
  END IF;

  -- Check if all reviewers approved (safe under the FOR UPDATE lock above).
  SELECT NOT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state != 'approved'
  ) INTO v_all_approved;

  -- Update review status if all approved
  IF v_all_approved THEN
    UPDATE reviews SET status = 'approved', updated_at = now() WHERE id = v_review_id;
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_APPROVE',
    jsonb_build_object('allApproved', v_all_approved)
  );

  RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved);
END;
$$;

-- rpc_review_block（土台: 20260706013654_review_integrity.sql）
CREATE OR REPLACE FUNCTION rpc_review_block(
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_requester_id uuid;
  v_actor_name text;
  v_updated_rows int;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ requester for the ball hand-back notification, + space/org
  -- anchor) and LOCK the row — same rationale as rpc_review_approve: without
  -- it, a block racing against the last concurrent approvals could observe
  -- a stale approval count.
  SELECT id, created_by, space_id, org_id
  INTO v_review_id, v_requester_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_write_space(v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval to blocked. Only counts as a real change
  -- (and triggers ball hand-back / notification / task_events below) if the
  -- state or the reason actually changed — a double-submit of the same
  -- reason is a no-op (Bug 4: symmetry with rpc_review_approve).
  UPDATE review_approvals
  SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
  WHERE review_id = v_review_id
    AND reviewer_id = v_actor_id
    AND (state <> 'blocked' OR blocked_reason IS DISTINCT FROM p_blocked_reason);

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- No actual change (identical repeat submission): idempotent no-op.
    RETURN jsonb_build_object('ok', true, 'alreadyBlocked', true);
  END IF;

  -- Update review status to changes_requested
  UPDATE reviews SET status = 'changes_requested', updated_at = now() WHERE id = v_review_id;

  -- Hand the ball back to the internal side (the developer must act on the
  -- requested changes). This makes the change-request an actionable state.
  UPDATE tasks SET ball = 'internal', updated_at = now() WHERE id = p_task_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_BLOCK',
    jsonb_build_object('blockedReason', p_blocked_reason)
  );

  -- Notify the developer who requested the review (exclude self-block).
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF v_requester_id IS NOT NULL AND v_requester_id <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_task.org_id,
      v_task.space_id,
      v_requester_id,
      'ball_passed',
      format('review_block:%s:%s', v_review_id, v_requester_id),
      jsonb_build_object(
        'task_id', p_task_id,
        'task_title', v_task.title,
        'title', format('差し戻し: 「%s」', v_task.title),
        'message', format('修正依頼: %s', p_blocked_reason),
        'from_user_name', v_actor_name,
        'ball', 'internal'
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_review_cancel（土台: 20260706171339_review_cancel_notification.sql）
CREATE OR REPLACE FUNCTION rpc_review_cancel(
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_review reviews%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_is_space_admin boolean;
  v_is_org_owner boolean;
  v_actor_name text;
  v_pending_reviewer uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_review FROM reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found: %', p_review_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する（他RPCと同じ多層防御の前段）。
  IF NOT public.app_can_write_space(v_review.space_id, v_review.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  IF v_review.status NOT IN ('open', 'changes_requested') THEN
    RAISE EXCEPTION 'Review cannot be cancelled from status: %', v_review.status;
  END IF;

  -- 認可: レビュー依頼者本人、または対象タスクの space admin、または org owner。
  v_is_space_admin := EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_review.space_id AND user_id = v_actor_id AND role = 'admin'
  );
  v_is_org_owner := EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = v_review.org_id AND user_id = v_actor_id AND role = 'owner'
  );

  IF v_review.created_by <> v_actor_id AND NOT v_is_space_admin AND NOT v_is_org_owner THEN
    RAISE EXCEPTION 'Insufficient permissions: only the requester, a space admin, or an org owner can cancel this review';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = v_review.task_id;

  UPDATE reviews SET status = 'cancelled', updated_at = now() WHERE id = p_review_id;

  INSERT INTO task_events (org_id, space_id, task_id, actor_id, action, payload)
  VALUES (
    v_review.org_id,
    v_review.space_id,
    v_review.task_id,
    v_actor_id,
    'REVIEW_CANCEL',
    jsonb_build_object('reviewId', p_review_id)
  );

  -- 通知: 宙に浮いていた pending レビュアー + 依頼者へ「対応不要」を知らせる
  -- 非アクション型通知（review_cancelled）。実行者本人は除外する。
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  FOR v_pending_reviewer IN
    SELECT reviewer_id FROM review_approvals
    WHERE review_id = p_review_id AND state = 'pending'
  LOOP
    IF v_pending_reviewer <> v_actor_id THEN
      PERFORM _create_task_notification(
        v_review.org_id,
        v_review.space_id,
        v_pending_reviewer,
        'review_cancelled',
        format('review_cancelled:%s:%s', p_review_id, v_pending_reviewer),
        jsonb_build_object(
          'task_id', v_review.task_id,
          'task_title', v_task.title,
          'title', format('レビュー取消: 「%s」', v_task.title),
          'message', 'このレビュー依頼は取り消されました。対応は不要です。',
          'from_user_name', v_actor_name,
          'link', format('/%s/project/%s?task=%s', v_review.org_id, v_review.space_id, v_review.task_id)
        )
      );
    END IF;
  END LOOP;

  IF v_review.created_by IS NOT NULL AND v_review.created_by <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_review.org_id,
      v_review.space_id,
      v_review.created_by,
      'review_cancelled',
      format('review_cancelled:%s:%s', p_review_id, v_review.created_by),
      jsonb_build_object(
        'task_id', v_review.task_id,
        'task_title', v_task.title,
        'title', format('レビュー取消: 「%s」', v_task.title),
        'message', 'このレビュー依頼は取り消されました。対応は不要です。',
        'from_user_name', v_actor_name,
        'link', format('/%s/project/%s?task=%s', v_review.org_id, v_review.space_id, v_review.task_id)
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_meeting_start（土台: 20260703_009_rpc_authz_hardening.sql）
CREATE OR REPLACE FUNCTION rpc_meeting_start(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 meeting の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this meeting';
  END IF;

  -- Validate status
  IF v_meeting.status != 'planned' THEN
    RAISE EXCEPTION 'Meeting can only start from planned status, current: %', v_meeting.status;
  END IF;

  -- Update meeting
  UPDATE meetings
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_meeting_id;

  -- Create audit log (uses a dummy task event for meeting-level events)
  -- Note: In production, consider a separate meeting_events table
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  SELECT
    v_meeting.org_id,
    v_meeting.space_id,
    (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1), -- dummy task
    v_actor_id,
    p_meeting_id,
    'MEETING_START',
    jsonb_build_object('meetingTitle', v_meeting.title)
  WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_set_spec_state（土台: 20260703_009_rpc_authz_hardening.sql）
CREATE OR REPLACE FUNCTION rpc_set_spec_state(
  p_task_id uuid,
  p_decision_state text,
  p_meeting_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_action text;
  v_wiki_body text;
  v_wiki_title text;
  v_task_title text;
  v_append_text text;
  v_new_body text;
  v_blocks jsonb;
  v_new_block jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  -- Validate: only spec tasks allowed
  IF v_task.type != 'spec' THEN
    RAISE EXCEPTION 'Only spec tasks can have decision_state changed';
  END IF;

  -- Validate: wiki_page_id or spec_path must be set for decided/implemented
  IF p_decision_state IN ('decided', 'implemented')
     AND v_task.wiki_page_id IS NULL
     AND v_task.spec_path IS NULL THEN
    RAISE EXCEPTION 'wiki_page_id or spec_path required for decided/implemented state';
  END IF;

  -- Determine action type
  IF p_decision_state = 'decided' THEN
    v_action := 'SPEC_DECIDE';
  ELSIF p_decision_state = 'implemented' THEN
    v_action := 'SPEC_IMPLEMENT';
  ELSE
    v_action := 'SPEC_STATE_CHANGE';
  END IF;

  -- Update task
  UPDATE tasks
  SET decision_state = p_decision_state, updated_at = now()
  WHERE id = p_task_id;

  -- Auto-append to wiki page if wiki_page_id is set
  IF v_task.wiki_page_id IS NOT NULL AND p_decision_state IN ('decided', 'implemented') THEN
    -- Ownership validation: wiki page must belong to the same org and space
    SELECT body, title INTO v_wiki_body, v_wiki_title
    FROM wiki_pages
    WHERE id = v_task.wiki_page_id
      AND org_id = v_task.org_id
      AND space_id = v_task.space_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wiki page not found or does not belong to the same org/space as the task';
    END IF;

    v_task_title := v_task.title;

    -- Build a BlockNote paragraph block for the decision log
    IF p_decision_state = 'decided' THEN
      v_append_text := '✅ 決定: ' || v_task_title || ' (' || to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD') || ')';
    ELSE
      v_append_text := '🚀 実装済み: ' || v_task_title || ' (' || to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD') || ')';
    END IF;

    -- Create a new BlockNote paragraph block
    v_new_block := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'paragraph',
      'props', jsonb_build_object(
        'textColor', 'default',
        'backgroundColor', 'default',
        'textAlignment', 'left'
      ),
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'text',
          'text', v_append_text,
          'styles', '{}'::jsonb
        )
      ),
      'children', '[]'::jsonb
    );

    -- Parse existing body as JSON array and append new block
    BEGIN
      v_blocks := v_wiki_body::jsonb;
      IF jsonb_typeof(v_blocks) = 'array' THEN
        v_new_body := (v_blocks || jsonb_build_array(v_new_block))::text;
      ELSE
        -- Non-array body: wrap existing content as-is, then append new block
        v_new_body := jsonb_build_array(v_blocks, v_new_block)::text;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- If body is not valid JSON, create new array with new block only
      v_new_body := jsonb_build_array(v_new_block)::text;
    END;

    -- Save version before update
    INSERT INTO wiki_page_versions (org_id, page_id, title, body, created_by)
    SELECT org_id, id, title, body, v_actor_id
    FROM wiki_pages
    WHERE id = v_task.wiki_page_id;

    -- Update wiki page body
    UPDATE wiki_pages
    SET body = v_new_body, updated_by = v_actor_id, updated_at = now()
    WHERE id = v_task.wiki_page_id;
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    v_action,
    jsonb_build_object(
      'previousState', v_task.decision_state,
      'newState', p_decision_state,
      'note', p_note,
      'wiki_page_id', v_task.wiki_page_id
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_meeting_end（土台: 20240204_000_meeting_notifications.sql）
CREATE OR REPLACE FUNCTION rpc_meeting_end(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_summary_subject text;
  v_summary_body text;
  v_dedupe_key text;
  v_participant record;
  v_task_list text;
  v_updated boolean;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with lock to prevent race conditions
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Authorization check: user must be a participant or space member
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to end this meeting';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to end this meeting';
  END IF;

  -- Validate status (allow re-ending for idempotency)
  IF v_meeting.status NOT IN ('in_progress', 'ended') THEN
    RAISE EXCEPTION 'Meeting can only end from in_progress status, current: %', v_meeting.status;
  END IF;

  -- Count stats for this meeting's space
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.status = 'considering';

  SELECT COUNT(*) INTO v_ball_client_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';

  -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
  -- Use subquery with LIMIT to correctly limit rows before aggregation
  SELECT string_agg(task_line, E'\n') INTO v_task_list
  FROM (
    SELECT format('- %s%s',
      t.title,
      CASE WHEN t.due_date IS NOT NULL
        THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
        ELSE ''
      END
    ) AS task_line
    FROM tasks t
    WHERE t.space_id = v_meeting.space_id
      AND (t.ball = 'client' OR t.status = 'considering')
    ORDER BY
      CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date
    LIMIT 10
  ) sub;

  -- Generate summary
  v_summary_subject := format('【議事録】%s', v_meeting.title);
  v_summary_body := format(
    E'会議「%s」が終了しました。\n\n' ||
    E'決定事項: %s件\n' ||
    E'未決事項: %s件\n' ||
    E'クライアント確認待ち: %s件\n\n' ||
    E'【要対応タスク】\n%s',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    COALESCE(v_task_list, '(なし)')
  );

  -- Update meeting (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
    UPDATE meetings
    SET
      status = 'ended',
      ended_at = now(),
      summary_subject = v_summary_subject,
      summary_body = v_summary_body,
      updated_at = now()
    WHERE id = p_meeting_id;
  END IF;

  -- AT-003: Generate notifications for all participants (idempotent via dedupe_key)
  -- dedupe_key format: meeting_end:{meeting_id}
  v_dedupe_key := format('meeting_end:%s', p_meeting_id);

  -- Insert in_app notifications for all meeting participants
  FOR v_participant IN
    SELECT mp.user_id
    FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id
  LOOP
    INSERT INTO notifications (
      org_id,
      space_id,
      to_user_id,
      channel,
      type,
      dedupe_key,
      payload
    ) VALUES (
      v_meeting.org_id,
      v_meeting.space_id,
      v_participant.user_id,
      'in_app',
      'meeting_ended',
      v_dedupe_key,
      jsonb_build_object(
        'title', v_summary_subject,
        'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
        'meeting_id', p_meeting_id,
        'meeting_title', v_meeting.title,
        'summary_subject', v_summary_subject,
        'summary_body', v_summary_body,
        'decided_count', v_decided_count,
        'open_count', v_open_count,
        'ball_client_count', v_ball_client_count
      )
    )
    ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;
  END LOOP;

  -- Also notify task owners of client-ball tasks who weren't in the meeting
  INSERT INTO notifications (
    org_id,
    space_id,
    to_user_id,
    channel,
    type,
    dedupe_key,
    payload
  )
  SELECT DISTINCT
    v_meeting.org_id,
    v_meeting.space_id,
    tow.user_id,
    'in_app',
    'meeting_ended',
    v_dedupe_key,
    jsonb_build_object(
      'title', v_summary_subject,
      'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
      'meeting_id', p_meeting_id,
      'meeting_title', v_meeting.title,
      'summary_subject', v_summary_subject,
      'summary_body', v_summary_body,
      'decided_count', v_decided_count,
      'open_count', v_open_count,
      'ball_client_count', v_ball_client_count
    )
  FROM task_owners tow
  JOIN tasks t ON t.id = tow.task_id
  WHERE t.space_id = v_meeting.space_id
    AND t.ball = 'client'
    AND NOT EXISTS (
      SELECT 1 FROM meeting_participants mp
      WHERE mp.meeting_id = p_meeting_id AND mp.user_id = tow.user_id
    )
  ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

  -- Create audit log (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
    INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
    SELECT
      v_meeting.org_id,
      v_meeting.space_id,
      (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1),
      v_actor_id,
      p_meeting_id,
      'MEETING_END',
      jsonb_build_object(
        'decidedCount', v_decided_count,
        'openCount', v_open_count,
        'ballClientCount', v_ball_client_count
      )
    WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'summary_subject', v_summary_subject,
    'summary_body', v_summary_body,
    'counts', jsonb_build_object(
      'decided', v_decided_count,
      'open', v_open_count,
      'ball_client', v_ball_client_count
    )
  );
END;
$$;

-- rpc_decide_considering（土台: 20240102_000_rpc_functions.sql）
CREATE OR REPLACE FUNCTION rpc_decide_considering(
  p_task_id uuid,
  p_decision_text text,
  p_on_behalf_of text,
  p_evidence text,
  p_client_confirmed_by uuid DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  -- Validate: on_behalf_of='client' AND evidence!='meeting' requires client_confirmed_by
  IF p_on_behalf_of = 'client' AND p_evidence != 'meeting' AND p_client_confirmed_by IS NULL THEN
    RAISE EXCEPTION 'client_confirmed_by required for client decisions outside meetings';
  END IF;

  -- Create audit log (status is NOT changed per spec - state change is separate)
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'CONSIDERING_DECIDE',
    jsonb_build_object(
      'decisionText', p_decision_text,
      'onBehalfOf', p_on_behalf_of,
      'evidence', p_evidence,
      'clientConfirmedBy', p_client_confirmed_by
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_generate_meeting_minutes（土台: 20240204_000_meeting_notifications.sql）
CREATE OR REPLACE FUNCTION rpc_generate_meeting_minutes(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_nearest_due timestamptz;
  v_email_subject text;
  v_email_body text;
  v_in_app_title text;
  v_in_app_body text;
  v_task_list text;
BEGIN
  v_actor_id := auth.uid();

  -- Authorization check FIRST to prevent meeting ID enumeration
  -- Service-role calls (v_actor_id IS NULL) bypass this check
  -- STRICT: Only meeting participants can access (no space membership fallback)
  IF v_actor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM meeting_participants mp
      WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
    ) THEN
      -- Return generic error regardless of whether meeting exists
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Get meeting (only after authorization confirmed for user calls)
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る（service role からの呼び出し＝v_actor_id が NULL はこれまでどおり）
  IF v_actor_id IS NOT NULL AND NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Count decided items (from events linked to this meeting)
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  -- Count open considering items (ball=client prioritized in output)
  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id
    AND t.status = 'considering';

  -- Count ball=client tasks
  SELECT COUNT(*) INTO v_ball_client_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';

  -- Get nearest due date for client tasks
  SELECT MIN(t.due_date) INTO v_nearest_due
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id
    AND t.ball = 'client'
    AND t.due_date IS NOT NULL;

  -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
  -- Use subquery with LIMIT to correctly limit rows before aggregation
  SELECT string_agg(task_line, E'\n') INTO v_task_list
  FROM (
    SELECT format('- %s%s%s',
      CASE WHEN t.ball = 'client' THEN '[要対応] ' ELSE '' END,
      t.title,
      CASE WHEN t.due_date IS NOT NULL
        THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
        ELSE ''
      END
    ) AS task_line
    FROM tasks t
    WHERE t.space_id = v_meeting.space_id
      AND (t.ball = 'client' OR t.status = 'considering')
    ORDER BY
      CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date
    LIMIT 20
  ) sub;

  -- Generate email content
  v_email_subject := format('【議事録】%s (%s)', v_meeting.title, to_char(v_meeting.held_at, 'YYYY/MM/DD'));
  v_email_body := format(
    E'%sの議事録をお送りします。\n\n' ||
    E'■ 決定事項: %s件\n' ||
    E'■ 未決事項: %s件\n' ||
    E'■ クライアント対応タスク: %s件\n' ||
    E'%s\n\n' ||
    E'【タスク一覧】\n%s\n\n' ||
    E'詳細はTaskAppでご確認ください。',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    CASE WHEN v_nearest_due IS NOT NULL
      THEN format('■ 最も近い期限: %s', to_char(v_nearest_due, 'YYYY/MM/DD'))
      ELSE ''
    END,
    COALESCE(v_task_list, '(なし)')
  );

  -- Generate in-app content
  v_in_app_title := format('議事録: %s', v_meeting.title);
  v_in_app_body := format(
    '決定: %s件 / 未決: %s件 / 要対応: %s件',
    v_decided_count,
    v_open_count,
    v_ball_client_count
  );

  RETURN jsonb_build_object(
    'email_subject', v_email_subject,
    'email_body', v_email_body,
    'in_app_title', v_in_app_title,
    'in_app_body', v_in_app_body,
    'counts', jsonb_build_object(
      'decided', v_decided_count,
      'open', v_open_count,
      'ball_client', v_ball_client_count
    ),
    'nearest_due', v_nearest_due
  );
END;
$$;

-- rpc_parse_meeting_minutes（土台: 20240206_000_minutes_parser.sql）
CREATE OR REPLACE FUNCTION rpc_parse_meeting_minutes(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_line text;
  v_line_num int := 0;
  v_spec_match text[];
  v_spec_path text;
  v_title text;
  v_due_date date;
  v_new_task_id uuid;
  v_created_tasks jsonb := '[]'::jsonb;
  v_updated_minutes text := '';
  v_lines text[];
  v_has_marker boolean;
  v_task_marker text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with authorization check
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Authorization: must be a participant or space member
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- Split markdown into lines
  v_lines := string_to_array(p_minutes_md, E'\n');

  -- Process each line
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;

    -- Check if line matches SPEC pattern with UNCHECKED checkbox only: - [ ] SPEC(...)
    -- NOTE: [x] and [X] are NOT matched - only empty [ ] checkboxes
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      -- Check for existing marker (<!--task:XXX-->) - allows trailing whitespace
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';

      IF NOT v_has_marker THEN
        -- Extract spec_path from SPEC(...)
        v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

        -- Strict spec_path validation: /spec/file#anchor (non-empty before and after #)
        IF v_spec_path IS NOT NULL
           AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN

          -- Extract title (everything after colon, before optional parentheses)
          v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
          IF v_title IS NOT NULL THEN
            v_title := trim(v_title);
          ELSE
            v_title := 'Untitled SPEC task';
          END IF;

          -- Extract due date if present (期限: MM/DD or YYYY/MM/DD)
          v_due_date := NULL;
          IF v_line ~ '期限:\s*\d+/\d+' THEN
            DECLARE
              v_date_str text;
              v_parts text[];
              v_year int;
              v_month int;
              v_day int;
            BEGIN
              v_date_str := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
              IF v_date_str IS NOT NULL THEN
                v_parts := string_to_array(v_date_str, '/');
                IF array_length(v_parts, 1) = 2 THEN
                  -- MM/DD format - assume current year
                  v_year := extract(year from CURRENT_DATE);
                  v_month := v_parts[1]::int;
                  v_day := v_parts[2]::int;
                  -- Validate month/day ranges
                  IF v_month >= 1 AND v_month <= 12 AND v_day >= 1 AND v_day <= 31 THEN
                    v_due_date := make_date(v_year, v_month, v_day);
                    -- If date is in past, use next year
                    IF v_due_date < CURRENT_DATE THEN
                      v_due_date := make_date(v_year + 1, v_month, v_day);
                    END IF;
                  END IF;
                ELSIF array_length(v_parts, 1) = 3 THEN
                  -- YYYY/MM/DD format
                  v_year := v_parts[1]::int;
                  v_month := v_parts[2]::int;
                  v_day := v_parts[3]::int;
                  -- Validate ranges
                  IF v_year >= 1900 AND v_year <= 2100
                     AND v_month >= 1 AND v_month <= 12
                     AND v_day >= 1 AND v_day <= 31 THEN
                    v_due_date := make_date(v_year, v_month, v_day);
                  END IF;
                END IF;
              END IF;
            EXCEPTION WHEN OTHERS THEN
              v_due_date := NULL;
            END;
          END IF;

          -- Create the spec task
          INSERT INTO tasks (
            org_id,
            space_id,
            title,
            status,
            ball,
            origin,
            type,
            spec_path,
            decision_state,
            due_date,
            created_by
          ) VALUES (
            v_meeting.org_id,
            v_meeting.space_id,
            v_title,
            'considering',  -- New spec tasks start as considering
            'client',       -- Spec decisions typically need client input
            'internal',     -- Created by internal (from meeting minutes)
            'spec',
            v_spec_path,
            'considering',  -- Initial decision state
            v_due_date,
            v_actor_id
          )
          RETURNING id INTO v_new_task_id;

          -- Create audit event
          INSERT INTO task_events (
            org_id,
            space_id,
            task_id,
            actor_id,
            meeting_id,
            action,
            payload
          ) VALUES (
            v_meeting.org_id,
            v_meeting.space_id,
            v_new_task_id,
            v_actor_id,
            p_meeting_id,
            'SPEC_CREATED',
            jsonb_build_object(
              'source', 'minutes_parser',
              'spec_path', v_spec_path,
              'line_number', v_line_num
            )
          );

          -- Add marker to line (preserve leading whitespace, trim trailing)
          v_task_marker := format(' <!--task:%s-->', v_new_task_id);
          v_line := rtrim(v_line) || v_task_marker;

          -- Track created task
          v_created_tasks := v_created_tasks || jsonb_build_object(
            'task_id', v_new_task_id,
            'title', v_title,
            'spec_path', v_spec_path,
            'due_date', v_due_date,
            'line_number', v_line_num
          );
        END IF;
      END IF;
    END IF;

    -- Append line to updated minutes
    IF v_line_num > 1 THEN
      v_updated_minutes := v_updated_minutes || E'\n';
    END IF;
    v_updated_minutes := v_updated_minutes || v_line;
  END LOOP;

  -- Update meeting with parsed minutes
  UPDATE meetings
  SET
    minutes_md = v_updated_minutes,
    updated_at = now()
  WHERE id = p_meeting_id;

  RETURN jsonb_build_object(
    'ok', true,
    'created_count', jsonb_array_length(v_created_tasks),
    'created_tasks', v_created_tasks,
    'updated_minutes', v_updated_minutes
  );
END;
$$;

-- rpc_get_minutes_preview（土台: 20240206_000_minutes_parser.sql）
CREATE OR REPLACE FUNCTION rpc_get_minutes_preview(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_line text;
  v_line_num int := 0;
  v_spec_path text;
  v_title text;
  v_new_lines jsonb := '[]'::jsonb;
  v_existing_lines jsonb := '[]'::jsonb;
  v_lines text[];
  v_has_marker boolean;
  v_existing_task_id text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with authorization check
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Split markdown into lines
  v_lines := string_to_array(p_minutes_md, E'\n');

  -- Process each line
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;

    -- Check if line matches SPEC pattern with UNCHECKED checkbox only
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      -- Check for existing marker (allows trailing whitespace)
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';
      v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

      -- Apply same strict validation as create function
      IF v_spec_path IS NOT NULL AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN
        v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
        IF v_title IS NOT NULL THEN
          v_title := trim(v_title);
        END IF;

        IF v_has_marker THEN
          -- Extract existing task ID
          v_existing_task_id := substring(v_line from '<!--task:([^>]+)-->');
          v_existing_lines := v_existing_lines || jsonb_build_object(
            'line_number', v_line_num,
            'spec_path', v_spec_path,
            'title', v_title,
            'task_id', v_existing_task_id
          );
        ELSE
          v_new_lines := v_new_lines || jsonb_build_object(
            'line_number', v_line_num,
            'spec_path', v_spec_path,
            'title', v_title
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'new_spec_count', jsonb_array_length(v_new_lines),
    'existing_spec_count', jsonb_array_length(v_existing_lines),
    'new_specs', v_new_lines,
    'existing_specs', v_existing_lines
  );
END;
$$;

-- rpc_invoke_meeting_minutes_email（土台: 20240205_000_meeting_end_trigger.sql）
CREATE OR REPLACE FUNCTION rpc_invoke_meeting_minutes_email(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorization check FIRST to prevent meeting ID enumeration
  -- STRICT: Only meeting participants can trigger (not space members)
  -- Returns generic error regardless of whether meeting exists
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Get meeting (only after authorization confirmed)
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    -- Should not happen if participant exists, but handle gracefully
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Validate meeting is ended
  IF v_meeting.status != 'ended' THEN
    RAISE EXCEPTION 'Meeting has not ended';
  END IF;

  -- Return meeting info for frontend to invoke Edge Function
  RETURN jsonb_build_object(
    'ok', true,
    'meeting_id', p_meeting_id,
    'should_invoke_edge_function', true
  );
END;
$$;

-- rpc_confirm_proposal_slot（土台: 20260217_000_scheduling_security_fixes.sql）
CREATE OR REPLACE FUNCTION rpc_confirm_proposal_slot(
  p_proposal_id uuid,
  p_slot_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_proposal scheduling_proposals%ROWTYPE;
  v_slot proposal_slots%ROWTYPE;
  v_meeting_id uuid;
  v_required_count integer;
  v_eligible_count integer;
  v_is_authorized boolean := false;
BEGIN
  -- Auth check
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  -- 1. Row lock
  SELECT * INTO v_proposal
  FROM scheduling_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF v_proposal IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;

  -- 2. Authorization: creator or space admin
  IF v_proposal.created_by = v_actor_id THEN
    v_is_authorized := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM space_memberships
      WHERE space_id = v_proposal.space_id
        AND user_id = v_actor_id
        AND role = 'admin'
    ) INTO v_is_authorized;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_proposal.space_id, v_proposal.org_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- 3. Status guard
  IF v_proposal.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_open', 'current_status', v_proposal.status);
  END IF;

  -- 4. Slot belongs to this proposal
  SELECT * INTO v_slot
  FROM proposal_slots
  WHERE id = p_slot_id AND proposal_id = p_proposal_id;

  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  -- 5. Required respondent count (must be > 0)
  SELECT count(*) INTO v_required_count
  FROM proposal_respondents
  WHERE proposal_id = p_proposal_id AND is_required = true;

  IF v_required_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_required_respondents');
  END IF;

  -- 6. Eligible count: explicitly constrain both slot AND proposal
  SELECT count(*) INTO v_eligible_count
  FROM slot_responses sr
  JOIN proposal_respondents pr ON sr.respondent_id = pr.id
  WHERE sr.slot_id = p_slot_id
    AND pr.proposal_id = p_proposal_id
    AND pr.is_required = true
    AND sr.response IN ('available', 'unavailable_but_proceed');

  IF v_eligible_count < v_required_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_all_agreed',
      'required', v_required_count,
      'eligible', v_eligible_count
    );
  END IF;

  -- 7. Create meeting
  INSERT INTO meetings (org_id, space_id, title, held_at, status, created_by)
  VALUES (
    v_proposal.org_id,
    v_proposal.space_id,
    v_proposal.title,
    v_slot.start_at,
    'planned',
    v_actor_id
  )
  RETURNING id INTO v_meeting_id;

  -- 8. Copy participants
  INSERT INTO meeting_participants (org_id, space_id, meeting_id, user_id, side, created_by)
  SELECT
    v_proposal.org_id,
    v_proposal.space_id,
    v_meeting_id,
    pr.user_id,
    pr.side,
    v_actor_id
  FROM proposal_respondents pr
  WHERE pr.proposal_id = p_proposal_id;

  -- 9. Update proposal
  UPDATE scheduling_proposals
  SET status = 'confirmed',
      confirmed_slot_id = p_slot_id,
      confirmed_meeting_id = v_meeting_id,
      confirmed_at = now(),
      confirmed_by = v_actor_id,
      version = version + 1
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'ok', true,
    'meeting_id', v_meeting_id,
    'slot_start', v_slot.start_at,
    'slot_end', v_slot.end_at
  );
END;
$$;

-- rpc_review_open（土台: 20260705133733_rpc_review_open_internal_reviewers.sql）
CREATE OR REPLACE FUNCTION rpc_review_open(
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_existing_reviewer_ids uuid[];
  v_has_pending boolean;
  v_final_status text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Sanitize reviewer IDs: remove NULLs and deduplicate
  p_reviewer_ids := ARRAY(
    SELECT DISTINCT rid FROM unnest(p_reviewer_ids) AS rid WHERE rid IS NOT NULL
  );

  -- Validate reviewers
  IF array_length(p_reviewer_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one reviewer required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Security: Verify caller is a member of the task's space (admin or editor)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_task.space_id
      AND user_id = v_actor_id
      AND role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions: you must be an admin or editor in this space';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  -- Security: 社内承認のレビュアーは社内ロール（admin / editor）のみ。
  -- client / vendor ロールのメンバーは指定不可（クライアント確認はボールで行う）。
  IF EXISTS (
    SELECT rid FROM unnest(p_reviewer_ids) AS rid
    WHERE rid NOT IN (
      SELECT user_id FROM space_memberships
      WHERE space_id = v_task.space_id
        AND role IN ('admin', 'editor')
    )
  ) THEN
    RAISE EXCEPTION 'One or more reviewer IDs are not internal members (admin/editor) of this space';
  END IF;

  -- Upsert review (task_id is UNIQUE) — status determined after approval updates
  INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
  ON CONFLICT (task_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_review_id;

  -- Get currently existing reviewer IDs
  SELECT COALESCE(array_agg(reviewer_id), '{}')
  INTO v_existing_reviewer_ids
  FROM review_approvals
  WHERE review_id = v_review_id;

  -- Remove reviewers no longer in the list
  DELETE FROM review_approvals
  WHERE review_id = v_review_id
    AND reviewer_id != ALL(p_reviewer_ids);

  -- Add only NEW reviewers as 'pending' (preserve existing approvals)
  INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
  SELECT v_task.org_id, v_review_id, rid, 'pending'
  FROM unnest(p_reviewer_ids) AS rid
  WHERE rid != ALL(v_existing_reviewer_ids);

  -- Reset 'blocked' reviewers back to 'pending' on re-review
  -- (approved items are preserved per REVIEW_SPEC)
  UPDATE review_approvals
  SET state = 'pending', blocked_reason = NULL, updated_at = now()
  WHERE review_id = v_review_id AND state = 'blocked';

  -- Re-evaluate review status based on current approval states
  SELECT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    v_final_status := 'open';
  ELSE
    v_final_status := 'approved';
  END IF;

  UPDATE reviews SET status = v_final_status, updated_at = now()
  WHERE id = v_review_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_OPEN',
    jsonb_build_object('reviewerIds', p_reviewer_ids)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- rpc_apply_preset_to_space（土台: 20260705222754_fix_preset_rpc_milestones_columns.sql）
CREATE OR REPLACE FUNCTION rpc_apply_preset_to_space(
  p_space_id uuid,
  p_preset_genre text,
  p_milestones jsonb DEFAULT '[]'::jsonb,
  p_wiki_pages jsonb DEFAULT '[]'::jsonb,
  p_owner_field_enabled boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_current_genre text;
  v_wiki_count int;
  v_ms_count int;
  v_milestone_record record;
  v_page_record record;
  v_created_ms int := 0;
  v_created_wp int := 0;
BEGIN
  -- 1. Auth check
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  -- 2. Fetch space
  SELECT org_id, preset_genre INTO v_org_id, v_current_genre
  FROM spaces WHERE id = p_space_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_found');
  END IF;

  -- 3. Permission check (admin or editor on the space)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = p_space_id AND user_id = v_user_id AND role IN ('admin', 'editor')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permissions');
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(p_space_id, v_org_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permissions');
  END IF;

  -- 4. Safety: reject if preset already applied (non-null, non-blank)
  IF v_current_genre IS NOT NULL AND v_current_genre != 'blank' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'preset_already_applied');
  END IF;

  -- 5. Safety: only apply when BOTH wiki AND milestones are empty
  SELECT count(*) INTO v_wiki_count FROM wiki_pages WHERE space_id = p_space_id;
  SELECT count(*) INTO v_ms_count FROM milestones WHERE space_id = p_space_id;

  IF v_wiki_count > 0 OR v_ms_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'space_not_empty',
      'wiki_count', v_wiki_count,
      'ms_count', v_ms_count
    );
  END IF;

  -- 6. Update space preset_genre
  UPDATE spaces SET preset_genre = p_preset_genre WHERE id = p_space_id;

  -- 7. Update owner_field_enabled if provided
  IF p_owner_field_enabled IS NOT NULL THEN
    UPDATE spaces SET owner_field_enabled = p_owner_field_enabled WHERE id = p_space_id;
  END IF;

  -- 8. Bulk create milestones（created_by/updated_byはmilestonesに存在しない）
  FOR v_milestone_record IN
    SELECT * FROM jsonb_to_recordset(p_milestones)
      AS x(name text, order_key numeric)
  LOOP
    INSERT INTO milestones (org_id, space_id, name, order_key)
    VALUES (v_org_id, p_space_id, v_milestone_record.name, v_milestone_record.order_key);
    v_created_ms := v_created_ms + 1;
  END LOOP;

  -- 9. Create wiki pages (non-home first, then home)
  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE NOT COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      v_org_id, p_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_created_wp := v_created_wp + 1;
  END LOOP;

  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      v_org_id, p_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_created_wp := v_created_wp + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'milestones_created', v_created_ms,
    'wiki_pages_created', v_created_wp
  );
END;
$$;

-- _create_task_notification: search_path を public に固定する（本文と実行権は変えない）。
alter function public._create_task_notification(uuid, uuid, uuid, text, text, jsonb) set search_path = public;

-- ロールバック（節 7。節 1 より先に流す）:
--   -- 15 本: 今の定義を読み、足した確認を外し、置き換えた確認とコメントを元の文字に戻して作り直す
--   do $$
--   declare
--     r record;
--     v_def text;
--   begin
--     for r in
--       select p.oid from pg_proc p
--       where p.pronamespace = 'public'::regnamespace
--         and p.proname in ('rpc_pass_ball', 'rpc_review_approve', 'rpc_review_block', 'rpc_review_cancel',
--                           'rpc_meeting_start', 'rpc_set_spec_state', 'rpc_meeting_end', 'rpc_decide_considering',
--                           'rpc_generate_meeting_minutes', 'rpc_parse_meeting_minutes', 'rpc_get_minutes_preview',
--                           'rpc_invoke_meeting_minutes_email', 'rpc_confirm_proposal_slot', 'rpc_review_open',
--                           'rpc_apply_preset_to_space')
--     loop
--       v_def := pg_get_functiondef(r.oid);
--       v_def := regexp_replace(v_def, '\n\n  -- 書き込める役割（社内の admin / editor）だけが通る[^\n]*\n  IF [^\n]*\n[^\n]*\n  END IF;', '', 'g');
--       v_def := replace(v_def, 'public.app_can_write_space(', 'public.app_can_access_space(');
--       v_def := replace(v_def, '書き込める役割（社内の admin / editor）か検証する', 'アクセス可能か検証する');
--       execute v_def;
--     end loop;
--   end $$;
--   alter function public.rpc_decide_considering(uuid, text, text, text, uuid, uuid) reset search_path;
--   alter function public.rpc_review_open(uuid, uuid[], uuid) reset search_path;
--   -- _create_task_notification: search_path だけを戻す（実行権には触れない）
--   alter function public._create_task_notification(uuid, uuid, uuid, text, text, jsonb) reset search_path;
-- =============================================================================
-- 節 8: トリガー関数は SECURITY DEFINER で動かす（本体は変えない。alter function で属性だけを変える）
--   enforce_review_gate（土台 20260706013654）… レビューが承認済みかを、呼んだ人の見え方に関係なく確かめる
--   trg_check_milestone_completion / check_and_update_milestone（土台 20260223_000）… マイルストーンの完了日時を、
--     呼んだ人の見え方に関係なく付け外しする
--   enforce_personal_task_rules（土台 20240101_000）… 個人 space の確認で、spaces を呼んだ人の見え方に関係なく読む
--   check_and_update_milestone はトリガーの中からだけ呼ぶので、anon / authenticated からは呼べなくする（service role は残す）。
--   トリガー関数（returns trigger）はトリガー以外からは呼べないので、誰が呼べるかは変えない。
-- =============================================================================

alter function public.enforce_review_gate() security definer set search_path = public;
alter function public.trg_check_milestone_completion() security definer set search_path = public;
alter function public.check_and_update_milestone(uuid) security definer set search_path = public;
revoke execute on function public.check_and_update_milestone(uuid) from public, anon, authenticated;
grant execute on function public.check_and_update_milestone(uuid) to service_role;
alter function public.enforce_personal_task_rules() security definer set search_path = public;

-- ロールバック（節 8。check_and_update_milestone の権限は、適用前に控えた proacl と違えばそれに合わせる）:
--   alter function public.enforce_personal_task_rules() security invoker reset search_path;
--   grant execute on function public.check_and_update_milestone(uuid) to public, anon, authenticated;
--   alter function public.check_and_update_milestone(uuid) security invoker reset search_path;
--   alter function public.trg_check_milestone_completion() security invoker reset search_path;
--   alter function public.enforce_review_gate() security invoker reset search_path;
-- =============================================================================
-- 節 9: マイルストーンは同じ space のものだけ（wiki_page_publications はマイルストーンと元のページが同じ組織・同じ space）
--   tasks / meetings の milestone_id は、同じ組織・同じ space のマイルストーンだけ
--   （20260908080457_wiki_structure.sql の wiki_pages と同じ確かめ方）。
--   wiki_page_publications は space を持たないので、マイルストーンと元のページ（source_page_id）がどちらも行の組織のもので、
--   同じ space にあることを確かめる（ページとマイルストーンは RLS を通らずに読む）。
--   トリガー関数の実行権は public / anon / authenticated から外す（トリガーとしては今までどおり動く）。
--   トリガーなので service role からの書き込みにも効く。milestone_id が NULL の行は確かめない。
--   SECURITY DEFINER: 呼んだ人の見え方に関係なくマイルストーンを読む。
-- =============================================================================

create or replace function public.enforce_milestone_same_space()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.milestone_id is null then
    return new;
  end if;

  if tg_table_name = 'wiki_page_publications' then
    -- マイルストーンと元のページがどちらもこの行の組織のもので、同じ space にあること
    if not exists (
      select 1
        from public.milestones m
        join public.wiki_pages w on w.id = new.source_page_id
       where m.id = new.milestone_id
         and m.org_id = new.org_id
         and w.org_id = new.org_id
         and w.space_id = m.space_id
    ) then
      raise exception '% milestone and source page must be in the same org and space', tg_table_name;
    end if;
  elsif not exists (
    select 1
      from public.milestones m
     where m.id = new.milestone_id
       and m.org_id = new.org_id
       and m.space_id = new.space_id
  ) then
    raise exception '% milestone must be in the same space', tg_table_name;
  end if;

  return new;
end;
$$;

comment on function public.enforce_milestone_same_space() is
  'tasks / meetings の milestone_id は同じ space のマイルストーンだけ。wiki_page_publications はマイルストーンと元のページが行の組織のもので同じ space にあるときだけ';

revoke all on function public.enforce_milestone_same_space() from public;
revoke all on function public.enforce_milestone_same_space() from anon;
revoke all on function public.enforce_milestone_same_space() from authenticated;

drop trigger if exists trg_enforce_milestone_same_space on public.tasks;
create trigger trg_enforce_milestone_same_space
  before insert or update of milestone_id, space_id, org_id on public.tasks
  for each row
  execute function public.enforce_milestone_same_space();

drop trigger if exists trg_enforce_milestone_same_space on public.meetings;
create trigger trg_enforce_milestone_same_space
  before insert or update of milestone_id, space_id, org_id on public.meetings
  for each row
  execute function public.enforce_milestone_same_space();

drop trigger if exists trg_enforce_milestone_same_space on public.wiki_page_publications;
create trigger trg_enforce_milestone_same_space
  before insert or update on public.wiki_page_publications
  for each row
  execute function public.enforce_milestone_same_space();

-- ロールバック（節 9）:
--   drop trigger if exists trg_enforce_milestone_same_space on public.wiki_page_publications;
--   drop trigger if exists trg_enforce_milestone_same_space on public.meetings;
--   drop trigger if exists trg_enforce_milestone_same_space on public.tasks;
--   drop function if exists public.enforce_milestone_same_space();
-- =============================================================================
-- 節 10: 確認 — RLS が有効な public の表には、すべて二要素認証の RESTRICTIVE（mfa_required_when_enrolled）がある
-- =============================================================================

do $$
declare
  v_missing text;
begin
  select string_agg(t.tablename, ', ' order by t.tablename)
    into v_missing
    from pg_tables t
   where t.schemaname = 'public'
     and t.rowsecurity
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public'
         and p.tablename = t.tablename
         and p.policyname = 'mfa_required_when_enrolled'
     );

  if v_missing is not null then
    raise exception 'space role boundary: 二要素認証の RESTRICTIVE ポリシー(mfa_required_when_enrolled)が無い RLS の表: %', v_missing;
  end if;
end $$;

-- ロールバック（節 10）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_space_role_boundary.sh（全 PASS）。
--      RED=1 を付けると本 migration を流さずに同じ assert を回し、chg_* / same_* の区分けが合っていることを確かめられる。
--   1) 適用前（本番）: 戻すときのために今の権限を控えておく:
--        select oid::regprocedure, proacl from pg_proc where proname = 'check_and_update_milestone';
--        select relacl from pg_class where oid = 'public.meetings'::regclass;
--   2) 適用後（本番）: トランザクションの中で set local role authenticated と request.jwt.claims（sub）を
--      設定し、立場ごと（社内の編集者・相手先）に見え方と書き込みを確かめてから rollback する。
--        select proconfig from pg_proc
--         where oid = 'public._create_task_notification(uuid,uuid,uuid,text,text,jsonb)'::regprocedure;  → {search_path=public}
--        select has_column_privilege('authenticated', 'public.meetings', 'notes', 'select');   → false
--        select count(*) from pg_proc where proname in (<節 7 の 15 本>)
--           and prosrc like '%app_can_access_space%';                                          → 0
--   3) 画面: 相手先のポータル一式（ダッシュボード・タスク・会議・Wiki・承認・修正依頼・見積・依頼作成）と、
--      社内の会議の一覧・作成・詳細、Wiki の公開、レビューの承認、ボール渡し、マイルストーンの自動完了、議事録。
-- =============================================================================
