-- =============================================================================
-- RLS: GitHub 連携テーブルの読み書きを社内メンバー（owner/admin/member）に限定
-- 確定設計: Fable 裁定 2026-09-10
-- 依存: 20240205_000_github_integration.sql, 20240205_001_github_security_fixes.sql,
--       20260703_001_rls_helpers.sql（app_is_org_internal / app_is_space_member）を先に適用。
--
-- 目的: GitHub 連携の5テーブルの閲覧条件が「組織/プロジェクトのメンバー全員」になっており、
--   社外ロール（org role='client'、space role='client'/'vendor'）も含まれていた。
--   GitHub 連携は社内向け機能のため、社内メンバーだけに限定する。
--
-- 確定した可視性（社内 = app_is_org_internal(その行の org_id) = owner/admin/member。client・vendor は含まない）:
--   github_installations  select = 社内
--                         書込   = 既存 "org owners can manage installations"（owner の for all）のまま
--   github_repositories   select = 社内
--                         書込   = 既存 "org owners can manage repositories"（owner の for all）のまま
--   space_github_repos    select = 社内 かつ その space のメンバー
--                         for all = 既存「space admin/editor」かつ 社内
--   github_pull_requests  select = 社内。書込ポリシーなし（service role のみ。変更なし）
--   task_github_links     select = 社内 かつ そのタスクの space のメンバー
--                         insert = 社内 かつ space admin/editor
--                         delete = （作成者 or space admin）かつ 社内
--                         update = ポリシーなし（変更なし）
--   github_webhook_events 対象外（既存の owner 限定のまま）
--   ※ vendor は招待受諾で org role='client' ＋ space role='vendor' になる（20260706004313）。
--     社内判定は org role で行うため、space role が editor/admin でも org role が client なら不可。
--
-- 範囲: 上記5テーブルの permissive ポリシーのみ。表・列・データ・関数・GRANT は変更しない。
--   ポリシーの対象ロール（to 句）も従来どおり指定なしのまま。
--   20260907142526_mfa_rls_enforcement.sql の restrictive ポリシー（mfa_required_when_enrolled）は触らない。
--   service_role（Webhook 受信・インストール後コールバック）は RLS を通らないため影響なし。
--   社内メンバーの見え方・操作は従来どおり（社内メンバーはこれまでの条件も満たしている）。
-- 名前: select ポリシーは意味が変わるため新しい名前で作り直す（旧名は drop）。
--   書込ポリシーは名前を維持し、条件に社内判定を AND で足す。
-- 冪等: drop policy if exists → create policy。再実行安全。
-- 可逆: 末尾ロールバック節（旧ポリシーへ戻す）。破壊的操作なし（データは消えない）。
-- =============================================================================

-- 念のため RLS 有効を再宣言（20240205_000 で有効化済み。再実行安全）
alter table public.github_installations enable row level security;
alter table public.github_repositories enable row level security;
alter table public.space_github_repos enable row level security;
alter table public.github_pull_requests enable row level security;
alter table public.task_github_links enable row level security;

-- -----------------------------------------------------------------------------
-- 1) github_installations: select = 社内（書込の owner 限定ポリシーは変更しない）
-- -----------------------------------------------------------------------------
drop policy if exists "org members can view installations" on public.github_installations;
drop policy if exists "internal members can view installations" on public.github_installations;
create policy "internal members can view installations"
  on public.github_installations
  for select
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 2) github_repositories: select = 社内（書込の owner 限定ポリシーは変更しない）
-- -----------------------------------------------------------------------------
drop policy if exists "org members can view repositories" on public.github_repositories;
drop policy if exists "internal members can view repositories" on public.github_repositories;
create policy "internal members can view repositories"
  on public.github_repositories
  for select
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 3) space_github_repos: select = 社内 かつ space メンバー / for all = 既存条件 かつ 社内
-- -----------------------------------------------------------------------------
drop policy if exists "space members can view repo links" on public.space_github_repos;
drop policy if exists "internal space members can view repo links" on public.space_github_repos;
create policy "internal space members can view repo links"
  on public.space_github_repos
  for select
  using (
    public.app_is_org_internal(org_id)
    and public.app_is_space_member(space_id)
  );

-- for all（using のみ。insert/update の新しい行にも同じ条件がかかる）
drop policy if exists "space admins can manage repo links" on public.space_github_repos;
create policy "space admins can manage repo links"
  on public.space_github_repos
  for all
  using (
    public.app_is_org_internal(org_id)
    and space_id in (
      select space_id from public.space_memberships
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

-- -----------------------------------------------------------------------------
-- 4) github_pull_requests: select = 社内（書込ポリシーは作らない）
-- -----------------------------------------------------------------------------
drop policy if exists "org members can view PRs" on public.github_pull_requests;
drop policy if exists "internal members can view PRs" on public.github_pull_requests;
create policy "internal members can view PRs"
  on public.github_pull_requests
  for select
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 5) task_github_links: select / insert / delete に社内判定を AND（update は作らない）
-- -----------------------------------------------------------------------------
-- 20240205_000 の旧名（20240205_001 で削除済み）。環境差で残っていた場合に備えて削除のみ行う
drop policy if exists "org members can view task links" on public.task_github_links;
drop policy if exists "org members can create task links" on public.task_github_links;
drop policy if exists "link creators can delete" on public.task_github_links;

drop policy if exists "space members can view task links" on public.task_github_links;
drop policy if exists "internal space members can view task links" on public.task_github_links;
create policy "internal space members can view task links"
  on public.task_github_links
  for select
  using (
    public.app_is_org_internal(org_id)
    and task_id in (
      select t.id from public.tasks t
      join public.space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
    )
  );

drop policy if exists "space editors can create task links" on public.task_github_links;
create policy "space editors can create task links"
  on public.task_github_links
  for insert
  with check (
    public.app_is_org_internal(org_id)
    and task_id in (
      select t.id from public.tasks t
      join public.space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
        and sm.role in ('admin', 'editor')
    )
  );

drop policy if exists "link creators or space admins can delete" on public.task_github_links;
create policy "link creators or space admins can delete"
  on public.task_github_links
  for delete
  using (
    public.app_is_org_internal(org_id)
    and (
      created_by = auth.uid()
      or task_id in (
        select t.id from public.tasks t
        join public.space_memberships sm on sm.space_id = t.space_id
        where sm.user_id = auth.uid()
          and sm.role = 'admin'
      )
    )
  );

-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_rls_github_internal_only.sh（全 PASS）
--      RED=1 を付けると本 migration 抜きで流し、社外視点の assert が FAIL することを確認できる。
--   1) 適用前後に本番のポリシー一覧を確認（想定外の permissive ポリシーが無いこと）:
--        select tablename, policyname, permissive, cmd, qual, with_check
--          from pg_policies
--         where schemaname = 'public'
--           and tablename in ('github_installations','github_repositories','space_github_repos',
--                             'github_pull_requests','task_github_links')
--         order by tablename, policyname;
--      適用後の permissive は、qual/with_check に app_is_org_internal か role = 'owner' を含むものだけ。
--   2) 社内ユーザー: プロジェクト設定の GitHub 画面でリポジトリ一覧・紐づけ追加/解除、
--      タスク詳細の PR 紐づけ/解除が従来どおり動く。
--   3) client / vendor のユーザー: 5テーブルとも 0 件。
--      （ポータル画面は元々この5テーブルを表示していないため、画面上の変化は無い）
--
-- ロールバック（旧ポリシーへ戻す。データは変わらない。※戻すと社外ロールの閲覧も元に戻る）:
--   drop policy if exists "internal members can view installations" on public.github_installations;
--   create policy "org members can view installations" on public.github_installations
--     for select using (org_id in (select org_id from org_memberships where user_id = auth.uid()));
--   drop policy if exists "internal members can view repositories" on public.github_repositories;
--   create policy "org members can view repositories" on public.github_repositories
--     for select using (org_id in (select org_id from org_memberships where user_id = auth.uid()));
--   drop policy if exists "internal space members can view repo links" on public.space_github_repos;
--   create policy "space members can view repo links" on public.space_github_repos
--     for select using (space_id in (select space_id from space_memberships where user_id = auth.uid()));
--   drop policy if exists "space admins can manage repo links" on public.space_github_repos;
--   create policy "space admins can manage repo links" on public.space_github_repos
--     for all using (space_id in (select space_id from space_memberships
--       where user_id = auth.uid() and role in ('admin', 'editor')));
--   drop policy if exists "internal members can view PRs" on public.github_pull_requests;
--   create policy "org members can view PRs" on public.github_pull_requests
--     for select using (org_id in (select org_id from org_memberships where user_id = auth.uid()));
--   drop policy if exists "internal space members can view task links" on public.task_github_links;
--   create policy "space members can view task links" on public.task_github_links
--     for select using (task_id in (select t.id from tasks t
--       join space_memberships sm on sm.space_id = t.space_id where sm.user_id = auth.uid()));
--   drop policy if exists "space editors can create task links" on public.task_github_links;
--   create policy "space editors can create task links" on public.task_github_links
--     for insert with check (task_id in (select t.id from tasks t
--       join space_memberships sm on sm.space_id = t.space_id
--       where sm.user_id = auth.uid() and sm.role in ('admin', 'editor')));
--   drop policy if exists "link creators or space admins can delete" on public.task_github_links;
--   create policy "link creators or space admins can delete" on public.task_github_links
--     for delete using (created_by = auth.uid() or task_id in (select t.id from tasks t
--       join space_memberships sm on sm.space_id = t.space_id
--       where sm.user_id = auth.uid() and sm.role = 'admin'));
--   ※ enable row level security の再宣言は元から有効なので戻す必要なし。
-- =============================================================================
