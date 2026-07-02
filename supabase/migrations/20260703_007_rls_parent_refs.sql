-- =============================================================================
-- RLS Rollout Stage 1 — 親参照スコープ・テーブル群（org_id で anchor）
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b 親参照スコープ / 1-c 適用順 #6）
-- 依存: 20260703_001_rls_helpers.sql（app_is_org_member）を先に適用。
--
-- これらのテーブルは自前で space_id を持たず（親 reviews/meetings/tasks/milestones や
-- org 経由で space に紐づく）が、全て org_id を保持する。当面は SPEC 通り
--   using ( app_is_org_member(org_id) )
-- で org 粒度に anchor する（粒度は粗いが安全側。将来 space 粒度へ締める余地あり）。
--
-- 対象テーブルと採用ポリシー（src の書込経路調査に基づく）:
--   review_approvals        … SELECT のみ（authenticated 書込なし。書込は DEFINER RPC
--                              rpc_review_approve/block 経由。読取は portal server /
--                              NotificationInspector browser の SELECT のみ）
--   meeting_transcripts     … SELECT のみ（src に authenticated 直接書込なし＝サーバ/RPC）
--   meeting_drafts          … SELECT のみ（同上）
--   task_publications       … SELECT のみ（同上。公開はトリガ制約付きで RPC/service_role）
--   milestone_publications  … SELECT のみ（portal wiki の join で authenticated 読取あり。
--                              書込は RPC/service_role）
--   wiki_page_versions      … フル CRUD（useWikiPages browser の SELECT + INSERT あり
--                              ＝authenticated 書込あり）
--   wiki_page_publications  … フル CRUD（useWikiPages browser の INSERT + portal server の
--                              SELECT あり＝authenticated 書込あり。公開はトリガで
--                              milestone 公開済みを要求する制約が別途かかる）
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes / DEFINER RPC）は RLS をバイパスするため対象外・影響なし。
--   anon は Stage 0 で権限剥奪済みのため対象外。
--
-- ★ SELECT のみ設計の意味:
--   RLS 有効かつ書込ポリシー 0 件 = そのコマンドは authenticated から常に拒否（安全側）。
--   書込はバイパス経路（service_role / DEFINER RPC）で動く。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- review_approvals（SELECT のみ。書込は DEFINER RPC rpc_review_approve/block）
-- -----------------------------------------------------------------------------
alter table public.review_approvals enable row level security;

drop policy if exists review_approvals_select_member on public.review_approvals;
create policy review_approvals_select_member
  on public.review_approvals
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   承認状態の変更は SECURITY DEFINER RPC / service_role 経由（SPEC Stage 2）。

-- -----------------------------------------------------------------------------
-- meeting_transcripts（SELECT のみ。書込はサーバ/RPC）
-- -----------------------------------------------------------------------------
alter table public.meeting_transcripts enable row level security;

drop policy if exists meeting_transcripts_select_member on public.meeting_transcripts;
create policy meeting_transcripts_select_member
  on public.meeting_transcripts
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。

-- -----------------------------------------------------------------------------
-- meeting_drafts（SELECT のみ。書込はサーバ/RPC）
-- -----------------------------------------------------------------------------
alter table public.meeting_drafts enable row level security;

drop policy if exists meeting_drafts_select_member on public.meeting_drafts;
create policy meeting_drafts_select_member
  on public.meeting_drafts
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。

-- -----------------------------------------------------------------------------
-- task_publications（SELECT のみ。公開はトリガ制約付きで RPC/service_role）
-- -----------------------------------------------------------------------------
alter table public.task_publications enable row level security;

drop policy if exists task_publications_select_member on public.task_publications;
create policy task_publications_select_member
  on public.task_publications
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。

-- -----------------------------------------------------------------------------
-- milestone_publications（SELECT のみ。portal wiki の join 読取あり。書込は RPC/service_role）
-- -----------------------------------------------------------------------------
alter table public.milestone_publications enable row level security;

drop policy if exists milestone_publications_select_member on public.milestone_publications;
create policy milestone_publications_select_member
  on public.milestone_publications
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。

-- -----------------------------------------------------------------------------
-- wiki_page_versions（フル CRUD。useWikiPages browser の SELECT + INSERT あり）
--   org_id で anchor。バージョン・スナップショットの閲覧/作成を authenticated に許可。
-- -----------------------------------------------------------------------------
alter table public.wiki_page_versions enable row level security;

drop policy if exists wiki_page_versions_select_member on public.wiki_page_versions;
create policy wiki_page_versions_select_member
  on public.wiki_page_versions
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_versions_insert_member on public.wiki_page_versions;
create policy wiki_page_versions_insert_member
  on public.wiki_page_versions
  for insert
  to authenticated
  with check ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_versions_update_member on public.wiki_page_versions;
create policy wiki_page_versions_update_member
  on public.wiki_page_versions
  for update
  to authenticated
  using ( public.app_is_org_member(org_id) )
  with check ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_versions_delete_member on public.wiki_page_versions;
create policy wiki_page_versions_delete_member
  on public.wiki_page_versions
  for delete
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- -----------------------------------------------------------------------------
-- wiki_page_publications（フル CRUD。useWikiPages browser の INSERT + portal server の SELECT）
--   org_id で anchor。DB トリガ trg_enforce_wiki_publication_rules が
--   「milestone が公開済みでなければ公開不可」を別途強制する（RLS とは独立、そのまま維持）。
-- -----------------------------------------------------------------------------
alter table public.wiki_page_publications enable row level security;

drop policy if exists wiki_page_publications_select_member on public.wiki_page_publications;
create policy wiki_page_publications_select_member
  on public.wiki_page_publications
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_publications_insert_member on public.wiki_page_publications;
create policy wiki_page_publications_insert_member
  on public.wiki_page_publications
  for insert
  to authenticated
  with check ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_publications_update_member on public.wiki_page_publications;
create policy wiki_page_publications_update_member
  on public.wiki_page_publications
  for update
  to authenticated
  using ( public.app_is_org_member(org_id) )
  with check ( public.app_is_org_member(org_id) );

drop policy if exists wiki_page_publications_delete_member on public.wiki_page_publications;
create policy wiki_page_publications_delete_member
  on public.wiki_page_publications
  for delete
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) SELECT のみテーブル（review_approvals, meeting_transcripts, meeting_drafts,
--      task_publications, milestone_publications）: 自 org の行のみ SELECT でき、
--      他 org は 0 件。authenticated からの INSERT/UPDATE/DELETE は全拒否。
--      関連 RPC（review 承認等）と portal wiki の join 読取が従来通り動作すること。
--   2) wiki_page_versions / wiki_page_publications: 内部ユーザーが自 org の
--      バージョン閲覧・スナップショット作成・wiki 公開を実行でき、他 org は 0 件。
--      wiki 公開時の milestone 公開済みトリガ制約が従来通り効くこと。
--   3) 別 org のユーザーで対象行を select/insert/update/delete しても越境しないこと（IDOR 不成立）。
--   4) service_role（API routes / DEFINER RPC）は全テーブル従来通り操作可能（RLS バイパス）。
--   5) 主要動線スモーク: レビュー承認、会議の文字起こし/ドラフト表示、タスク/マイルストーン公開、
--      wiki のバージョン履歴・公開、portal の公開 wiki 表示。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（1グループでも破綻したら該当テーブルだけ即実行）:
--   -- wiki_page_publications
--   drop policy if exists wiki_page_publications_delete_member on public.wiki_page_publications;
--   drop policy if exists wiki_page_publications_update_member on public.wiki_page_publications;
--   drop policy if exists wiki_page_publications_insert_member on public.wiki_page_publications;
--   drop policy if exists wiki_page_publications_select_member on public.wiki_page_publications;
--   alter table public.wiki_page_publications disable row level security;
--   -- wiki_page_versions
--   drop policy if exists wiki_page_versions_delete_member on public.wiki_page_versions;
--   drop policy if exists wiki_page_versions_update_member on public.wiki_page_versions;
--   drop policy if exists wiki_page_versions_insert_member on public.wiki_page_versions;
--   drop policy if exists wiki_page_versions_select_member on public.wiki_page_versions;
--   alter table public.wiki_page_versions disable row level security;
--   -- SELECT のみテーブル
--   drop policy if exists milestone_publications_select_member on public.milestone_publications;
--   alter table public.milestone_publications disable row level security;
--   drop policy if exists task_publications_select_member on public.task_publications;
--   alter table public.task_publications disable row level security;
--   drop policy if exists meeting_drafts_select_member on public.meeting_drafts;
--   alter table public.meeting_drafts disable row level security;
--   drop policy if exists meeting_transcripts_select_member on public.meeting_transcripts;
--   alter table public.meeting_transcripts disable row level security;
--   drop policy if exists review_approvals_select_member on public.review_approvals;
--   alter table public.review_approvals disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
