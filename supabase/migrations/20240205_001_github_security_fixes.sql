-- =============================================================================
-- GitHub Integration Security Fixes
-- Codex Code Reviewer で指摘されたセキュリティ問題を修正
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) github_webhook_events に RLS を有効化
-- Webhookイベントログは管理者のみ閲覧可能
-- -----------------------------------------------------------------------------
alter table github_webhook_events enable row level security;

-- 組織オーナーのみ閲覧可能
create policy "org owners can view webhook events"
  on github_webhook_events for select
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));

-- サービスロールは全操作可能（Webhook受信時に使用）
-- 注: サービスロールはRLSをバイパスするため、明示的なポリシーは不要

-- -----------------------------------------------------------------------------
-- 2) task_github_links の RLS を強化
-- Space メンバーのみがリンクを作成・閲覧できるように制限
-- -----------------------------------------------------------------------------

-- 既存ポリシーを削除
drop policy if exists "org members can view task links" on task_github_links;
drop policy if exists "org members can create task links" on task_github_links;
drop policy if exists "link creators can delete" on task_github_links;

-- Space メンバーのみ閲覧可能（タスクのSpaceに属するメンバー）
create policy "space members can view task links"
  on task_github_links for select
  using (
    task_id in (
      select t.id from tasks t
      join space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
    )
  );

-- Space メンバー（admin/editor）のみ作成可能
create policy "space editors can create task links"
  on task_github_links for insert
  with check (
    task_id in (
      select t.id from tasks t
      join space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
        and sm.role in ('admin', 'editor')
    )
  );

-- リンク作成者またはSpace管理者のみ削除可能
create policy "link creators or space admins can delete"
  on task_github_links for delete
  using (
    created_by = auth.uid()
    or task_id in (
      select t.id from tasks t
      join space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
        and sm.role = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 3) space_github_repos のクロス組織リンク防止（DB制約）
-- アプリケーション側でも検証しているが、二重防御として制約を追加
-- -----------------------------------------------------------------------------

-- 関数: space と repository が同じ org_id を持つか検証
create or replace function check_space_repo_org_match()
returns trigger as $$
declare
  space_org_id uuid;
  repo_org_id uuid;
begin
  select org_id into space_org_id from spaces where id = new.space_id;
  select org_id into repo_org_id from github_repositories where id = new.github_repo_id;

  if space_org_id is null or repo_org_id is null then
    raise exception 'Space or repository not found';
  end if;

  if space_org_id != repo_org_id then
    raise exception 'Space and repository must belong to the same organization';
  end if;

  return new;
end;
$$ language plpgsql;

-- トリガー: 挿入・更新時に検証
drop trigger if exists space_github_repos_org_check on space_github_repos;
create trigger space_github_repos_org_check
  before insert or update on space_github_repos
  for each row execute function check_space_repo_org_match();

-- -----------------------------------------------------------------------------
-- 4) task_github_links のタスク・PRの組織一致検証
-- -----------------------------------------------------------------------------

-- 関数: task と PR が同じ org_id を持つか検証
create or replace function check_task_pr_org_match()
returns trigger as $$
declare
  task_org_id uuid;
  pr_org_id uuid;
begin
  select org_id into task_org_id from tasks where id = new.task_id;
  select org_id into pr_org_id from github_pull_requests where id = new.github_pr_id;

  if task_org_id is null or pr_org_id is null then
    raise exception 'Task or PR not found';
  end if;

  if task_org_id != pr_org_id then
    raise exception 'Task and PR must belong to the same organization';
  end if;

  return new;
end;
$$ language plpgsql;

-- トリガー: 挿入・更新時に検証
drop trigger if exists task_github_links_org_check on task_github_links;
create trigger task_github_links_org_check
  before insert or update on task_github_links
  for each row execute function check_task_pr_org_match();
