-- =============================================================================
-- shared_bot_access backfill 検証セットアップ: 092426(org_channel_policy) 適用後・
-- 20260720223422 適用前に流す。共有bot利用の痕跡を持つ org と、持たない org を用意する。
-- =============================================================================
set client_min_messages = warning;

-- platform 共有bot account P1（org_id=NULL）。
insert into public.channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f1', null, 'platform', 'line', 'agentpm秘書', 'enc');

-- orgs
insert into public.organizations values ('00000000-0000-0000-0000-00000000a001'); -- active group on P1 → granted
insert into public.organizations values ('00000000-0000-0000-0000-00000000a002'); -- 'left' group on P1 → granted(過去利用)
insert into public.organizations values ('00000000-0000-0000-0000-00000000c000'); -- allow_code_only → granted
insert into public.organizations values ('00000000-0000-0000-0000-00000000d001'); -- 痕跡なし → none
insert into public.organizations values ('00000000-0000-0000-0000-00000000e001'); -- 自社account保有・platform痕跡なし → none(backfill)

-- own(org)account（own1 用・backfill 対象外の確認）
insert into public.channel_accounts(id, org_id, owner_type, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000e001', 'org', 'line', '山田会計', 'enc');

-- 痕跡: P1 に紐づく channel_groups（g1=active / g2=left）。space_id は NULL（初期状態）。
-- platform group は space_id NOT NULL（整合トリガー）。spaces を用意する。
insert into public.spaces(id, org_id, name) values
  ('00000000-0000-0000-0000-00000000501a', '00000000-0000-0000-0000-00000000a001', 'space-a1'),
  ('00000000-0000-0000-0000-00000000502a', '00000000-0000-0000-0000-00000000a002', 'space-a2');

-- platform group の作成整合トリガー(bound_by_link_code_id 等)はこのテストの対象外（backfill の
-- SELECT が platform group を持つ org を拾うかだけを見る）。replica モードで作成トリガー/FKを一時無効化して
-- 「既に存在する platform group 行」を再現する。
set session_replication_role = replica;
insert into public.channel_groups(org_id, account_id, channel, external_group_id, status, tenant_source, space_id) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f1', 'line', 'G1group', 'active', 'approved_link_code', '00000000-0000-0000-0000-00000000501a'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000f1', 'line', 'G2group', 'left', 'approved_link_code', '00000000-0000-0000-0000-00000000502a');
set session_replication_role = origin;

-- 痕跡: allow_code_only=true の org（policy行が先に存在するケース）。
insert into public.org_channel_policy(org_id, allow_code_only) values
  ('00000000-0000-0000-0000-00000000c000', true);
