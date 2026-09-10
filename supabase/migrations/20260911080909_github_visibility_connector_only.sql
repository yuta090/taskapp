-- =============================================================================
-- GitHub 連携の見える範囲を「接続した本人」に絞る（応急処置 PR-A：行の絞り込みだけ）
-- 確定設計: Fable 裁定 2026-09-11
-- 依存: 20240205_000_github_integration.sql, 20240205_001_github_security_fixes.sql,
--       20260703_001_rls_helpers.sql（app_is_org_internal / app_is_space_member）,
--       20260907142526_mfa_rls_enforcement.sql（mfa_required_when_enrolled）,
--       20260910212804_rls_github_internal_only.sql, 20260911002110_github_issues_link.sql を先に適用。
--
-- 目的: 組織の GitHub リポジトリの一覧と名前は、GitHub を接続した本人（github_installations.created_by）
--   以外に見せない。プロジェクトへのリポジトリの追加・解除も、接続した本人だけにする。
--   （リポジトリ名から顧客名が類推できるため）
--
-- 用語:
--   接続者 = app_is_github_connector(組織, インストール)
--            … そのインストールを接続した本人（created_by）で、かつ今もその組織の社内メンバー。
--              client・vendor に変わったら接続者ではなくなる。
--   社内   = app_is_org_internal(その行の org_id) = owner/admin/member。client・vendor は含まない。
--
-- 確定した可視性:
--   github_installations   select = そのインストールの接続者だけ
--                          delete = 組織の owner（既存の owner 判定と同じ書き方）
--                          insert / update = ポリシーなし（service role のみ）
--   github_repositories    select = そのリポジトリのインストールの接続者だけ
--                          書込 = ポリシーなし（service role のみ）
--   github_webhook_events  select = その行の組織・インストールの接続者だけ（組織が空の行は誰にも見えない）
--   space_github_repos     select = 社内 かつ その space のメンバー（変更なし）
--                          insert / delete = そのリポジトリのインストールの接続者 かつ その space のメンバー かつ 社内
--                          update = ポリシーなし
--   github_pull_requests   select = 社内 かつ app_can_see_github_repo(そのリポジトリ)
--   github_issues          select = 社内 かつ app_can_see_github_repo(そのリポジトリ)
--     app_can_see_github_repo = そのリポジトリが紐づく space のどれかのメンバー、
--                               または そのリポジトリのインストールの接続者
--   task_github_links / task_github_issue_links / task_github_issue_rollups は変更しない。
--   service_role は RLS を通らないため従来どおり全行（Webhook 受信・コールバック・照合 cron に影響なし）。
--   付記: space_github_repos / task_github_links の組織一致トリガー（20240205_001）は呼び出した人の権限で
--     github_repositories / github_pull_requests を読む。見えないリポジトリ・PR を指定した追加は、
--     ポリシーより先にトリガーで拒否される（どちらでも拒否になることは同じ）。
--
-- 範囲: 上記6表の permissive ポリシー、補助関数2つ、索引1つだけ。表・列・データは変更しない
--   （列を消さないので、既存の select('*') はそのまま動く。見える行が減るだけ）。
--   20260907142526 の restrictive ポリシー（mfa_required_when_enrolled）は触らない（6表とも残る）。
-- 名前: 意味が変わる select ポリシーは新しい名前で作り直す（旧名は drop）。
--   for all の書込ポリシーは drop し、必要な操作だけ新しい名前で作る。
-- 冪等: create or replace function / create index if not exists / drop policy if exists → create policy。
--   再実行安全。
-- 破壊的変更: なし（データは消えない）。可逆: 末尾のロールバック節（元のポリシーへ戻し、関数・索引を消す）。
-- =============================================================================

-- 念のため RLS 有効を再宣言（6表とも有効化済み。再実行安全）
alter table public.github_installations enable row level security;
alter table public.github_repositories enable row level security;
alter table public.github_webhook_events enable row level security;
alter table public.space_github_repos enable row level security;
alter table public.github_pull_requests enable row level security;
alter table public.github_issues enable row level security;

-- -----------------------------------------------------------------------------
-- 1) 補助関数（app_is_org_internal と同じ作り: SECURITY DEFINER・stable・search_path 固定）
--   SECURITY DEFINER: RLS を通らずに github_installations / space_github_repos / github_repositories を読む
--   （ポリシーからポリシーを呼ぶ循環を作らない。呼び出した人の見える範囲で結果を変えない）。
--   判定は常に auth.uid()（ログイン中の本人）。未ログインなら false。
-- -----------------------------------------------------------------------------
create or replace function public.app_is_github_connector(p_org uuid, p_installation_id bigint)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- そのインストールを接続した本人で、かつ今もその組織の社内メンバーか
  select exists(
    select 1 from github_installations i
    where i.org_id = p_org
      and i.installation_id = p_installation_id
      and i.created_by = auth.uid()
  ) and public.app_is_org_internal(p_org);
$$;

comment on function public.app_is_github_connector(uuid, bigint) is
  '呼び出しユーザー(auth.uid())が、その組織の GitHub インストールを接続した本人（created_by）で、かつ社内メンバー(owner/admin/member)か。GitHub 表の RLS 判定用';

create or replace function public.app_can_see_github_repo(p_repo uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- そのリポジトリが紐づく space のどれかのメンバー、または そのリポジトリのインストールの接続者か
  select exists(
    select 1 from space_github_repos sgr
    where sgr.github_repo_id = p_repo
      and public.app_is_space_member(sgr.space_id)
  ) or exists(
    select 1 from github_repositories r
    where r.id = p_repo
      and public.app_is_github_connector(r.org_id, r.installation_id)
  );
$$;

comment on function public.app_can_see_github_repo(uuid) is
  '呼び出しユーザー(auth.uid())が、そのリポジトリの PR・Issue を見てよいか（紐づく space のメンバー、またはインストールの接続者）。社内判定は含まない（ポリシー側で app_is_org_internal と組み合わせる）';

-- RLS ポリシーの内部判定用。anon には渡さない（app_is_org_owner_or_admin と同じ扱い）
revoke all on function public.app_is_github_connector(uuid, bigint) from public, anon;
grant execute on function public.app_is_github_connector(uuid, bigint) to authenticated, service_role;
revoke all on function public.app_can_see_github_repo(uuid) from public, anon;
grant execute on function public.app_can_see_github_repo(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) 索引: PR・Issue の判定（app_can_see_github_repo）がリポジトリから紐づけを引くため
-- -----------------------------------------------------------------------------
create index if not exists space_github_repos_repo_idx
  on public.space_github_repos (github_repo_id);

-- -----------------------------------------------------------------------------
-- 3) github_installations: select = 接続者 / delete = 組織の owner / insert・update = ポリシーなし
-- -----------------------------------------------------------------------------
-- 20240205_000 の旧名（20260910212804 で削除済み）。環境差で残っていた場合に備えて削除のみ行う
drop policy if exists "org members can view installations" on public.github_installations;

drop policy if exists "internal members can view installations" on public.github_installations;
drop policy if exists "org owners can manage installations" on public.github_installations;

drop policy if exists "connector can view installations" on public.github_installations;
create policy "connector can view installations"
  on public.github_installations
  for select
  using ( public.app_is_github_connector(org_id, installation_id) );

drop policy if exists "org owners can delete installations" on public.github_installations;
create policy "org owners can delete installations"
  on public.github_installations
  for delete
  using ( org_id in (
    select org_id from public.org_memberships
    where user_id = auth.uid() and role = 'owner'
  ) );

-- -----------------------------------------------------------------------------
-- 4) github_repositories: select = 接続者 / 書込ポリシーなし
-- -----------------------------------------------------------------------------
-- 20240205_000 の旧名（20260910212804 で削除済み）。環境差で残っていた場合に備えて削除のみ行う
drop policy if exists "org members can view repositories" on public.github_repositories;

drop policy if exists "internal members can view repositories" on public.github_repositories;
drop policy if exists "org owners can manage repositories" on public.github_repositories;

drop policy if exists "connector can view repositories" on public.github_repositories;
create policy "connector can view repositories"
  on public.github_repositories
  for select
  using ( public.app_is_github_connector(org_id, installation_id) );

-- -----------------------------------------------------------------------------
-- 5) github_webhook_events: select = 接続者（組織が空の行は app_is_github_connector が false = 誰にも見えない）
-- -----------------------------------------------------------------------------
drop policy if exists "org owners can view webhook events" on public.github_webhook_events;

drop policy if exists "connector can view webhook events" on public.github_webhook_events;
create policy "connector can view webhook events"
  on public.github_webhook_events
  for select
  using ( public.app_is_github_connector(org_id, installation_id) );

-- -----------------------------------------------------------------------------
-- 6) space_github_repos: select は変更しない（"internal space members can view repo links"）
--   insert / delete = そのリポジトリのインストールの接続者 かつ その space のメンバー かつ 社内
--   update = ポリシーなし
-- -----------------------------------------------------------------------------
drop policy if exists "space admins can manage repo links" on public.space_github_repos;

drop policy if exists "connector space members can link repos" on public.space_github_repos;
create policy "connector space members can link repos"
  on public.space_github_repos
  for insert
  with check (
    public.app_is_org_internal(org_id)
    and public.app_is_space_member(space_id)
    and exists (
      select 1 from public.github_repositories r
      where r.id = space_github_repos.github_repo_id
        and public.app_is_github_connector(r.org_id, r.installation_id)
    )
  );

drop policy if exists "connector space members can unlink repos" on public.space_github_repos;
create policy "connector space members can unlink repos"
  on public.space_github_repos
  for delete
  using (
    public.app_is_org_internal(org_id)
    and public.app_is_space_member(space_id)
    and exists (
      select 1 from public.github_repositories r
      where r.id = space_github_repos.github_repo_id
        and public.app_is_github_connector(r.org_id, r.installation_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 7) github_pull_requests: select = 社内 かつ（紐づいた space のメンバー または 接続者）
-- -----------------------------------------------------------------------------
-- 20240205_000 の旧名（20260910212804 で削除済み）。環境差で残っていた場合に備えて削除のみ行う
drop policy if exists "org members can view PRs" on public.github_pull_requests;

drop policy if exists "internal members can view PRs" on public.github_pull_requests;

drop policy if exists "linked space members or connector can view PRs" on public.github_pull_requests;
create policy "linked space members or connector can view PRs"
  on public.github_pull_requests
  for select
  using (
    public.app_is_org_internal(org_id)
    and public.app_can_see_github_repo(github_repo_id)
  );

-- -----------------------------------------------------------------------------
-- 8) github_issues: select = 社内 かつ（紐づいた space のメンバー または 接続者）
-- -----------------------------------------------------------------------------
drop policy if exists "internal members can view issues" on public.github_issues;

drop policy if exists "linked space members or connector can view issues" on public.github_issues;
create policy "linked space members or connector can view issues"
  on public.github_issues
  for select
  using (
    public.app_is_org_internal(org_id)
    and public.app_can_see_github_repo(github_repo_id)
  );

-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_github_visibility_connector_only.sh（全 PASS）
--      RED=1 を付けると本 migration 抜きで流し、変わるはずの assert（chg_*）が全て落ちることを確認できる。
--   1) 適用後に本番でポリシーを確認:
--        select tablename, policyname, permissive, cmd from pg_policies
--         where schemaname = 'public'
--           and tablename in ('github_installations', 'github_repositories', 'github_webhook_events',
--                             'space_github_repos', 'github_pull_requests', 'github_issues')
--         order by tablename, policyname;
--      → permissive は 9本（installations: SELECT・DELETE / repositories: SELECT / webhook_events: SELECT /
--        space_github_repos: SELECT・INSERT・DELETE / pull_requests: SELECT / issues: SELECT）
--        ＋ 6表とも mfa_required_when_enrolled（RESTRICTIVE）。
--   2) select has_function_privilege('anon', 'public.app_is_github_connector(uuid,bigint)', 'execute');  → false
--      select has_function_privilege('authenticated', 'public.app_can_see_github_repo(uuid)', 'execute'); → true
--   3) 接続した本人: 組織設定・プロジェクト設定の GitHub 画面が従来どおり見える。
--      それ以外の社内メンバー: GitHub 画面が「未接続」の表示になる（画面側の手当ては別 PR）。
--
-- ロールバック（手動・必要時のみ。本 migration の前＝20260911002110 適用後の状態へ戻す。データは変わらない）。
-- ※ 戻すと、組織の社内メンバー全員が再びリポジトリの一覧と名前・全 PR・全 Issue を読める状態に戻る。
-- ※ 新しいポリシーを先に消してから関数を消す（ポリシーが関数を参照しているため）。
-- ※ enable row level security の再宣言は元から有効なので戻す必要なし。
--   drop policy if exists "linked space members or connector can view issues" on public.github_issues;
--   create policy "internal members can view issues" on public.github_issues
--     for select using ( public.app_is_org_internal(org_id) );
--   drop policy if exists "linked space members or connector can view PRs" on public.github_pull_requests;
--   create policy "internal members can view PRs" on public.github_pull_requests
--     for select using ( public.app_is_org_internal(org_id) );
--   drop policy if exists "connector space members can unlink repos" on public.space_github_repos;
--   drop policy if exists "connector space members can link repos" on public.space_github_repos;
--   create policy "space admins can manage repo links" on public.space_github_repos
--     for all using ( public.app_is_org_internal(org_id) and space_id in (
--       select space_id from public.space_memberships
--       where user_id = auth.uid() and role in ('admin', 'editor')) );
--   drop policy if exists "connector can view webhook events" on public.github_webhook_events;
--   create policy "org owners can view webhook events" on public.github_webhook_events
--     for select using (org_id in (select org_id from org_memberships
--       where user_id = auth.uid() and role = 'owner'));
--   drop policy if exists "connector can view repositories" on public.github_repositories;
--   create policy "internal members can view repositories" on public.github_repositories
--     for select using ( public.app_is_org_internal(org_id) );
--   create policy "org owners can manage repositories" on public.github_repositories
--     for all using (org_id in (select org_id from org_memberships
--       where user_id = auth.uid() and role = 'owner'));
--   drop policy if exists "org owners can delete installations" on public.github_installations;
--   drop policy if exists "connector can view installations" on public.github_installations;
--   create policy "internal members can view installations" on public.github_installations
--     for select using ( public.app_is_org_internal(org_id) );
--   create policy "org owners can manage installations" on public.github_installations
--     for all using (org_id in (select org_id from org_memberships
--       where user_id = auth.uid() and role = 'owner'));
--   drop index if exists public.space_github_repos_repo_idx;
--   drop function if exists public.app_can_see_github_repo(uuid);
--   drop function if exists public.app_is_github_connector(uuid, bigint);
-- =============================================================================
