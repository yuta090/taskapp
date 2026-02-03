-- Postgres DDL - Complete Schema
-- Combined from DDL v0.1 + v0.2
-- TaskApp: Client-facing project management with ball ownership

create extension if not exists pgcrypto;

-- =============================================================================
-- 1) Organizations / Memberships
-- =============================================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member','client')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- =============================================================================
-- 2) Spaces
-- =============================================================================

create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('project','personal')),
  name text not null,
  owner_user_id uuid null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint spaces_personal_owner_chk check (
    (type='personal' and owner_user_id is not null) or
    (type='project' and owner_user_id is null)
  )
);

create unique index if not exists spaces_personal_unique
  on spaces(org_id, owner_user_id)
  where type='personal';

create table if not exists space_memberships (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','editor','viewer','client')),
  created_at timestamptz not null default now(),
  unique (space_id, user_id)
);

-- =============================================================================
-- 3) Milestones + Publications
-- =============================================================================

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null,
  due_date date null,
  order_key int null,
  created_at timestamptz not null default now()
);

create table if not exists milestone_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  milestone_id uuid not null references milestones(id) on delete cascade,
  is_published boolean not null default true,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (milestone_id)
);

-- =============================================================================
-- 4) Tasks + Ball Ownership
-- =============================================================================

create sequence if not exists tasks_short_id_seq;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  milestone_id uuid null references milestones(id) on delete set null,
  short_id bigint unique,
  title text not null,
  description text not null default '',
  status text not null check (status in ('backlog','todo','in_progress','in_review','done','considering')),
  priority smallint not null default 1 check (priority between 0 and 3),
  assignee_id uuid null references auth.users(id),
  due_date date null,
  start_date date null,
  end_date date null,
  -- v0.2: Ball ownership and spec tracking
  ball text not null default 'internal' check (ball in ('client','internal')),
  origin text not null default 'internal' check (origin in ('client','internal')),
  type text not null default 'task' check (type in ('task','spec')),
  spec_path text null,
  decision_state text null check (decision_state in ('considering','decided','implemented')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Spec task constraints
  constraint tasks_spec_required_chk check (
    type <> 'spec'
    or (
      spec_path is not null
      and spec_path like '/spec/%#%'
      and decision_state is not null
    )
  )
);

-- Indexes
create index if not exists tasks_type_state_idx on tasks(type, decision_state);
create index if not exists tasks_ball_idx on tasks(ball);
create index if not exists tasks_origin_idx on tasks(origin);

-- Auto short_id trigger
create or replace function set_task_short_id()
returns trigger language plpgsql as $$
begin
  if new.short_id is null then
    new.short_id := nextval('tasks_short_id_seq');
  end if;
  return new;
end $$;

drop trigger if exists trg_set_task_short_id on tasks;
create trigger trg_set_task_short_id
before insert on tasks
for each row execute function set_task_short_id();

-- Personal task rules
create or replace function enforce_personal_task_rules()
returns trigger language plpgsql as $$
declare v_type text;
declare v_owner uuid;
begin
  select type, owner_user_id into v_type, v_owner
  from spaces where id = new.space_id;

  if v_type = 'personal' then
    if new.milestone_id is not null then
      raise exception 'Personal task cannot have milestone_id';
    end if;
    if v_owner is distinct from auth.uid() then
      raise exception 'Cannot write to another user personal space';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_personal_task_rules on tasks;
create trigger trg_enforce_personal_task_rules
before insert or update on tasks
for each row execute function enforce_personal_task_rules();

-- Task relations
create table if not exists task_relations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  from_task_id uuid not null references tasks(id) on delete cascade,
  to_task_id uuid not null references tasks(id) on delete cascade,
  type text not null check (type in ('blocks','related')),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 5) Task Owners (v0.2)
-- =============================================================================

create table if not exists task_owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  side text not null check (side in ('client','internal')),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, side, user_id)
);

create index if not exists task_owners_task_side_idx on task_owners(task_id, side);

-- =============================================================================
-- 6) Task Publications
-- =============================================================================

create table if not exists task_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  milestone_id uuid not null references milestones(id) on delete cascade,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (task_id)
);

create or replace function enforce_task_publication_rules()
returns trigger language plpgsql as $$
declare t_milestone uuid;
declare pub_exists boolean;
begin
  select milestone_id into t_milestone from tasks where id = new.task_id;

  if t_milestone is null then
    raise exception 'Cannot publish a task without milestone_id';
  end if;

  if t_milestone <> new.milestone_id then
    raise exception 'task_publications.milestone_id must match tasks.milestone_id';
  end if;

  select exists(
    select 1 from milestone_publications mp
    where mp.milestone_id = new.milestone_id and mp.is_published = true
  ) into pub_exists;

  if not pub_exists then
    raise exception 'Cannot publish task: milestone is not published';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_task_publication_rules on task_publications;
create trigger trg_enforce_task_publication_rules
before insert or update on task_publications
for each row execute function enforce_task_publication_rules();

-- =============================================================================
-- 7) Wiki + Versions + Publications
-- =============================================================================

create table if not exists wiki_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wiki_page_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  page_id uuid not null references wiki_pages(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists wiki_page_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  milestone_id uuid not null references milestones(id) on delete cascade,
  source_page_id uuid not null references wiki_pages(id) on delete cascade,
  published_title text not null,
  published_body text not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now()
);

create or replace function enforce_wiki_publication_rules()
returns trigger language plpgsql as $$
declare pub_exists boolean;
begin
  select exists(
    select 1 from milestone_publications mp
    where mp.milestone_id = new.milestone_id and mp.is_published = true
  ) into pub_exists;

  if not pub_exists then
    raise exception 'Cannot publish wiki: milestone is not published';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_wiki_publication_rules on wiki_page_publications;
create trigger trg_enforce_wiki_publication_rules
before insert or update on wiki_page_publications
for each row execute function enforce_wiki_publication_rules();

-- =============================================================================
-- 9) Meetings + Lifecycle (v0.2)
-- =============================================================================

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  milestone_id uuid null references milestones(id) on delete set null,
  title text not null,
  held_at timestamptz not null,
  notes text null,
  -- v0.2: Lifecycle fields
  status text not null default 'planned' check (status in ('planned','in_progress','ended')),
  started_at timestamptz null,
  ended_at timestamptz null,
  minutes_md text null,
  summary_subject text null,
  summary_body text null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meetings_space_status_idx on meetings(space_id, status, held_at desc);

-- Meeting participants (v0.2)
create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side text not null check (side in ('client','internal')),
  created_at timestamptz not null default now(),
  unique (meeting_id, user_id)
);

create index if not exists meeting_participants_meeting_idx on meeting_participants(meeting_id);

-- =============================================================================
-- 10) Task Events - Audit Log (v0.2) - After meetings for FK reference
-- =============================================================================

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  meeting_id uuid null references meetings(id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_events_task_id_idx on task_events(task_id, created_at desc);
create index if not exists task_events_meeting_id_idx on task_events(meeting_id, created_at desc);

-- Meeting transcripts
create table if not exists meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  provider text not null check (provider in ('manual','zoom','meet','teams','tactiq')),
  raw_text text not null,
  normalized_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Meeting drafts
create table if not exists meeting_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  draft_json jsonb not null,
  created_by uuid not null references auth.users(id),
  status text not null check (status in ('draft','applied','discarded')),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 10) Reviews (v0.2)
-- =============================================================================

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  status text not null default 'open' check (status in ('open','approved','changes_requested')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id)
);

create table if not exists review_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  review_id uuid not null references reviews(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','approved','blocked')),
  blocked_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, reviewer_id)
);

create index if not exists reviews_task_idx on reviews(task_id);
create index if not exists review_approvals_review_idx on review_approvals(review_id);

-- =============================================================================
-- 11) Notifications (v0.2)
-- =============================================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app','email')),
  type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  unique (to_user_id, channel, dedupe_key)
);

create index if not exists notifications_to_user_idx on notifications(to_user_id, created_at desc);
create index if not exists notifications_space_idx on notifications(space_id, created_at desc);

-- =============================================================================
-- 12) LLM Runs
-- =============================================================================

create table if not exists llm_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  feature text not null check (feature in ('meeting_to_tasks','task_magic')),
  input_ref jsonb not null default '{}'::jsonb,
  provider text not null,
  model text not null,
  prompt_version text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric null,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 13) Invites
-- =============================================================================

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('client','member')),
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 14) Discussion Items + Comments
-- =============================================================================

create table if not exists discussion_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  milestone_id uuid not null references milestones(id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null check (status in ('open','waiting_client','waiting_dev','resolved')),
  next_owner text not null check (next_owner in ('client','dev')),
  linked_task_id uuid null references tasks(id) on delete set null,
  source_meeting_id uuid null references meetings(id) on delete set null,
  is_client_visible boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discussion_owner_status_chk check (
    (status='waiting_client' and next_owner='client') or
    (status='waiting_dev' and next_owner='dev') or
    (status in ('open','resolved'))
  )
);

create table if not exists discussion_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  discussion_id uuid not null references discussion_items(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('owner','member','client')),
  body text not null,
  created_at timestamptz not null default now()
);

create or replace function auto_shift_ball_on_client_reply()
returns trigger language plpgsql as $$
begin
  if new.author_role = 'client' then
    update discussion_items
      set status = case when status='waiting_client' then 'waiting_dev' else status end,
          next_owner = case when next_owner='client' then 'dev' else next_owner end,
          updated_at = now()
    where id = new.discussion_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_auto_shift_ball_on_client_reply on discussion_comments;
create trigger trg_auto_shift_ball_on_client_reply
after insert on discussion_comments
for each row execute function auto_shift_ball_on_client_reply();

-- =============================================================================
-- 15) Onboarding Progress
-- =============================================================================

create table if not exists onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  steps jsonb not null default '{}'::jsonb,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- =============================================================================
-- 16) GitHub Integration
-- =============================================================================

create table if not exists github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, installation_id)
);

create table if not exists github_repositories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  repo_id bigint not null,
  owner_login text not null,
  repo_name text not null,
  default_branch text null,
  created_at timestamptz not null default now(),
  unique (org_id, repo_id)
);

create table if not exists space_github_repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  repo_id bigint not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (space_id, repo_id)
);

create table if not exists github_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  repo_id bigint null,
  event_type text not null,
  delivery_id text null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create unique index if not exists github_webhook_events_delivery_unique
on github_webhook_events(delivery_id)
where delivery_id is not null;

create table if not exists github_pull_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  repo_id bigint not null,
  pr_number int not null,
  pr_title text not null,
  pr_url text not null,
  state text not null,
  merged_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (org_id, repo_id, pr_number)
);

create table if not exists task_github_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  repo_id bigint not null,
  pr_number int not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (task_id, repo_id, pr_number)
);

-- =============================================================================
-- 17) Views (Client Surface)
-- =============================================================================

create or replace view v_client_milestones as
select mp.org_id, m.space_id, m.id as milestone_id, m.name, m.due_date, mp.published_at
from milestone_publications mp
join milestones m on m.id = mp.milestone_id
where mp.is_published = true;

create or replace view v_client_discussion_items as
select d.org_id, d.space_id, d.milestone_id, d.id as discussion_id, d.title, d.body, d.status, d.next_owner,
       (d.linked_task_id is not null) as is_tasked, d.updated_at
from discussion_items d
join milestone_publications mp on mp.milestone_id = d.milestone_id
where mp.is_published = true and d.is_client_visible = true;

create or replace view v_client_tasks as
select tp.org_id, t.space_id, tp.milestone_id, t.id as task_id, t.short_id, t.title, t.status, t.priority,
       t.due_date, t.start_date, t.end_date, t.ball, t.origin
from task_publications tp
join tasks t on t.id = tp.task_id;

create or replace view v_client_wiki as
select w.org_id, w.milestone_id, w.id as publication_id, w.published_title, w.published_body, w.published_at
from wiki_page_publications w
join milestone_publications mp on mp.milestone_id = w.milestone_id
where mp.is_published = true;
