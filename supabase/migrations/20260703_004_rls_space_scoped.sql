-- =============================================================================
-- RLS Rollout Stage 1 — space スコープ・テーブル群（tasks と同型のフル CRUD）
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b space スコープ / 1-c 適用順 #4）
-- 依存: 20260703_001_rls_helpers.sql（app_can_access_space）を先に適用。
--       20260703_002_rls_tasks.sql と同一の雛形（select/insert/update/delete）。
--
-- 対象テーブル（いずれも org_id + space_id を保持）:
--   milestones, meetings, reviews, task_owners, task_pricing,
--   task_events, task_relations, wiki_pages, discussion_items, meeting_participants
-- ＋ spaces（space_id 列を持たず、id 自体が space を表す特例）
--
-- 判定: app_can_access_space(space_id, org_id)
--   = 内部メンバー(owner/admin/member) は org 内全スペース可、
--     client/vendor は自スペース(space_memberships にある space)のみ可。
--   spaces のみ app_can_access_space(id, org_id) を使う。
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes）は RLS をバイパスするため対象外・影響なし。
--   anon は Stage 0 で権限剥奪済みのため対象外。
--
-- 粒度に関する注記（後続で細分化）:
--   tasks と同様、client/vendor の書込を「アクセス可能スペースなら可」の
--   粗粒度で許可する（SPEC 1-b「client/vendor の write 制限」= 要件確認事項）。
--   他者行の改変不可などの細粒度制御は後続 migration で締める。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- milestones
-- -----------------------------------------------------------------------------
alter table public.milestones enable row level security;

drop policy if exists milestones_select_member on public.milestones;
create policy milestones_select_member
  on public.milestones
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists milestones_insert_member on public.milestones;
create policy milestones_insert_member
  on public.milestones
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists milestones_update_member on public.milestones;
create policy milestones_update_member
  on public.milestones
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists milestones_delete_member on public.milestones;
create policy milestones_delete_member
  on public.milestones
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- meetings
-- -----------------------------------------------------------------------------
alter table public.meetings enable row level security;

drop policy if exists meetings_select_member on public.meetings;
create policy meetings_select_member
  on public.meetings
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meetings_insert_member on public.meetings;
create policy meetings_insert_member
  on public.meetings
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meetings_update_member on public.meetings;
create policy meetings_update_member
  on public.meetings
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meetings_delete_member on public.meetings;
create policy meetings_delete_member
  on public.meetings
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- reviews
-- -----------------------------------------------------------------------------
alter table public.reviews enable row level security;

drop policy if exists reviews_select_member on public.reviews;
create policy reviews_select_member
  on public.reviews
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists reviews_insert_member on public.reviews;
create policy reviews_insert_member
  on public.reviews
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists reviews_update_member on public.reviews;
create policy reviews_update_member
  on public.reviews
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists reviews_delete_member on public.reviews;
create policy reviews_delete_member
  on public.reviews
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- task_owners
-- -----------------------------------------------------------------------------
alter table public.task_owners enable row level security;

drop policy if exists task_owners_select_member on public.task_owners;
create policy task_owners_select_member
  on public.task_owners
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_owners_insert_member on public.task_owners;
create policy task_owners_insert_member
  on public.task_owners
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_owners_update_member on public.task_owners;
create policy task_owners_update_member
  on public.task_owners
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_owners_delete_member on public.task_owners;
create policy task_owners_delete_member
  on public.task_owners
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- task_pricing
-- -----------------------------------------------------------------------------
alter table public.task_pricing enable row level security;

drop policy if exists task_pricing_select_member on public.task_pricing;
create policy task_pricing_select_member
  on public.task_pricing
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_pricing_insert_member on public.task_pricing;
create policy task_pricing_insert_member
  on public.task_pricing
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_pricing_update_member on public.task_pricing;
create policy task_pricing_update_member
  on public.task_pricing
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_pricing_delete_member on public.task_pricing;
create policy task_pricing_delete_member
  on public.task_pricing
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- task_events（監査ログ。書込は主に service_role/RPC だが tasks と同型に揃える）
-- -----------------------------------------------------------------------------
alter table public.task_events enable row level security;

drop policy if exists task_events_select_member on public.task_events;
create policy task_events_select_member
  on public.task_events
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_events_insert_member on public.task_events;
create policy task_events_insert_member
  on public.task_events
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_events_update_member on public.task_events;
create policy task_events_update_member
  on public.task_events
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_events_delete_member on public.task_events;
create policy task_events_delete_member
  on public.task_events
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- task_relations
-- -----------------------------------------------------------------------------
alter table public.task_relations enable row level security;

drop policy if exists task_relations_select_member on public.task_relations;
create policy task_relations_select_member
  on public.task_relations
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_relations_insert_member on public.task_relations;
create policy task_relations_insert_member
  on public.task_relations
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_relations_update_member on public.task_relations;
create policy task_relations_update_member
  on public.task_relations
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists task_relations_delete_member on public.task_relations;
create policy task_relations_delete_member
  on public.task_relations
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- wiki_pages
-- -----------------------------------------------------------------------------
alter table public.wiki_pages enable row level security;

drop policy if exists wiki_pages_select_member on public.wiki_pages;
create policy wiki_pages_select_member
  on public.wiki_pages
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists wiki_pages_insert_member on public.wiki_pages;
create policy wiki_pages_insert_member
  on public.wiki_pages
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists wiki_pages_update_member on public.wiki_pages;
create policy wiki_pages_update_member
  on public.wiki_pages
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists wiki_pages_delete_member on public.wiki_pages;
create policy wiki_pages_delete_member
  on public.wiki_pages
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- discussion_items
-- -----------------------------------------------------------------------------
alter table public.discussion_items enable row level security;

drop policy if exists discussion_items_select_member on public.discussion_items;
create policy discussion_items_select_member
  on public.discussion_items
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists discussion_items_insert_member on public.discussion_items;
create policy discussion_items_insert_member
  on public.discussion_items
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists discussion_items_update_member on public.discussion_items;
create policy discussion_items_update_member
  on public.discussion_items
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists discussion_items_delete_member on public.discussion_items;
create policy discussion_items_delete_member
  on public.discussion_items
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- meeting_participants
-- -----------------------------------------------------------------------------
alter table public.meeting_participants enable row level security;

drop policy if exists meeting_participants_select_member on public.meeting_participants;
create policy meeting_participants_select_member
  on public.meeting_participants
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meeting_participants_insert_member on public.meeting_participants;
create policy meeting_participants_insert_member
  on public.meeting_participants
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meeting_participants_update_member on public.meeting_participants;
create policy meeting_participants_update_member
  on public.meeting_participants
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

drop policy if exists meeting_participants_delete_member on public.meeting_participants;
create policy meeting_participants_delete_member
  on public.meeting_participants
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- -----------------------------------------------------------------------------
-- spaces（特例: space_id 列を持たず、id 自体が space。judge に id を渡す）
-- -----------------------------------------------------------------------------
alter table public.spaces enable row level security;

drop policy if exists spaces_select_member on public.spaces;
create policy spaces_select_member
  on public.spaces
  for select
  to authenticated
  using ( public.app_can_access_space(id, org_id) );

drop policy if exists spaces_insert_member on public.spaces;
create policy spaces_insert_member
  on public.spaces
  for insert
  to authenticated
  with check ( public.app_can_access_space(id, org_id) );

drop policy if exists spaces_update_member on public.spaces;
create policy spaces_update_member
  on public.spaces
  for update
  to authenticated
  using ( public.app_can_access_space(id, org_id) )
  with check ( public.app_can_access_space(id, org_id) );

drop policy if exists spaces_delete_member on public.spaces;
create policy spaces_delete_member
  on public.spaces
  for delete
  to authenticated
  using ( public.app_can_access_space(id, org_id) );

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) 内部ユーザー(owner/admin/member) は org 内全スペースの各テーブル行が見える。
--   2) client/vendor は space_memberships にある自スペースの行のみ見え、
--      他 org / 他 space の行は 0 件（越境が消える）。
--   3) 別 org のユーザーで対象行を select/update/delete しても 0 行（IDOR 不成立）。
--   4) service_role(API routes) は従来通り全件操作可能（RLS バイパス）。
--   5) 主要動線スモーク: マイルストーン/会議/レビュー/wiki/議論/価格の各 CRUD、
--      スペース一覧・作成、portal 表示。
--   ※ spaces へ RLS を付けるため、スペース新規作成が authenticated 直経路の場合は
--      作成者が作成直後にその space の membership を持つか要確認（membership が
--      未登録だと insert の with check / 直後の select が 0 行になり得る）。
--      作成が service_role/RPC 経由なら影響なし。→ 検証項目（迷い点、下記報告参照）。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（1グループでも破綻したら該当テーブルだけ即実行）:
--   -- 例（spaces の場合）:
--   drop policy if exists spaces_delete_member on public.spaces;
--   drop policy if exists spaces_update_member on public.spaces;
--   drop policy if exists spaces_insert_member on public.spaces;
--   drop policy if exists spaces_select_member on public.spaces;
--   alter table public.spaces disable row level security;
--   -- 他テーブルも <table>_{select,insert,update,delete}_member を drop し
--   --   alter table public.<table> disable row level security; で戻す。
--   -- RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
