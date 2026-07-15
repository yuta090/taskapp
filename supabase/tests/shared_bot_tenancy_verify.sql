-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 の DB制約/トリガー/RPC/RLS 検証
-- 対象migration: 20260715092422〜20260715092426
-- 設計正本 §8: (a)(b)(c)(e)(f)(g) を完全に、(k) policy既定、(l) consumed_at一方向、
--   + C1（claim.org≠code.org 承認拒否）・A-1構造網（bound code org≠group.org 拒否）・
--   + V1 RLS越境読取0行 を担保する。スクラッチDB・使い捨て（本番へ適用しない）。
--
-- 実行例:
--   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/shared_bot_tenancy_verify.sql
-- =============================================================================
set client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- アサートヘルパ
-- -----------------------------------------------------------------------------
create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end $$;

-- V2: 与えた SQL が「境界由来の」例外を投げることを検証する。
--   別の理由（未定義列/構文エラー等）で失敗しても緑になる穴を塞ぐため、
--   期待する SQLSTATE クラス（P0001=raise exception / 23514=check / 23505=unique /
--   23503=fk / 23502=not null / 22P02=invalid text）のみを許容し、
--   expect が与えられればメッセージ部分一致も要求する。
create or replace function assert_raises(label text, p_sql text, expect text default null) returns void
language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state not in ('P0001','23514','23505','23503','23502','22P02') then
      raise exception 'FAIL[%]: raised unexpected error class % (%)', label, v_state, v_msg;
    end if;
    if expect is not null and position(lower(expect) in lower(v_msg)) = 0 then
      raise exception 'FAIL[%]: message "%" did not contain "%"', label, v_msg, expect;
    end if;
    raise notice 'PASS[%]: rejected [%] %', label, v_state, v_msg;
    return;
  end;
  raise exception 'FAIL[%]: expected an error but statement succeeded', label;
end $$;

-- -----------------------------------------------------------------------------
-- 最小スキーマ（本番同型の関連部分のみ）
-- -----------------------------------------------------------------------------
create table organizations (id uuid primary key);
create table spaces (id uuid primary key, org_id uuid not null, name text);
create unique index spaces_id_org_unique on spaces(id, org_id);
create table org_memberships (org_id uuid, user_id uuid, role text);

-- -----------------------------------------------------------------------------
-- auth.uid() スタブ・app_is_org_internal 正典・authenticated ロール（V1 RLS 用）
-- （org_memberships 作成後に定義: SQL関数は本文の参照先テーブルを作成時に検証するため）
-- -----------------------------------------------------------------------------
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- 20260703_001_rls_helpers.sql の app_is_org_internal 正典定義（SECURITY DEFINER）
create or replace function public.app_is_org_internal(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner','admin','member'));
$$;

do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;

-- channel_accounts（20260710204722 + 20260715092422 owner_type）
create table channel_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  owner_type text not null default 'org' check (owner_type in ('org','platform')),
  channel text not null default 'line',
  display_name text not null,
  credentials_encrypted text not null default 'x',
  status text not null default 'active',
  constraint channel_accounts_owner_org_consistency check ((owner_type='org') = (org_id is not null))
);

-- channel_link_codes（20260710204722 + 20260715092424）
create table channel_link_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,
  channel text not null default 'line',
  code text unique,
  purpose text not null default 'identity' check (purpose in ('identity','group_link','shared_group_claim')),
  binding_mode text check (binding_mode in ('web_approval','code_only')),
  target_account_id uuid references channel_accounts(id) on delete restrict,
  code_hash text,
  batch_id uuid,
  consumed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  first_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references spaces(id, org_id) on delete cascade
);

create or replace function channel_link_codes_guard_update() returns trigger language plpgsql as $$
begin
  if new.purpose is distinct from old.purpose
     or new.binding_mode is distinct from old.binding_mode
     or new.target_account_id is distinct from old.target_account_id
     or new.code_hash is distinct from old.code_hash
     or new.batch_id is distinct from old.batch_id
     or new.org_id is distinct from old.org_id
     or new.space_id is distinct from old.space_id then
    raise exception 'channel_link_codes: binding attributes are immutable once issued';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'channel_link_codes: consumed_at can only be set once';
  end if;
  return new;
end $$;
create trigger trg_channel_link_codes_guard before update on channel_link_codes
  for each row execute function channel_link_codes_guard_update();

-- channel_groups（20260711073329 + 20260713123924 + 20260715092423）
create table channel_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  space_id uuid,
  account_id uuid not null references channel_accounts(id) on delete restrict,
  channel text not null default 'line',
  external_group_id text not null,
  display_name text,
  status text not null default 'active' check (status in ('active','left')),
  pickup_mode text not null default 'all',
  tenant_source text not null default 'account_owner'
    check (tenant_source in ('account_owner','approved_link_code','code_only_link')),
  bound_by_link_code_id uuid references channel_link_codes(id) on delete restrict,
  supersedes_group_id uuid references channel_groups(id) on delete set null,
  last_extracted_message_created_at timestamptz,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references spaces(id, org_id) on delete restrict
);
create unique index channel_groups_active_unique on channel_groups(account_id, external_group_id) where status='active';
create unique index channel_groups_id_org_unique on channel_groups(id, org_id);

-- A-1 整合トリガー（構造網強化版: bound code の org/space/account を突合）
create or replace function channel_groups_tenant_integrity() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_owner_type text; v_account_org uuid; v_lc record; v_expected_binding_mode text;
begin
  select owner_type, org_id into v_owner_type, v_account_org from channel_accounts where id=new.account_id;
  if v_owner_type is null then raise exception 'unknown account_id %', new.account_id; end if;
  if v_owner_type='org' then
    if new.tenant_source is distinct from 'account_owner' then raise exception 'org requires account_owner'; end if;
    if new.org_id is distinct from v_account_org then raise exception 'org_id must equal owner account org'; end if;
  elsif v_owner_type='platform' then
    if new.tenant_source not in ('approved_link_code','code_only_link') then raise exception 'platform requires link source'; end if;
    if new.org_id is null then raise exception 'platform requires org_id'; end if;
    if new.space_id is null then raise exception 'platform requires space_id'; end if;
    if new.bound_by_link_code_id is null then raise exception 'platform requires bound_by_link_code_id'; end if;
    select purpose, binding_mode, target_account_id, org_id, space_id into v_lc
      from channel_link_codes where id=new.bound_by_link_code_id;
    if v_lc.purpose is null then raise exception 'bound link_code % not found', new.bound_by_link_code_id; end if;
    if v_lc.purpose is distinct from 'shared_group_claim' then raise exception 'bound purpose must be shared_group_claim'; end if;
    if v_lc.target_account_id is distinct from new.account_id then raise exception 'bound target_account_id mismatch'; end if;
    if v_lc.org_id is distinct from new.org_id then raise exception 'group org_id must equal bound link_code org_id'; end if;
    if v_lc.space_id is distinct from new.space_id then raise exception 'group space_id must equal bound link_code space_id'; end if;
    v_expected_binding_mode := case new.tenant_source
      when 'approved_link_code' then 'web_approval' when 'code_only_link' then 'code_only' end;
    if v_lc.binding_mode is distinct from v_expected_binding_mode then raise exception 'tenant_source/binding_mode mismatch'; end if;
  else raise exception 'unexpected owner_type %', v_owner_type; end if;
  return new;
end $$;
create trigger trg_channel_groups_tenant_integrity before insert on channel_groups
  for each row execute function channel_groups_tenant_integrity();

-- A-2 guard（不変列拡張）
create or replace function channel_groups_guard_update() returns trigger language plpgsql as $$
begin
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'space_id can only be set once';
  end if;
  if new.org_id is distinct from old.org_id
     or new.account_id is distinct from old.account_id
     or new.external_group_id is distinct from old.external_group_id
     or new.tenant_source is distinct from old.tenant_source
     or new.bound_by_link_code_id is distinct from old.bound_by_link_code_id
     or new.supersedes_group_id is distinct from old.supersedes_group_id then
    raise exception 'channel_groups: immutable column cannot be changed';
  end if;
  return new;
end $$;
create trigger trg_channel_groups_guard before update on channel_groups
  for each row execute function channel_groups_guard_update();

-- channel_group_claims + RPC（20260715092425・C1修正版: code を真実源に・統一台帳 enum）
create table channel_group_claims (
  id uuid primary key default gen_random_uuid(),
  link_code_id uuid not null references channel_link_codes(id) on delete restrict,
  account_id uuid not null references channel_accounts(id) on delete restrict,
  external_group_id text not null,
  org_id uuid not null,
  space_id uuid not null,
  challenge_label text,
  group_display_name_snapshot text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','auto_approved')),
  approved_by uuid, approved_at timestamptz, rejected_at timestamptz,
  events_seen int not null default 0, last_event_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references spaces(id, org_id) on delete restrict,
  foreign key (org_id) references organizations(id) on delete restrict
);
create unique index channel_group_claims_pending_unique
  on channel_group_claims(link_code_id, account_id, external_group_id) where status='pending';

create or replace function rpc_approve_group_claim(p_claim_id uuid, p_approver_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_link_code_id uuid; v_lc record; v_claim record;
begin
  select link_code_id into v_link_code_id from channel_group_claims where id=p_claim_id;
  if v_link_code_id is null then raise exception 'unknown claim %', p_claim_id; end if;
  select id,purpose,binding_mode,target_account_id,consumed_at,expires_at,org_id,space_id into v_lc
    from channel_link_codes where id=v_link_code_id for update;
  select id,link_code_id,account_id,external_group_id,org_id,space_id,group_display_name_snapshot,status
    into v_claim from channel_group_claims where id=p_claim_id for update;
  if v_claim.status is distinct from 'pending' then raise exception 'not pending'; end if;
  if v_lc.purpose is distinct from 'shared_group_claim' then raise exception 'bad purpose'; end if;
  if v_lc.binding_mode is distinct from 'web_approval' then raise exception 'bad binding_mode'; end if;
  if v_lc.consumed_at is not null then raise exception 'consumed'; end if;
  if v_lc.expires_at <= now() then raise exception 'expired'; end if;
  if v_lc.target_account_id is distinct from v_claim.account_id then raise exception 'account mismatch'; end if;
  -- ★C1: claim と code の org/space 乖離を検出（code を単一の真実源に）
  if v_claim.org_id is distinct from v_lc.org_id or v_claim.space_id is distinct from v_lc.space_id then
    raise exception 'claim org/space (%/%) does not match link_code (%/%)', v_claim.org_id, v_claim.space_id, v_lc.org_id, v_lc.space_id;
  end if;
  -- membership は ★code.org（v_lc.org_id）に対して
  if not exists (select 1 from org_memberships m where m.org_id=v_lc.org_id
      and m.user_id=p_approver_user_id and m.role in ('owner','admin','member')) then
    raise exception 'approver not internal member'; end if;
  begin
    -- org/space は ★code 由来
    insert into channel_groups (org_id,space_id,account_id,channel,external_group_id,display_name,status,tenant_source,bound_by_link_code_id)
    values (v_lc.org_id,v_lc.space_id,v_claim.account_id,'line',v_claim.external_group_id,v_claim.group_display_name_snapshot,'active','approved_link_code',v_lc.id);
  exception when unique_violation then
    update channel_group_claims set status='rejected', rejected_at=now() where id=p_claim_id;
    return false;
  end;
  update channel_link_codes set consumed_at=now() where id=v_lc.id;
  update channel_group_claims set status='approved', approved_by=p_approver_user_id, approved_at=now() where id=p_claim_id;
  return true;
end $$;

-- org_channel_policy（20260715092426）
create table org_channel_policy (
  org_id uuid primary key references organizations(id) on delete cascade,
  allow_code_only boolean not null default false,
  granted_by uuid, granted_at timestamptz,
  monthly_push_quota int,
  on_exceed text not null default 'none' check (on_exceed in ('none','degrade','block')),
  state text not null default 'ok' check (state in ('ok','soft','hard')),
  updated_at timestamptz not null default now()
);

-- V1: 本番同型 RLS を2新テーブルに貼る（読取=内部メンバーのみ・force で owner も従わせる）
alter table channel_group_claims enable row level security;
alter table channel_group_claims force row level security;
alter table org_channel_policy enable row level security;
alter table org_channel_policy force row level security;
revoke all on channel_group_claims from anon, authenticated;
revoke all on org_channel_policy from anon, authenticated;
grant usage on schema public, auth to authenticated;
grant select on channel_group_claims to authenticated;
grant select on org_channel_policy to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.app_is_org_internal(uuid) to authenticated;
create policy channel_group_claims_select_internal on channel_group_claims
  for select to authenticated using (public.app_is_org_internal(org_id));
create policy org_channel_policy_select_internal on org_channel_policy
  for select to authenticated using (public.app_is_org_internal(org_id));

-- -----------------------------------------------------------------------------
-- テストデータ（全て superuser=postgres で投入＝force RLS でも bypass）
-- -----------------------------------------------------------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000a1');
insert into organizations values ('00000000-0000-0000-0000-0000000000a2');
insert into spaces values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','S1');
insert into spaces values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','S2');
-- c1=org a1 内部 / c2=org a2 内部 / c9=非メンバー
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','member');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c2','member');

-- platform account PA / org account OA
insert into channel_accounts(id, owner_type, org_id, display_name)
  values ('00000000-0000-0000-0000-0000000000f1','platform',null,'agentpm秘書');
insert into channel_accounts(id, owner_type, org_id, display_name)
  values ('00000000-0000-0000-0000-0000000000f2','org','00000000-0000-0000-0000-0000000000a1','山田会計の秘書');

-- link codes: lc1=正常(a1), lc2=失効(a1), lc3=消費済(a1), lc4=正常(a1・2つ目claim用), lc5=正常(a2)
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,expires_at)
  values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,expires_at)
  values ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()-interval '1 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,expires_at,consumed_at)
  values ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()+interval '20 min', now()-interval '5 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,expires_at)
  values ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,expires_at)
  values ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()+interval '20 min');

-- org a1 の policy 明示行（既定値の確認 + V1 用）
insert into org_channel_policy(org_id) values ('00000000-0000-0000-0000-0000000000a1');

-- =============================================================================
-- 境界検証
-- =============================================================================

-- (a) platform account + tenant_source='account_owner' の INSERT が拒否される
select assert_raises('a_platform_account_owner_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','GA','account_owner','00000000-0000-0000-0000-000000000101')
$q$, 'link source');

-- (a') platform で space_id/bound_by_link_code_id が NULL の INSERT が拒否される
select assert_raises('a_platform_missing_space_rejected', $q$
  insert into channel_groups(org_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1','GA2','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'space_id');

-- (b) org account + 'approved_link_code' が拒否される
select assert_raises('b_org_account_approved_link_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f2','GB','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'account_owner');

-- (b') org account で org_id ≠ account.org_id が拒否される
select assert_raises('b_org_id_mismatch_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source)
  values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f2','GB2','account_owner')
$q$, 'owner account org');

-- 正常系: org account の account_owner INSERT が通る（既存専用bot経路の無変更＝回帰ゲート）
insert into channel_groups(id,org_id,account_id,external_group_id)
  values ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f2','GOK');
select assert_eq('org_account_owner_insert_ok', (select tenant_source from channel_groups where id='00000000-0000-0000-0000-000000000201'), 'account_owner');

-- (c) 越境列 org_id/account_id/external_group_id/tenant_source/supersedes の UPDATE 拒否
select assert_raises('c_update_org_id_rejected', $q$
  update channel_groups set org_id='00000000-0000-0000-0000-0000000000a2' where id='00000000-0000-0000-0000-000000000201'
$q$, 'immutable');
select assert_raises('c_update_account_id_rejected', $q$
  update channel_groups set account_id='00000000-0000-0000-0000-0000000000f1' where id='00000000-0000-0000-0000-000000000201'
$q$, 'immutable');
select assert_raises('c_update_external_group_id_rejected', $q$
  update channel_groups set external_group_id='CHANGED' where id='00000000-0000-0000-0000-000000000201'
$q$, 'immutable');
select assert_raises('c_update_tenant_source_rejected', $q$
  update channel_groups set tenant_source='code_only_link' where id='00000000-0000-0000-0000-000000000201'
$q$, 'immutable');
select assert_raises('c_update_supersedes_rejected', $q$
  update channel_groups set supersedes_group_id='00000000-0000-0000-0000-000000000201' where id='00000000-0000-0000-0000-000000000201'
$q$, 'immutable');
-- 可変列（last_extracted...）の UPDATE は通る
update channel_groups set last_extracted_message_created_at=now() where id='00000000-0000-0000-0000-000000000201';
select assert_eq('mutable_update_ok', (select (last_extracted_message_created_at is not null) from channel_groups where id='00000000-0000-0000-0000-000000000201'), true);

-- claim を用意（正常/失効/消費）
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id,group_display_name_snapshot)
  values ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000f1','GX','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','酒屋グループ');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000000f1','GY','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000000f1','GZ','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
-- org a2 の pending claim（V1 越境読取検証用）
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GA2C','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');

-- (e) 他org(a2)の member(c2) が a1 の claim を承認 → 越境で拒否（membership は code.org=a1 に対して）
select assert_raises('e_cross_org_member_approve_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c2')
$q$, 'not internal member');
-- (e') 非メンバー(c9)の承認も拒否
select assert_raises('e_outsider_approve_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c9')
$q$, 'not internal member');

-- (f) 失効コードの承認が拒否される
select assert_raises('f_expired_code_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-0000000000c1')
$q$, 'expired');
-- (f') 消費済コードの承認が拒否される
select assert_raises('f_consumed_code_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-0000000000c1')
$q$, 'consumed');

-- C1回帰: claim.org ≠ code.org の承認が新 raise で拒否される
--   claim306 = code lc1(org a1) だが claim.org=a2/space=b2 に細工。
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000f1','GMIX','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');
select assert_raises('c1_claim_org_ne_code_org_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-0000000000c1')
$q$, 'does not match link_code');

-- A-1構造網回帰: bound code の org ≠ group.org の直接 INSERT が拒否される
--   bound=lc1(org a1) だが group.org=a2/space=b2 に細工（RPCを介さない攻撃経路）。
select assert_raises('a1_bound_code_org_mismatch_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f1','GA1REG','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'bound link_code org_id');

-- 正常承認: claim301 が approved になり channel_groups が1行できる（org/space は code 由来）
select assert_eq('approve_ok_true', rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c1'), true);
select assert_eq('approve_created_group', (select count(*)::int from channel_groups where tenant_source='approved_link_code' and external_group_id='GX'), 1);
select assert_eq('approve_group_org_from_code', (select org_id from channel_groups where external_group_id='GX' and status='active'), '00000000-0000-0000-0000-0000000000a1'::uuid);
select assert_eq('approve_consumed_code', (select (consumed_at is not null) from channel_link_codes where id='00000000-0000-0000-0000-000000000101'), true);
select assert_eq('approve_claim_status', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000301'), 'approved');

-- (g) 同一グループへの2つ目claim承認 → active_unique 23505 を graceful に false・claim は rejected
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-0000000000f1','GX','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
select assert_eq('g_second_claim_false', rpc_approve_group_claim('00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-0000000000c1'), false);
select assert_eq('g_second_claim_rejected', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000304'), 'rejected');
select assert_eq('g_loser_code_not_consumed', (select (consumed_at is null) from channel_link_codes where id='00000000-0000-0000-0000-000000000104'), true);

-- (enum) 統一台帳の auto_approved を書けること（PR3 の code_only 償還が使う。pending 非経由）
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id,status)
  values ('00000000-0000-0000-0000-000000000307','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GAUTO','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','auto_approved');
select assert_eq('enum_auto_approved_accepted', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000307'), 'auto_approved');
select assert_raises('enum_unknown_status_rejected', $q$
  insert into channel_group_claims(link_code_id,account_id,external_group_id,org_id,space_id,status)
  values ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GBAD','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','bogus')
$q$);

-- (l/consumed_at) consumed_at を 値→NULL に戻す UPDATE が拒否される（単回成功の巻き戻し禁止）
select assert_raises('l_consumed_at_one_way', $q$
  update channel_link_codes set consumed_at=null where id='00000000-0000-0000-0000-000000000101'
$q$, 'consumed_at');
-- binding_mode / org_id の改変が拒否される（焼き込み不変・org は load-bearing）
select assert_raises('binding_mode_immutable', $q$
  update channel_link_codes set binding_mode='code_only' where id='00000000-0000-0000-0000-000000000104'
$q$, 'immutable');
select assert_raises('link_code_org_immutable', $q$
  update channel_link_codes set org_id='00000000-0000-0000-0000-0000000000a2' where id='00000000-0000-0000-0000-000000000104'
$q$, 'immutable');

-- (k) org_channel_policy の既定（明示行を入れても既定 false / ok）
select assert_eq('k_policy_default_false', (select allow_code_only from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), false);
select assert_eq('k_policy_default_state_ok', (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), 'ok');

-- =============================================================================
-- V1: RLS 越境読取が 0行（設計正本 §8 見出し不変条件）
--   authenticated ロール＋auth.uid 切替で、自org のみ見え・他org は 0行。
-- =============================================================================
set role authenticated;

-- c1 = org a1 内部メンバー: a1 の claim 全件（301,302,303,304 = 4件・a2 の 305/306/307 は不可視）
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select assert_eq('v1_claims_a1_self', (select count(*)::int from channel_group_claims), 4);
select assert_eq('v1_claims_a1_no_cross', (select count(*)::int from channel_group_claims where org_id='00000000-0000-0000-0000-0000000000a2'), 0);
select assert_eq('v1_policy_a1_self', (select count(*)::int from org_channel_policy), 1);

-- c2 = org a2 内部メンバー: a2 の claim（305,306,307 = 3件）・policy は a2 明示行なしで 0件
set test.uid = '00000000-0000-0000-0000-0000000000c2';
select assert_eq('v1_claims_a2_self', (select count(*)::int from channel_group_claims), 3);
select assert_eq('v1_claims_a2_no_cross', (select count(*)::int from channel_group_claims where org_id='00000000-0000-0000-0000-0000000000a1'), 0);
select assert_eq('v1_policy_a2_none', (select count(*)::int from org_channel_policy), 0);

-- c9 = 非メンバー: 何も見えない
set test.uid = '00000000-0000-0000-0000-0000000000c9';
select assert_eq('v1_claims_outsider_zero', (select count(*)::int from channel_group_claims), 0);
select assert_eq('v1_policy_outsider_zero', (select count(*)::int from org_channel_policy), 0);

reset role;

select 'ALL CHECKS PASSED' as result;
-- =============================================================================
-- 対応表（設計正本 §8 + レビュー指摘 + Fable統一台帳 enum）:
--   (a) a_platform_account_owner_rejected / a_platform_missing_space_rejected
--   (b) b_org_account_approved_link_rejected / b_org_id_mismatch_rejected
--   (c) c_update_{org_id,account_id,external_group_id,tenant_source,supersedes}_rejected
--   (e) e_cross_org_member_approve_rejected / e_outsider_approve_rejected
--   (f) f_expired_code_rejected / f_consumed_code_rejected
--   (g) g_second_claim_false / g_second_claim_rejected / g_loser_code_not_consumed
--   (k) k_policy_default_false / k_policy_default_state_ok（発行API拒否は PR3）
--   (l) l_consumed_at_one_way / link_code_org_immutable（code_only 2グループ目拒否の土台）
--   C1: c1_claim_org_ne_code_org_rejected（承認RPCが code を真実源に）
--   A-1網: a1_bound_code_org_mismatch_rejected（RPC非依存の構造網）
--   enum: enum_auto_approved_accepted / enum_unknown_status_rejected（統一台帳・PR3 の code_only 用）
--   V1: v1_claims_*_self / v1_claims_*_no_cross / v1_policy_* / v1_*_outsider_zero
--   回帰: org_account_owner_insert_ok / mutable_update_ok（既存専用bot経路 無変更）
-- =============================================================================
