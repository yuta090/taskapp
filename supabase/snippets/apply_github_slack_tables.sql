-- =============================================================================
-- GitHub + Slack テーブル一括作成（冪等版）
-- 既存のポリシーがあってもエラーにならないよう DROP IF EXISTS を使用
-- =============================================================================

-- #############################################################################
-- PART 1: GitHub Integration
-- #############################################################################

-- 1) GitHub App インストール情報
create table if not exists github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null default 'Organization' check (account_type in ('Organization', 'User')),
  access_token text,
  token_expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, installation_id)
);

-- 2) 連携可能なリポジトリ一覧
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

-- 3) Space と リポジトリの紐付け（N:N）
create table if not exists space_github_repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  github_repo_id uuid not null references github_repositories(id) on delete cascade,
  sync_prs boolean not null default true,
  sync_commits boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (space_id, github_repo_id)
);

create index if not exists space_github_repos_space_idx
  on space_github_repos(space_id);

-- 4) PR情報
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

-- 5) タスクとPRの紐付け
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

-- 6) Webhook イベントログ
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

-- 7) RLS ポリシー（DROP IF EXISTS → CREATE）
alter table github_installations enable row level security;

drop policy if exists "org members can view installations" on github_installations;
create policy "org members can view installations"
  on github_installations for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

drop policy if exists "org owners can manage installations" on github_installations;
create policy "org owners can manage installations"
  on github_installations for all
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));

alter table github_repositories enable row level security;

drop policy if exists "org members can view repositories" on github_repositories;
create policy "org members can view repositories"
  on github_repositories for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

drop policy if exists "org owners can manage repositories" on github_repositories;
create policy "org owners can manage repositories"
  on github_repositories for all
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));

alter table space_github_repos enable row level security;

drop policy if exists "space members can view repo links" on space_github_repos;
create policy "space members can view repo links"
  on space_github_repos for select
  using (space_id in (
    select space_id from space_memberships where user_id = auth.uid()
  ));

drop policy if exists "space admins can manage repo links" on space_github_repos;
create policy "space admins can manage repo links"
  on space_github_repos for all
  using (space_id in (
    select space_id from space_memberships
    where user_id = auth.uid() and role in ('admin', 'editor')
  ));

alter table github_pull_requests enable row level security;

drop policy if exists "org members can view PRs" on github_pull_requests;
create policy "org members can view PRs"
  on github_pull_requests for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

alter table task_github_links enable row level security;

drop policy if exists "org members can view task links" on task_github_links;
create policy "org members can view task links"
  on task_github_links for select
  using (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

drop policy if exists "org members can create task links" on task_github_links;
create policy "org members can create task links"
  on task_github_links for insert
  with check (org_id in (
    select org_id from org_memberships where user_id = auth.uid()
  ));

drop policy if exists "link creators can delete" on task_github_links;
create policy "link creators can delete"
  on task_github_links for delete
  using (created_by = auth.uid());

-- 8) 更新トリガー
create or replace function update_github_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists github_installations_updated_at on github_installations;
create trigger github_installations_updated_at
  before update on github_installations
  for each row execute function update_github_updated_at();

drop trigger if exists github_repositories_updated_at on github_repositories;
create trigger github_repositories_updated_at
  before update on github_repositories
  for each row execute function update_github_updated_at();

drop trigger if exists github_pull_requests_updated_at on github_pull_requests;
create trigger github_pull_requests_updated_at
  before update on github_pull_requests
  for each row execute function update_github_updated_at();


-- #############################################################################
-- PART 2: Slack Integration
-- #############################################################################

-- 1) Slack Workspace 連携情報
create table if not exists slack_workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  team_id text not null,
  team_name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, team_id)
);

-- 2) Space-Channel 紐付け
create table if not exists space_slack_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  slack_workspace_id uuid not null references slack_workspaces(id) on delete cascade,
  channel_id text not null,
  channel_name text not null,
  notify_task_created boolean not null default true,
  notify_ball_passed boolean not null default true,
  notify_status_changed boolean not null default true,
  notify_comment_added boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id)
);

create index if not exists space_slack_channels_space_idx
  on space_slack_channels(space_id);

-- 3) Slack メッセージログ
create table if not exists slack_message_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  channel_id text not null,
  message_type text not null,
  task_id uuid references tasks(id) on delete set null,
  slack_ts text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'sent' check (status in ('sent', 'failed', 'pending')),
  error_message text,
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists slack_message_logs_dedupe_unique
  on slack_message_logs(dedupe_key)
  where dedupe_key is not null;

create index if not exists slack_message_logs_space_idx
  on slack_message_logs(space_id, created_at desc);

create index if not exists slack_message_logs_task_idx
  on slack_message_logs(task_id)
  where task_id is not null;

-- 4) RLS ポリシー（DROP IF EXISTS → CREATE）
alter table slack_workspaces enable row level security;

drop policy if exists "org members can view slack workspaces" on slack_workspaces;
create policy "org members can view slack workspaces"
  on slack_workspaces for select
  using (org_id in (
    select om.org_id from org_memberships om where om.user_id = auth.uid()
  ));

drop policy if exists "org owners can manage slack workspaces" on slack_workspaces;
create policy "org owners can manage slack workspaces"
  on slack_workspaces for all
  using (org_id in (
    select om.org_id from org_memberships om
    where om.user_id = auth.uid() and om.role = 'owner'
  ));

alter table space_slack_channels enable row level security;

drop policy if exists "space members can view slack channels" on space_slack_channels;
create policy "space members can view slack channels"
  on space_slack_channels for select
  using (space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
  ));

drop policy if exists "space admins can manage slack channels" on space_slack_channels;
create policy "space admins can manage slack channels"
  on space_slack_channels for all
  using (space_id in (
    select sm.space_id from space_memberships sm
    where sm.user_id = auth.uid() and sm.role in ('admin', 'editor')
  ));

alter table slack_message_logs enable row level security;

drop policy if exists "space members can view message logs" on slack_message_logs;
create policy "space members can view message logs"
  on slack_message_logs for select
  using (space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
  ));

-- 5) Updated_at triggers
create or replace function update_slack_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists slack_workspaces_updated_at on slack_workspaces;
create trigger slack_workspaces_updated_at
  before update on slack_workspaces
  for each row execute function update_slack_updated_at();

drop trigger if exists space_slack_channels_updated_at on space_slack_channels;
create trigger space_slack_channels_updated_at
  before update on space_slack_channels
  for each row execute function update_slack_updated_at();


-- #############################################################################
-- PART 3: Slack OAuth カラム追加
-- #############################################################################

create extension if not exists pgcrypto;

alter table slack_workspaces
  add column if not exists bot_token_encrypted text,
  add column if not exists bot_user_id text,
  add column if not exists app_id text,
  add column if not exists scope text,
  add column if not exists installed_by uuid references auth.users(id),
  add column if not exists token_obtained_at timestamptz;

create or replace function encrypt_slack_token(token text, secret text)
returns text as $$
  select encode(pgp_sym_encrypt(token, secret), 'base64');
$$ language sql security definer;

create or replace function decrypt_slack_token(encrypted text, secret text)
returns text as $$
  select pgp_sym_decrypt(decode(encrypted, 'base64'), secret);
$$ language sql security definer;

comment on column slack_workspaces.bot_token_encrypted is 'pgcrypto暗号化済みBot Token。SLACK_CLIENT_SECRETをキーとして使用。';
comment on column slack_workspaces.bot_user_id is 'OAuth応答から取得したBot User ID';
comment on column slack_workspaces.app_id is 'Slack App ID（OAuth応答から自動取得）';
comment on column slack_workspaces.scope is 'OAuth認証時に付与されたスコープ一覧';
comment on column slack_workspaces.installed_by is 'OAuthまたは手動入力を実行したユーザー';
comment on column slack_workspaces.token_obtained_at is 'トークン取得日時';


-- #############################################################################
-- PART 4: channel_id インデックス
-- #############################################################################

create index if not exists idx_space_slack_channels_channel_id
  on space_slack_channels (channel_id);
