-- =============================================================================
-- Integration Connections (Phase 2)
-- 統合接続基盤: Google Calendar, Zoom, Google Meet, Teams のOAuth接続を統一管理
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) integration_connections テーブル
-- -----------------------------------------------------------------------------
create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_calendar', 'zoom', 'google_meet', 'teams')),
  owner_type text not null check (owner_type in ('user', 'org')),
  owner_id uuid not null,
  org_id uuid not null references organizations(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,
  metadata jsonb default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, owner_type, owner_id)
);

-- インデックス
create index if not exists integration_connections_org_idx
  on integration_connections(org_id);

create index if not exists integration_connections_owner_idx
  on integration_connections(owner_type, owner_id);

create index if not exists integration_connections_provider_status_idx
  on integration_connections(provider, status);

-- -----------------------------------------------------------------------------
-- 2) RLS ポリシー
-- -----------------------------------------------------------------------------

alter table integration_connections enable row level security;

-- ユーザーは自分のuser接続のみ閲覧可能
create policy "users can view own connections"
  on integration_connections for select
  using (
    (owner_type = 'user' and owner_id = auth.uid())
    or
    (owner_type = 'org' and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = auth.uid() and om.role = 'owner'
    ))
  );

-- ユーザーは自分のuser接続のみ作成可能
create policy "users can insert own connections"
  on integration_connections for insert
  with check (
    (owner_type = 'user' and owner_id = auth.uid())
    or
    (owner_type = 'org' and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = auth.uid() and om.role = 'owner'
    ))
  );

-- ユーザーは自分のuser接続のみ更新可能
create policy "users can update own connections"
  on integration_connections for update
  using (
    (owner_type = 'user' and owner_id = auth.uid())
    or
    (owner_type = 'org' and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = auth.uid() and om.role = 'owner'
    ))
  );

-- ユーザーは自分のuser接続のみ削除可能
create policy "users can delete own connections"
  on integration_connections for delete
  using (
    (owner_type = 'user' and owner_id = auth.uid())
    or
    (owner_type = 'org' and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = auth.uid() and om.role = 'owner'
    ))
  );

-- -----------------------------------------------------------------------------
-- 3) Updated_at trigger
-- -----------------------------------------------------------------------------

create or replace function update_integration_connections_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger integration_connections_updated_at
  before update on integration_connections
  for each row execute function update_integration_connections_updated_at();
