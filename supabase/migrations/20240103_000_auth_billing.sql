-- =============================================================================
-- Auth & Billing Schema
-- TaskApp: Authentication, Invitation, and Billing tables
-- =============================================================================

-- =============================================================================
-- 1) Plans (Static Master)
-- =============================================================================

create table if not exists plans (
  id text primary key,              -- 'free' | 'pro' | 'enterprise'
  name text not null,
  projects_limit integer,           -- NULL = unlimited
  members_limit integer,            -- internal members (owner/member)
  clients_limit integer,            -- client users
  storage_limit_bytes bigint,       -- NULL = unlimited
  stripe_product_id text,           -- for future Stripe integration
  stripe_price_id text,             -- for future Stripe integration
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed plans
insert into plans (id, name, projects_limit, members_limit, clients_limit, storage_limit_bytes)
values
  ('free', 'Free', 5, 5, 5, 104857600),           -- 100MB
  ('pro', 'Pro', 20, 20, 20, 5368709120),         -- 5GB
  ('enterprise', 'Enterprise', null, null, null, null)
on conflict (id) do nothing;

-- =============================================================================
-- 2) Org Billing
-- =============================================================================

create table if not exists org_billing (
  org_id uuid primary key references organizations(id) on delete cascade,
  plan_id text not null references plans(id),
  status text not null default 'active'
    check (status in ('active','trialing','past_due','canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_billing_plan_idx on org_billing(plan_id);
create index if not exists org_billing_stripe_customer_idx on org_billing(stripe_customer_id);
create index if not exists org_billing_stripe_subscription_idx on org_billing(stripe_subscription_id);

-- =============================================================================
-- 3) Invites (already exists in DDL v0.1, add indexes if missing)
-- =============================================================================

create index if not exists invites_token_idx on invites(token);
create index if not exists invites_email_idx on invites(email);
create index if not exists invites_org_space_idx on invites(org_id, space_id);

-- =============================================================================
-- 4) RPC: Check Org Limits
-- =============================================================================

create or replace function rpc_check_org_limits(p_org_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_plan plans%rowtype;
  v_projects_count integer;
  v_members_count integer;
  v_clients_count integer;
  v_storage_bytes bigint;
begin
  -- Get current plan
  select p.* into v_plan
  from org_billing ob
  join plans p on p.id = ob.plan_id
  where ob.org_id = p_org_id;

  if v_plan.id is null then
    -- No billing record, assume free
    select * into v_plan from plans where id = 'free';
  end if;

  -- Count current usage
  select count(*) into v_projects_count
  from spaces where org_id = p_org_id and type = 'project';

  select count(*) into v_members_count
  from org_memberships where org_id = p_org_id and role in ('owner', 'member');

  select count(*) into v_clients_count
  from org_memberships where org_id = p_org_id and role = 'client';

  -- Storage: future implementation (currently 0)
  v_storage_bytes := 0;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'projects', jsonb_build_object(
      'current', v_projects_count,
      'limit', v_plan.projects_limit,
      'can_add', v_plan.projects_limit is null or v_projects_count < v_plan.projects_limit
    ),
    'members', jsonb_build_object(
      'current', v_members_count,
      'limit', v_plan.members_limit,
      'can_add', v_plan.members_limit is null or v_members_count < v_plan.members_limit
    ),
    'clients', jsonb_build_object(
      'current', v_clients_count,
      'limit', v_plan.clients_limit,
      'can_add', v_plan.clients_limit is null or v_clients_count < v_plan.clients_limit
    ),
    'storage', jsonb_build_object(
      'current_bytes', v_storage_bytes,
      'limit_bytes', v_plan.storage_limit_bytes,
      'can_add', v_plan.storage_limit_bytes is null or v_storage_bytes < v_plan.storage_limit_bytes
    )
  );
end;
$$;

-- =============================================================================
-- 5) RPC: Create Org with Billing (for signup)
-- =============================================================================

create or replace function rpc_create_org_with_billing(
  p_org_name text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_org_id uuid;
begin
  -- Create organization
  insert into organizations (name)
  values (p_org_name)
  returning id into v_org_id;

  -- Add user as owner
  insert into org_memberships (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  -- Create billing with free plan
  insert into org_billing (org_id, plan_id)
  values (v_org_id, 'free');

  return jsonb_build_object(
    'org_id', v_org_id,
    'plan_id', 'free'
  );
end;
$$;

-- =============================================================================
-- 6) RPC: Accept Invite
-- =============================================================================

create or replace function rpc_accept_invite(
  p_token text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_invite invites%rowtype;
  v_limits jsonb;
begin
  -- Get and validate invite
  select * into v_invite
  from invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if v_invite.id is null then
    raise exception 'Invalid or expired invite token';
  end if;

  -- Check limits
  v_limits := rpc_check_org_limits(v_invite.org_id);

  if v_invite.role = 'client' then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit';
    end if;
  end if;

  -- Create org membership
  insert into org_memberships (org_id, user_id, role)
  values (v_invite.org_id, p_user_id, v_invite.role)
  on conflict (org_id, user_id) do nothing;

  -- Create space membership
  insert into space_memberships (space_id, user_id, role)
  values (
    v_invite.space_id,
    p_user_id,
    case v_invite.role
      when 'client' then 'client'
      else 'editor'
    end
  )
  on conflict (space_id, user_id) do nothing;

  -- Mark invite as accepted
  update invites
  set accepted_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'org_id', v_invite.org_id,
    'space_id', v_invite.space_id,
    'role', v_invite.role
  );
end;
$$;

-- =============================================================================
-- 7) RPC: Create Invite
-- =============================================================================

create or replace function rpc_create_invite(
  p_org_id uuid,
  p_space_id uuid,
  p_email text,
  p_role text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_token text;
  v_invite_id uuid;
  v_limits jsonb;
  v_is_authorized boolean;
begin
  -- Check authorization (owner or admin)
  select exists(
    select 1 from org_memberships
    where org_id = p_org_id
      and user_id = p_created_by
      and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id
      and user_id = p_created_by
      and role = 'admin'
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized to create invites';
  end if;

  -- Check limits
  v_limits := rpc_check_org_limits(p_org_id);

  if p_role = 'client' then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit. Please upgrade your plan.';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit. Please upgrade your plan.';
    end if;
  end if;

  -- Generate token
  v_token := gen_random_uuid()::text;

  -- Create invite
  insert into invites (org_id, space_id, email, role, token, expires_at, created_by)
  values (p_org_id, p_space_id, p_email, p_role, v_token, now() + interval '30 days', p_created_by)
  returning id into v_invite_id;

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'expires_at', (now() + interval '30 days')::text
  );
end;
$$;

-- =============================================================================
-- 8) RPC: Validate Invite Token
-- =============================================================================

create or replace function rpc_validate_invite(p_token text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_invite record;
begin
  select
    i.*,
    o.name as org_name,
    s.name as space_name,
    u.raw_user_meta_data->>'name' as inviter_name
  into v_invite
  from invites i
  join organizations o on o.id = i.org_id
  join spaces s on s.id = i.space_id
  left join auth.users u on u.id = i.created_by
  where i.token = p_token;

  if v_invite.id is null then
    return jsonb_build_object('valid', false, 'error', 'Invite not found');
  end if;

  if v_invite.accepted_at is not null then
    return jsonb_build_object('valid', false, 'error', 'Invite already accepted');
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('valid', false, 'error', 'Invite expired');
  end if;

  -- Check if user already exists
  return jsonb_build_object(
    'valid', true,
    'email', v_invite.email,
    'role', v_invite.role,
    'org_id', v_invite.org_id,
    'org_name', v_invite.org_name,
    'space_id', v_invite.space_id,
    'space_name', v_invite.space_name,
    'inviter_name', v_invite.inviter_name,
    'expires_at', v_invite.expires_at,
    'is_existing_user', exists(select 1 from auth.users where email = v_invite.email)
  );
end;
$$;
