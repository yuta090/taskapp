-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — 手順2 / channel_groups テナント源
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §2 / §3 / §6-2 / §7-2
--
-- 目的: 共有bot(platform account)配下のグループが「誰の org に属するか」を
--   作成時に確定し不変にする。channel_groups.org_id は NOT NULL のまま維持し
--   （★絶対に nullable にしない）、tenant_source で由来を型付ける。
--
-- 本ファイルの2本のトリガー（A-1 / A-2）は設計正本 §3 で「省略不可・最後の網」と
-- 明記された不変条件。service role は RLS を迂回するため、ここが実境界になる。
--
-- 加算のみ。既存 channel_groups 行は tenant_source default 'account_owner' に整合
-- （既存は全て owner_type='org' の専用bot配下＝account_owner）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 列追加（3列）。org_id は NOT NULL のまま（触らない）。
-- -----------------------------------------------------------------------------
alter table public.channel_groups
  add column if not exists tenant_source text not null default 'account_owner'
  check (tenant_source in ('account_owner', 'approved_link_code', 'code_only_link'));

alter table public.channel_groups
  add column if not exists bound_by_link_code_id uuid;

alter table public.channel_groups
  add column if not exists supersedes_group_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'channel_groups_bound_by_link_code_fk'
                   and conrelid = 'public.channel_groups'::regclass) then
    alter table public.channel_groups
      add constraint channel_groups_bound_by_link_code_fk
      foreign key (bound_by_link_code_id) references public.channel_link_codes(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'channel_groups_supersedes_fk'
                   and conrelid = 'public.channel_groups'::regclass) then
    alter table public.channel_groups
      add constraint channel_groups_supersedes_fk
      foreign key (supersedes_group_id) references public.channel_groups(id) on delete set null;
  end if;
end $$;

create index if not exists channel_groups_bound_by_link_code
  on public.channel_groups(bound_by_link_code_id) where bound_by_link_code_id is not null;

comment on column public.channel_groups.tenant_source is
  'account_owner=専用bot(owner_type=org)配下・org=account.org / approved_link_code=共有botのWeb承認紐付け / code_only_link=共有botのcode_only即時紐付け。作成時確定・不変（A-1/A-2で強制）';
comment on column public.channel_groups.bound_by_link_code_id is
  '共有bot紐付けの根拠コード（approved_link_code / code_only_link のみ NOT NULL）。監査系譜: link_codes.consumed_at ↔ ここ で完結';
comment on column public.channel_groups.supersedes_group_id is
  '共有→専用アップグレード時の旧世代への監査参照（account_id 付替えは禁止・世代方式）';

-- -----------------------------------------------------------------------------
-- 2) A-1（必須）: BEFORE INSERT 整合トリガー
--    account.owner_type を引き、テナント源と帰属列の整合を作成時に強制する。
--    未改修パスがここで fail-closed に落ちる（設計正本 §1 帰属導出の絶対規約）。
-- -----------------------------------------------------------------------------
create or replace function public.channel_groups_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_type text;
  v_account_org uuid;
  v_lc record;
  v_expected_binding_mode text;
begin
  select owner_type, org_id into v_owner_type, v_account_org
  from public.channel_accounts
  where id = new.account_id;

  if v_owner_type is null then
    raise exception 'channel_groups: unknown account_id % (account not found)', new.account_id;
  end if;

  if v_owner_type = 'org' then
    -- 専用bot: 従来経路。tenant_source は account_owner 固定・org は account に一致。
    if new.tenant_source is distinct from 'account_owner' then
      raise exception 'channel_groups: owner_type=org requires tenant_source=account_owner (got %)', new.tenant_source;
    end if;
    if new.org_id is distinct from v_account_org then
      raise exception 'channel_groups: org_id (%) must equal owner account org (%)', new.org_id, v_account_org;
    end if;
  elsif v_owner_type = 'platform' then
    -- 共有bot: 紐付けは承認RPCファミリのみ。作成時点で帰属列が全て確定していること。
    if new.tenant_source not in ('approved_link_code', 'code_only_link') then
      raise exception 'channel_groups: owner_type=platform requires tenant_source in (approved_link_code, code_only_link) (got %)', new.tenant_source;
    end if;
    if new.org_id is null then
      raise exception 'channel_groups: platform group requires org_id (NOT NULL) at creation';
    end if;
    if new.space_id is null then
      raise exception 'channel_groups: platform group requires space_id (NOT NULL) at creation';
    end if;
    if new.bound_by_link_code_id is null then
      raise exception 'channel_groups: platform group requires bound_by_link_code_id (NOT NULL) at creation';
    end if;

    -- ★構造的な網（RPC の正しさに依存しない最後の網）:
    --   bound_by_link_code_id が指すコードと org/space/account が一致するかを引いて強制する。
    --   どの service-role 経路（web_approval / code_only=PR3）が INSERT しても
    --   group.org == code.org を構造的に保証する（設計正本 §3/§7-8）。
    select purpose, binding_mode, target_account_id, org_id, space_id
      into v_lc
    from public.channel_link_codes
    where id = new.bound_by_link_code_id;

    if v_lc.purpose is null then
      raise exception 'channel_groups: bound_by_link_code_id % not found', new.bound_by_link_code_id;
    end if;
    if v_lc.purpose is distinct from 'shared_group_claim' then
      raise exception 'channel_groups: bound link_code purpose must be shared_group_claim (got %)', v_lc.purpose;
    end if;
    if v_lc.target_account_id is distinct from new.account_id then
      raise exception 'channel_groups: bound link_code target_account_id does not match group account_id';
    end if;
    if v_lc.org_id is distinct from new.org_id then
      raise exception 'channel_groups: group org_id (%) must equal bound link_code org_id (%)', new.org_id, v_lc.org_id;
    end if;
    if v_lc.space_id is distinct from new.space_id then
      raise exception 'channel_groups: group space_id (%) must equal bound link_code space_id (%)', new.space_id, v_lc.space_id;
    end if;
    -- tenant_source と code の binding_mode の対応を強制。
    v_expected_binding_mode := case new.tenant_source
                                 when 'approved_link_code' then 'web_approval'
                                 when 'code_only_link' then 'code_only'
                               end;
    if v_lc.binding_mode is distinct from v_expected_binding_mode then
      raise exception 'channel_groups: tenant_source % requires bound link_code binding_mode % (got %)',
        new.tenant_source, v_expected_binding_mode, v_lc.binding_mode;
    end if;
  else
    raise exception 'channel_groups: unexpected account owner_type %', v_owner_type;
  end if;

  return new;
end;
$$;

revoke all on function public.channel_groups_tenant_integrity() from public, anon, authenticated;

drop trigger if exists trg_channel_groups_tenant_integrity on public.channel_groups;
create trigger trg_channel_groups_tenant_integrity
  before insert on public.channel_groups
  for each row execute function public.channel_groups_tenant_integrity();

-- -----------------------------------------------------------------------------
-- 3) A-2（必須）: guardトリガーの不変列拡張
--    ベース = 20260711073329 の channel_groups_guard_update()（space_id 一方向のみ）。
--    それを土台に、作成時確定の帰属/由来列を完全 immutable に加える。
--    ★過去に後発ファイルがロジックを脱落させた実害があるため、必ず最新定義を土台にする。
-- -----------------------------------------------------------------------------
create or replace function public.channel_groups_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- space_id は NULL→値 の一方向のみ（誤紐付けの是正は unlink→再リンクで新世代）。
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'channel_groups: space_id can only be set once (unlink + re-link for a new generation instead)';
  end if;

  -- 帰属/由来の確定列は完全 immutable（作成時にのみ確定する）。
  if new.org_id is distinct from old.org_id
     or new.account_id is distinct from old.account_id
     or new.external_group_id is distinct from old.external_group_id
     or new.tenant_source is distinct from old.tenant_source
     or new.bound_by_link_code_id is distinct from old.bound_by_link_code_id
     or new.supersedes_group_id is distinct from old.supersedes_group_id then
    raise exception 'channel_groups: immutable column (org_id/account_id/external_group_id/tenant_source/bound_by_link_code_id/supersedes_group_id) cannot be changed';
  end if;

  return new;
end;
$$;
-- トリガー trg_channel_groups_guard は 20260711073329 で作成済み（BEFORE UPDATE）。
-- 関数を create or replace するのみで再バインド不要。

-- =============================================================================
-- 検証（適用後に service role で実施。設計正本 §8 (a)(b)(c)）:
--   (a) platform account + tenant_source='account_owner' の INSERT がトリガー拒否
--   (b) org account + tenant_source='approved_link_code' 拒否 / org_id≠account.org_id 拒否
--   (c) org_id / account_id / external_group_id / tenant_source / bound_by_link_code_id /
--       supersedes_group_id の UPDATE が拒否される
--   + platform で space_id / bound_by_link_code_id が NULL の INSERT が拒否される
--   + 構造網: platform の bound_by_link_code_id が指すコードと org/space/account/purpose/
--     binding_mode が不一致の INSERT が拒否される（RPC の正しさに依存しない最後の網）。
--     どの service-role 経路（web_approval / code_only=PR3）でも group.org==code.org を強制。
--   + 既存 account_owner 行の再UPDATE（例: last_extracted_message_created_at）が通ること
--   + 既存の org 専用bot経路が無変更で通ること（tenant_source 未指定→default account_owner）
-- ロールバック:
--   drop trigger trg_channel_groups_tenant_integrity on public.channel_groups;
--   drop function public.channel_groups_tenant_integrity();
--   -- guard 関数を space_id 一方向のみ（20260711073329 版）に戻す:
--   （20260711073329 の channel_groups_guard_update() 定義を create or replace で再適用）
--   alter table public.channel_groups
--     drop constraint channel_groups_bound_by_link_code_fk,
--     drop constraint channel_groups_supersedes_fk;
--   drop index channel_groups_bound_by_link_code;
--   alter table public.channel_groups
--     drop column supersedes_group_id, drop column bound_by_link_code_id, drop column tenant_source;
-- =============================================================================
