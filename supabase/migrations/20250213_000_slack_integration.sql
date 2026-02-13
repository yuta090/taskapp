-- =============================================================================
-- Slack Integration
-- SpaceとSlackチャンネルを連携し、タスク情報を共有する
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Slack Workspace 連携情報（組織単位）
-- -----------------------------------------------------------------------------
create table if not exists slack_workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  team_id text not null,
  team_name text not null,
  -- Phase 1: bot_tokenは環境変数で管理。Phase 2でVault暗号化保存に移行予定。
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, team_id)
);

-- -----------------------------------------------------------------------------
-- 2) Space-Channel 紐付け（1 Space : 1 Channel）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3) Slack メッセージログ（監査・冪等性）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 4) RLS ポリシー
-- -----------------------------------------------------------------------------

alter table slack_workspaces enable row level security;

create policy "org members can view slack workspaces"
  on slack_workspaces for select
  using (org_id in (
    select om.org_id from org_memberships om where om.user_id = auth.uid()
  ));

create policy "org owners can manage slack workspaces"
  on slack_workspaces for all
  using (org_id in (
    select om.org_id from org_memberships om
    where om.user_id = auth.uid() and om.role = 'owner'
  ));

alter table space_slack_channels enable row level security;

create policy "space members can view slack channels"
  on space_slack_channels for select
  using (space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
  ));

create policy "space admins can manage slack channels"
  on space_slack_channels for all
  using (space_id in (
    select sm.space_id from space_memberships sm
    where sm.user_id = auth.uid() and sm.role in ('admin', 'editor')
  ));

alter table slack_message_logs enable row level security;

create policy "space members can view message logs"
  on slack_message_logs for select
  using (space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
  ));

-- -----------------------------------------------------------------------------
-- 5) Updated_at triggers
-- -----------------------------------------------------------------------------

create or replace function update_slack_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger slack_workspaces_updated_at
  before update on slack_workspaces
  for each row execute function update_slack_updated_at();

create trigger space_slack_channels_updated_at
  before update on space_slack_channels
  for each row execute function update_slack_updated_at();
