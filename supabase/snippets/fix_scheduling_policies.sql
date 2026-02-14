-- scheduling テーブルのポリシー・制約を冪等に再適用

-- FK制約（既存ならスキップ）
alter table scheduling_proposals
  drop constraint if exists fk_confirmed_slot;
alter table scheduling_proposals
  add constraint fk_confirmed_slot
  foreign key (confirmed_slot_id) references proposal_slots(id);

-- RLS有効化
alter table scheduling_proposals enable row level security;
alter table proposal_slots enable row level security;
alter table proposal_respondents enable row level security;
alter table slot_responses enable row level security;

-- scheduling_proposals ポリシー
drop policy if exists "space members can view proposals" on scheduling_proposals;
create policy "space members can view proposals" on scheduling_proposals for select
  using (space_id in (select sm.space_id from space_memberships sm where sm.user_id = auth.uid()));

drop policy if exists "internal members can create proposals" on scheduling_proposals;
create policy "internal members can create proposals" on scheduling_proposals for insert
  with check (created_by = auth.uid() and space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid() and sm.role in ('admin', 'editor', 'member')
  ));

drop policy if exists "creator or admin can update proposals" on scheduling_proposals;
create policy "creator or admin can update proposals" on scheduling_proposals for update
  using (created_by = auth.uid() or space_id in (
    select sm.space_id from space_memberships sm where sm.user_id = auth.uid() and sm.role = 'admin'
  ));

-- proposal_slots ポリシー
drop policy if exists "space members can view proposal slots" on proposal_slots;
create policy "space members can view proposal slots" on proposal_slots for select
  using (proposal_id in (
    select sp.id from scheduling_proposals sp where sp.space_id in (
      select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
    )
  ));

drop policy if exists "proposal creator can insert slots" on proposal_slots;
create policy "proposal creator can insert slots" on proposal_slots for insert
  with check (proposal_id in (select sp.id from scheduling_proposals sp where sp.created_by = auth.uid()));

-- proposal_respondents ポリシー
drop policy if exists "space members can view respondents" on proposal_respondents;
create policy "space members can view respondents" on proposal_respondents for select
  using (proposal_id in (
    select sp.id from scheduling_proposals sp where sp.space_id in (
      select sm.space_id from space_memberships sm where sm.user_id = auth.uid()
    )
  ));

drop policy if exists "proposal creator can insert respondents" on proposal_respondents;
create policy "proposal creator can insert respondents" on proposal_respondents for insert
  with check (proposal_id in (select sp.id from scheduling_proposals sp where sp.created_by = auth.uid()));

-- slot_responses ポリシー
drop policy if exists "space members can view slot responses" on slot_responses;
create policy "space members can view slot responses" on slot_responses for select
  using (slot_id in (
    select ps.id from proposal_slots ps join scheduling_proposals sp on ps.proposal_id = sp.id
    where sp.space_id in (select sm.space_id from space_memberships sm where sm.user_id = auth.uid())
  ));

drop policy if exists "respondents can insert own responses" on slot_responses;
create policy "respondents can insert own responses" on slot_responses for insert
  with check (respondent_id in (select pr.id from proposal_respondents pr where pr.user_id = auth.uid()));

drop policy if exists "respondents can update own responses" on slot_responses;
create policy "respondents can update own responses" on slot_responses for update
  using (respondent_id in (select pr.id from proposal_respondents pr where pr.user_id = auth.uid()));

-- トリガー
create or replace function update_scheduling_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists scheduling_proposals_updated_at on scheduling_proposals;
create trigger scheduling_proposals_updated_at before update on scheduling_proposals
  for each row execute function update_scheduling_updated_at();
