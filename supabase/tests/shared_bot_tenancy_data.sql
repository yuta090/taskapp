-- =============================================================================
-- 共有bot テナンシー検証: データ投入＋単一セッション境界アサート
-- 前提: baseline_stubs.sql → 実 prior migration → 実 target migration(092422〜092426)
--   を verbatim 適用済みの使い捨てクラスタで実行する（スキーマは作らない）。
--   並行系(g)は本ファイルでは扱わず run_shared_bot_tenancy.sh が2接続で実行する。
--
-- 設計正本 §8 + 2ndレビュー修正(1-3)の回帰を担保:
--   (a)(b)(c)(e)(f) / C1 / A-1網 / fix1 accounts immutable / fix2 claim guard+insert整合 /
--   fix3 revoke拒否+reject対称 / shape CHECK / code_hash unique / (k) / V1 RLS。
-- =============================================================================
set client_min_messages = notice;  -- 各 PASS を可視化（assert は raise notice で報告）

-- -----------------------------------------------------------------------------
-- アサートヘルパ（テスト専用）
-- -----------------------------------------------------------------------------
create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end $$;

-- 境界由来の例外のみ許容（別理由での失敗で緑になる穴を塞ぐ）。expect でメッセージ部分一致も要求可。
create or replace function assert_raises(label text, p_sql text, expect text default null) returns void
language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    -- GC404/GC403/GC409/GC422 は claim RPC ファミリの errcode 標準化(L3・20260716111033)。
    -- L3 適用前は同じ検証が P0001 で飛ぶため、両方を許容して 111033 の前後どちらでも緑にする。
    if v_state not in ('P0001','23514','23505','23503','23502','22P02',
                       'GC404','GC403','GC409','GC422') then
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
-- テストデータ（全て superuser=postgres＝RLS bypass。channel_* は実 migration のスキーマ）
-- -----------------------------------------------------------------------------
insert into organizations values ('00000000-0000-0000-0000-0000000000a1');
insert into organizations values ('00000000-0000-0000-0000-0000000000a2');
insert into spaces values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','S1');
insert into spaces values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','S2');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','member');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c2','member');

-- platform account PA(f1) / org account OA(f2, a1)
insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f1','platform',null,'line','agentpm秘書','x');
insert into channel_accounts(id, owner_type, org_id, channel, display_name, credentials_encrypted)
  values ('00000000-0000-0000-0000-0000000000f2','org','00000000-0000-0000-0000-0000000000a1','line','山田会計の秘書','x');

-- shared_group_claim コード（shape CHECK: code_hash/binding_mode/target_account_id 必須・code=NULL）
--   lc1=正常(a1) lc2=失効(a1) lc3=消費済(a1) lc4=revoke済(a1) lc5=正常(a2)
--   lc7/lc8=正常(a2)並行(g)用（run_shared_bot_tenancy.sh が使用）
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h1', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h2', now()-interval '1 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,consumed_at)
  values ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h3', now()+interval '20 min', now()-interval '5 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at,revoked_at)
  values ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h4', now()+interval '20 min', now()-interval '2 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h5', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h7', now()+interval '20 min');
insert into channel_link_codes(id,org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h8', now()+interval '20 min');

insert into org_channel_policy(org_id) values ('00000000-0000-0000-0000-0000000000a1');

-- =============================================================================
-- (a)(b) channel_groups INSERT 境界（A-1 トリガー）
-- =============================================================================
select assert_raises('a_platform_account_owner_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','GA','account_owner','00000000-0000-0000-0000-000000000101')
$q$, 'tenant_source in');
select assert_raises('a_platform_missing_space_rejected', $q$
  insert into channel_groups(org_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1','GA2','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'space_id');
select assert_raises('b_org_account_approved_link_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f2','GB','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'account_owner');
select assert_raises('b_org_id_mismatch_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source)
  values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f2','GB2','account_owner')
$q$, 'owner account org');

-- 回帰: org 専用bot経路が無変更で通る（tenant_source 未指定→default account_owner）
insert into channel_groups(id,org_id,account_id,external_group_id)
  values ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f2','GOK');
select assert_eq('org_account_owner_insert_ok', (select tenant_source from channel_groups where id='00000000-0000-0000-0000-000000000201'), 'account_owner');

-- (c) 越境列 immutable（A-2）
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
update channel_groups set last_extracted_message_created_at=now() where id='00000000-0000-0000-0000-000000000201';
select assert_eq('mutable_update_ok', (select (last_extracted_message_created_at is not null) from channel_groups where id='00000000-0000-0000-0000-000000000201'), true);

-- =============================================================================
-- fix1: channel_accounts owner_type/org_id immutable
-- =============================================================================
select assert_raises('acct_owner_type_immutable', $q$
  update channel_accounts set owner_type='platform', org_id=null where id='00000000-0000-0000-0000-0000000000f2'
$q$, 'immutable');
select assert_raises('acct_org_id_immutable', $q$
  update channel_accounts set org_id='00000000-0000-0000-0000-0000000000a2' where id='00000000-0000-0000-0000-0000000000f2'
$q$, 'immutable');
update channel_accounts set display_name='山田会計の秘書(更新)' where id='00000000-0000-0000-0000-0000000000f2';
select assert_eq('acct_display_name_mutable', (select display_name from channel_accounts where id='00000000-0000-0000-0000-0000000000f2'), '山田会計の秘書(更新)');

-- =============================================================================
-- shape CHECK / code_hash unique（20260715092424 の追加制約）
-- =============================================================================
select assert_raises('shape_shared_claim_needs_hash', $q$
  insert into channel_link_codes(org_id,space_id,purpose,binding_mode,target_account_id,expires_at)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1', now()+interval '10 min')
$q$);
select assert_raises('shape_shared_claim_no_plain_code', $q$
  insert into channel_link_codes(org_id,space_id,purpose,binding_mode,target_account_id,code_hash,code,expires_at)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h_plain','PLAINCODE', now()+interval '10 min')
$q$);
select assert_raises('code_hash_unique', $q$
  insert into channel_link_codes(org_id,space_id,purpose,binding_mode,target_account_id,code_hash,expires_at)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','shared_group_claim','web_approval','00000000-0000-0000-0000-0000000000f1','h1', now()+interval '10 min')
$q$);
-- 既存 identity 行（legacy）は影響を受けない（生code方式・code_hash無しでも通る）
insert into channel_link_codes(id,org_id,space_id,purpose,code)
  values ('00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','identity','LEGACYCODE1');
select assert_eq('legacy_identity_code_ok', (select purpose from channel_link_codes where id='00000000-0000-0000-0000-000000000110'), 'identity');

-- =============================================================================
-- claim 台帳: INSERT 整合トリガー / UPDATE guard（fix2）
-- =============================================================================
-- 正常 claim 群
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id,group_display_name_snapshot)
  values ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000f1','GX','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','酒屋グループ');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000000f1','GY','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000000f1','GZ','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-0000000000f1','GR','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GA2C','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');
-- 並行(g)用（run_shared_bot_tenancy.sh が承認する。ここでは pending のまま残す）
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000307','00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-0000000000f1','GCONC','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000308','00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-0000000000f1','GCONC','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');

-- INSERT 整合: claim.org/space が bound link_code と不一致なら拒否
select assert_raises('claim_insert_org_mismatch_rejected', $q$
  insert into channel_group_claims(link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000f1','GBAD','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2')
$q$, 'must equal link_code');

-- UPDATE guard: 結合列 immutable
select assert_raises('claim_link_code_id_immutable', $q$
  update channel_group_claims set link_code_id='00000000-0000-0000-0000-000000000102' where id='00000000-0000-0000-0000-000000000305'
$q$, 'immutable');
select assert_raises('claim_org_id_immutable', $q$
  update channel_group_claims set org_id='00000000-0000-0000-0000-0000000000a1' where id='00000000-0000-0000-0000-000000000305'
$q$, 'immutable');
-- status 不正遷移: pending→auto_approved 禁止
select assert_raises('claim_status_pending_to_auto_rejected', $q$
  update channel_group_claims set status='auto_approved' where id='00000000-0000-0000-0000-000000000305'
$q$, 'invalid status transition');

-- =============================================================================
-- 承認RPC 境界: (e)(f) / fix3 revoke / C1
-- =============================================================================
-- (e) 他org(a2) member(c2) が a1 claim を承認 → membership は code.org=a1 に対して → 拒否
select assert_raises('e_cross_org_member_approve_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c2')
$q$, 'not an internal member');
select assert_raises('e_outsider_approve_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c9')
$q$, 'not an internal member');
-- (f) 失効 / 消費済
select assert_raises('f_expired_code_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-0000000000c1')
$q$, 'expired');
select assert_raises('f_consumed_code_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-0000000000c1')
$q$, 'consumed');
-- fix3: revoke 済みコードの承認拒否
select assert_raises('f_revoked_code_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-0000000000c1')
$q$, 'revoked');

-- C1（RPC内部の org/space 突合・防御多重化）: INSERT整合を一時無効化して不整合 claim を作り、承認で拒否
alter table channel_group_claims disable trigger trg_channel_group_claims_insert_integrity;
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id)
  values ('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000f1','GMIX','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2');
alter table channel_group_claims enable trigger trg_channel_group_claims_insert_integrity;
select assert_raises('c1_claim_org_ne_code_org_rejected', $q$
  select rpc_approve_group_claim('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-0000000000c1')
$q$, 'does not match link_code');

-- A-1構造網回帰: bound code の org ≠ group.org の直接 INSERT が拒否（RPC非依存の攻撃経路）
select assert_raises('a1_bound_code_org_mismatch_rejected', $q$
  insert into channel_groups(org_id,space_id,account_id,external_group_id,tenant_source,bound_by_link_code_id)
  values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f1','GA1REG','approved_link_code','00000000-0000-0000-0000-000000000101')
$q$, 'bound link_code org_id');

-- 正常承認（org/space は code 由来）
select assert_eq('approve_ok_true', rpc_approve_group_claim('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000c1'), true);
select assert_eq('approve_created_group', (select count(*)::int from channel_groups where tenant_source='approved_link_code' and external_group_id='GX'), 1);
select assert_eq('approve_group_org_from_code', (select org_id from channel_groups where external_group_id='GX' and status='active'), '00000000-0000-0000-0000-0000000000a1'::uuid);
select assert_eq('approve_consumed_code', (select (consumed_at is not null) from channel_link_codes where id='00000000-0000-0000-0000-000000000101'), true);
select assert_eq('approve_claim_status', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000301'), 'approved');

-- fix3: reject RPC は code.org に対して membership 検証（link_code→claim 順ロック）
select assert_raises('reject_outsider_rejected', $q$
  select rpc_reject_group_claim('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-0000000000c9')
$q$, 'not an internal member');
select assert_raises('reject_wrong_org_member_rejected', $q$
  select rpc_reject_group_claim('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-0000000000c1')
$q$, 'not an internal member');
select assert_eq('reject_code_org_member_ok', rpc_reject_group_claim('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-0000000000c2'), true);
select assert_eq('reject_claim_status', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000305'), 'rejected');

-- enum: auto_approved を INSERT で直接記録できる（PR3 code_only 用・pending 非経由）／不明値は拒否
insert into channel_group_claims(id,link_code_id,account_id,external_group_id,org_id,space_id,status)
  values ('00000000-0000-0000-0000-000000000309','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GAUTO','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','auto_approved');
select assert_eq('enum_auto_approved_accepted', (select status from channel_group_claims where id='00000000-0000-0000-0000-000000000309'), 'auto_approved');
select assert_raises('enum_unknown_status_rejected', $q$
  insert into channel_group_claims(link_code_id,account_id,external_group_id,org_id,space_id,status)
  values ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-0000000000f1','GBAD2','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','bogus')
$q$);

-- (l) link_codes 焼き込み/consumed_at 一方向
select assert_raises('l_consumed_at_one_way', $q$
  update channel_link_codes set consumed_at=null where id='00000000-0000-0000-0000-000000000101'
$q$, 'consumed_at');
select assert_raises('binding_mode_immutable', $q$
  update channel_link_codes set binding_mode='code_only' where id='00000000-0000-0000-0000-000000000107'
$q$, 'immutable');
select assert_raises('link_code_org_immutable', $q$
  update channel_link_codes set org_id='00000000-0000-0000-0000-0000000000a1' where id='00000000-0000-0000-0000-000000000107'
$q$, 'immutable');

-- (k) org_channel_policy 既定
select assert_eq('k_policy_default_false', (select allow_code_only from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), false);
select assert_eq('k_policy_default_state_ok', (select state from org_channel_policy where org_id='00000000-0000-0000-0000-0000000000a1'), 'ok');

-- =============================================================================
-- V1: RLS 越境読取が 0行（実 migration の RLS。FORCE 無し＝set role で検証）
-- =============================================================================
-- claim 台帳の最終状態: a1={301 approved,302,303,304}=4 / a2={305 rejected,306,307,308,309}=5
set role authenticated;

set test.uid = '00000000-0000-0000-0000-0000000000c1';
select assert_eq('v1_claims_a1_self', (select count(*)::int from channel_group_claims), 4);
select assert_eq('v1_claims_a1_no_cross', (select count(*)::int from channel_group_claims where org_id='00000000-0000-0000-0000-0000000000a2'), 0);
select assert_eq('v1_policy_a1_self', (select count(*)::int from org_channel_policy), 1);

set test.uid = '00000000-0000-0000-0000-0000000000c2';
select assert_eq('v1_claims_a2_self', (select count(*)::int from channel_group_claims), 5);
select assert_eq('v1_claims_a2_no_cross', (select count(*)::int from channel_group_claims where org_id='00000000-0000-0000-0000-0000000000a1'), 0);
select assert_eq('v1_policy_a2_none', (select count(*)::int from org_channel_policy), 0);

set test.uid = '00000000-0000-0000-0000-0000000000c9';
select assert_eq('v1_claims_outsider_zero', (select count(*)::int from channel_group_claims), 0);
select assert_eq('v1_policy_outsider_zero', (select count(*)::int from org_channel_policy), 0);

reset role;

select 'SINGLE-SESSION CHECKS PASSED' as result;
