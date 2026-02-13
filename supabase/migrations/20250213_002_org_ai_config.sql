-- org_ai_config: 組織ごとのLLM APIキー管理
create table if not exists org_ai_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'openai',
  api_key_encrypted text not null,
  model text default 'gpt-4o-mini',
  enabled boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (org_id)
);

-- RLS
alter table org_ai_config enable row level security;

create policy "org_owners_manage_ai_config" on org_ai_config
  for all using (
    org_id in (
      select org_id from org_memberships where user_id = auth.uid() and role = 'owner'
    )
  );
