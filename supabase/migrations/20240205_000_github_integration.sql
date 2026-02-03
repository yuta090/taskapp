-- =============================================================================
-- GitHub Integration
-- SpaceとGitHubリポジトリを連携し、PR情報をタスクに紐付ける
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) GitHub App インストール情報（組織単位）
-- -----------------------------------------------------------------------------
create table if not exists github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null default 'Organization' check (account_type in ('Organization', 'User')),
  access_token text, -- 暗号化して保存することを推奨
  token_expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, installation_id)
);

-- -----------------------------------------------------------------------------
-- 2) 連携可能なリポジトリ一覧
-- -----------------------------------------------------------------------------
create table if not exists github_repositories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  repo_id bigint not null,
  owner_login text not null,
  repo_name text not null,
  full_name text generated always as (owner_login || '/' || repo_name) stored,
  default_branch text default 'main',
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, repo_id)
);

create index if not exists github_repositories_installation_idx
  on github_repositories(installation_id);

-- -----------------------------------------------------------------------------
-- 3) Space と リポジトリの紐付け（N:N）
-- -----------------------------------------------------------------------------
create table if not exists space_github_repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  github_repo_id uuid not null references github_repositories(id) on delete cascade,
  sync_prs boolean not null default true,
  sync_commits boolean not null default false, -- Phase 2で実装
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (space_id, github_repo_id)
);

create index if not exists space_github_repos_space_idx
  on space_github_repos(space_id);

-- -----------------------------------------------------------------------------
-- 4) PR情報
-- -----------------------------------------------------------------------------
create table if not exists github_pull_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  github_repo_id uuid not null references github_repositories(id) on delete cascade,
  pr_number int not null,
  pr_title text not null,
  pr_url text not null,
  pr_state text not null check (pr_state in ('open', 'closed', 'merged')),
  author_login text,
  author_avatar_url text,
  head_branch text,
  base_branch text,
  additions int default 0,
  deletions int default 0,
  commits_count int default 0,
  merged_at timestamptz,
  closed_at timestamptz,
  pr_created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (github_repo_id, pr_number)
);

create index if not exists github_pull_requests_repo_idx
  on github_pull_requests(github_repo_id);

create index if not exists github_pull_requests_state_idx
  on github_pull_requests(pr_state);

-- -----------------------------------------------------------------------------
-- 5) タスクとPRの紐付け
-- -----------------------------------------------------------------------------
create table if not exists task_github_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  github_pr_id uuid not null references github_pull_requests(id) on delete cascade,
  link_type text not null default 'auto' check (link_type in ('auto', 'manual')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (task_id, github_pr_id)
);

create index if not exists task_github_links_task_idx
  on task_github_links(task_id);

create index if not exists task_github_links_pr_idx
  on task_github_links(github_pr_id);

-- -----------------------------------------------------------------------------
-- 6) Webhook イベントログ（デバッグ/監査用）
-- -----------------------------------------------------------------------------
create table if not exists github_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  installation_id bigint,
  event_type text not null,
  action text,
  delivery_id text,
  payload jsonb not null,
  processed boolean not null default false,
  error_message text,
  received_at timestamptz not null default now()
);

create unique index if not exists github_webhook_events_delivery_unique
  on github_webhook_events(delivery_id)
  where delivery_id is not null;

create index if not exists github_webhook_events_installation_idx
  on github_webhook_events(installation_id);

create index if not exists github_webhook_events_received_idx
  on github_webhook_events(received_at desc);

-- -----------------------------------------------------------------------------
-- 7) RLS ポリシー
-- -----------------------------------------------------------------------------

-- github_installations
alter table github_installations enable row level security;

create policy "org members can view installations"
  on github_installations for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

create policy "org owners can manage installations"
  on github_installations for all
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));

-- github_repositories
alter table github_repositories enable row level security;

create policy "org members can view repositories"
  on github_repositories for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

create policy "org owners can manage repositories"
  on github_repositories for all
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));

-- space_github_repos
alter table space_github_repos enable row level security;

create policy "space members can view repo links"
  on space_github_repos for select
  using (space_id in (
    select space_id from space_memberships where user_id = auth.uid()
  ));

create policy "space admins can manage repo links"
  on space_github_repos for all
  using (space_id in (
    select space_id from space_memberships
    where user_id = auth.uid() and role in ('admin', 'editor')
  ));

-- github_pull_requests
alter table github_pull_requests enable row level security;

create policy "org members can view PRs"
  on github_pull_requests for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

-- task_github_links
alter table task_github_links enable row level security;

create policy "org members can view task links"
  on task_github_links for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

create policy "org members can create task links"
  on task_github_links for insert
  with check (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

create policy "link creators can delete"
  on task_github_links for delete
  using (created_by = auth.uid());

-- github_webhook_events（サービスロールのみアクセス、RLS不要）
-- Webhookはサーバーサイドで処理されるため、RLSは設定しない

-- -----------------------------------------------------------------------------
-- 8) 更新トリガー
-- -----------------------------------------------------------------------------

create or replace function update_github_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger github_installations_updated_at
  before update on github_installations
  for each row execute function update_github_updated_at();

create trigger github_repositories_updated_at
  before update on github_repositories
  for each row execute function update_github_updated_at();

create trigger github_pull_requests_updated_at
  before update on github_pull_requests
  for each row execute function update_github_updated_at();
