-- =============================================================================
-- Scheduling Proposals
-- 日程調整: 候補日提案 → 回答 → 確定 → 会議作成
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) scheduling_proposals — 日程調整提案
-- -----------------------------------------------------------------------------
create table if not exists scheduling_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  title text not null,
  description text null,
  duration_minutes integer not null default 60,
  status text not null default 'open'
    check (status in ('open', 'confirmed', 'cancelled', 'expired')),
  version integer not null default 1,
  confirmed_slot_id uuid null,
  confirmed_meeting_id uuid null references meetings(id),
  confirmed_at timestamptz null,
  confirmed_by uuid null references auth.users(id),
  -- Phase 3: ビデオ会議連携
  video_provider text null check (video_provider is null or video_provider in ('zoom', 'google_meet', 'teams')),
  meeting_url text null,
  external_meeting_id text null,
  -- 有効期限
  expires_at timestamptz null,
  -- 監査
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduling_proposals_space_idx
  on scheduling_proposals(space_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- 2) proposal_slots — 候補日時スロット
-- -----------------------------------------------------------------------------
create table if not exists proposal_slots (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references scheduling_proposals(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  slot_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create unique index if not exists proposal_slots_order_unique
  on proposal_slots(proposal_id, slot_order);

create index if not exists proposal_slots_proposal_idx
  on proposal_slots(proposal_id, start_at);

-- confirmed_slot_id FK (proposal_slotsテーブル作成後)
alter table scheduling_proposals
  add constraint fk_confirmed_slot
  foreign key (confirmed_slot_id) references proposal_slots(id);

-- -----------------------------------------------------------------------------
-- 3) proposal_respondents — 回答対象者
-- -----------------------------------------------------------------------------
create table if not exists proposal_respondents (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references scheduling_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  side text not null check (side in ('client', 'internal')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (proposal_id, user_id)
);

create index if not exists proposal_respondents_proposal_idx
  on proposal_respondents(proposal_id);

create index if not exists proposal_respondents_user_idx
  on proposal_respondents(user_id, proposal_id);

-- -----------------------------------------------------------------------------
-- 4) slot_responses — スロット回答
-- respondent_id を使い、招待された人のみ回答可能を構造的に保証
-- -----------------------------------------------------------------------------
create table if not exists slot_responses (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references proposal_slots(id) on delete cascade,
  respondent_id uuid not null references proposal_respondents(id) on delete cascade,
  response text not null
    check (response in ('available', 'unavailable_but_proceed', 'unavailable')),
  responded_at timestamptz not null default now(),
  unique (slot_id, respondent_id)
);

create index if not exists slot_responses_slot_idx
  on slot_responses(slot_id);

create index if not exists slot_responses_respondent_idx
  on slot_responses(respondent_id);

-- =============================================================================
-- 5) RLS ポリシー
-- =============================================================================

-- scheduling_proposals
alter table scheduling_proposals enable row level security;

create policy "space members can view proposals"
  on scheduling_proposals for select
  using (space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
  ));

create policy "internal members can create proposals"
  on scheduling_proposals for insert
  with check (
    created_by = auth.uid()
    and space_id in (
      select sm.space_id from space_memberships sm
      where sm.user_id = auth.uid() and sm.role in ('admin', 'editor', 'member')
    )
  );

create policy "creator or admin can update proposals"
  on scheduling_proposals for update
  using (
    created_by = auth.uid()
    or space_id in (
      select sm.space_id from space_memberships sm
      where sm.user_id = auth.uid() and sm.role = 'admin'
    )
  );

-- proposal_slots
alter table proposal_slots enable row level security;

create policy "space members can view proposal slots"
  on proposal_slots for select
  using (proposal_id in (
    select sp.id from scheduling_proposals sp
    where sp.space_id in (
      select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
    )
  ));

create policy "proposal creator can insert slots"
  on proposal_slots for insert
  with check (proposal_id in (
    select sp.id from scheduling_proposals sp where sp.created_by = auth.uid()
  ));

-- proposal_respondents
alter table proposal_respondents enable row level security;

create policy "space members can view respondents"
  on proposal_respondents for select
  using (proposal_id in (
    select sp.id from scheduling_proposals sp
    where sp.space_id in (
      select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
    )
  ));

create policy "proposal creator can insert respondents"
  on proposal_respondents for insert
  with check (proposal_id in (
    select sp.id from scheduling_proposals sp where sp.created_by = auth.uid()
  ));

-- slot_responses
alter table slot_responses enable row level security;

create policy "space members can view slot responses"
  on slot_responses for select
  using (slot_id in (
    select ps.id from proposal_slots ps
    join scheduling_proposals sp on ps.proposal_id = sp.id
    where sp.space_id in (
      select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
    )
  ));

create policy "respondents can insert own responses"
  on slot_responses for insert
  with check (respondent_id in (
    select pr.id from proposal_respondents pr where pr.user_id = auth.uid()
  ));

create policy "respondents can update own responses"
  on slot_responses for update
  using (respondent_id in (
    select pr.id from proposal_respondents pr where pr.user_id = auth.uid()
  ));

-- =============================================================================
-- 6) Updated_at trigger
-- =============================================================================

create or replace function update_scheduling_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger scheduling_proposals_updated_at
  before update on scheduling_proposals
  for each row execute function update_scheduling_updated_at();

-- =============================================================================
-- 7) RPC: rpc_confirm_proposal_slot
-- 確定ロジック: 全required respondentが available or unavailable_but_proceed
-- → meeting作成 → participants コピー → proposal status更新
-- =============================================================================

create or replace function rpc_confirm_proposal_slot(
  p_proposal_id uuid,
  p_slot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal scheduling_proposals%rowtype;
  v_slot proposal_slots%rowtype;
  v_meeting_id uuid;
  v_required_count integer;
  v_eligible_count integer;
begin
  -- 1. 行ロック
  select * into v_proposal
  from scheduling_proposals
  where id = p_proposal_id
  for update;

  if v_proposal is null then
    return jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  end if;

  -- 2. ステータスガード
  if v_proposal.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'proposal_not_open', 'current_status', v_proposal.status);
  end if;

  -- 3. スロット確認
  select * into v_slot
  from proposal_slots
  where id = p_slot_id and proposal_id = p_proposal_id;

  if v_slot is null then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found');
  end if;

  -- 4. required respondent数
  select count(*) into v_required_count
  from proposal_respondents
  where proposal_id = p_proposal_id and is_required = true;

  -- 5. eligible回答数 (available or unavailable_but_proceed)
  select count(*) into v_eligible_count
  from slot_responses sr
  join proposal_respondents pr on sr.respondent_id = pr.id
  where sr.slot_id = p_slot_id
    and pr.is_required = true
    and sr.response in ('available', 'unavailable_but_proceed');

  if v_eligible_count < v_required_count then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_all_agreed',
      'required', v_required_count,
      'eligible', v_eligible_count
    );
  end if;

  -- 7. Meeting作成
  insert into meetings (org_id, space_id, title, held_at, status, created_by)
  values (
    v_proposal.org_id,
    v_proposal.space_id,
    v_proposal.title,
    v_slot.start_at,
    'planned',
    auth.uid()
  )
  returning id into v_meeting_id;

  -- 8. Participants コピー
  insert into meeting_participants (org_id, space_id, meeting_id, user_id, side, created_by)
  select
    v_proposal.org_id,
    v_proposal.space_id,
    v_meeting_id,
    pr.user_id,
    pr.side,
    auth.uid()
  from proposal_respondents pr
  where pr.proposal_id = p_proposal_id;

  -- 9. Proposal更新
  update scheduling_proposals
  set status = 'confirmed',
      confirmed_slot_id = p_slot_id,
      confirmed_meeting_id = v_meeting_id,
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      version = version + 1
  where id = p_proposal_id;

  -- 10. 結果返却
  return jsonb_build_object(
    'ok', true,
    'meeting_id', v_meeting_id,
    'slot_start', v_slot.start_at,
    'slot_end', v_slot.end_at
  );
end;
$$;
