-- =============================================================================
-- 投票の CLI 用入口（rpc_doc_vote_cast_as / _actor_is_space_internal / _actor_can_read_doc_poll）の検証
-- 前提: run_doc_vote_cli_as.sh が空DBに全 migration を適用済み。
-- 仕様: docs/spec/DOC_VOTE_SPEC.md §4・20260926133744_doc_vote_cast_as.sql
--
-- 視点（org O1 に S1、別 org O2 に S2）:
--   u_ed    社内 member（S1 editor）… 作れる・道具からも押せる
--   u_view  社内 member（S1 viewer）… 道具からも押せる（読むだけの人も押せる）
--   u_cli   相手先（org=client ＋ S1 space=client）… 道具からは拒否
--   u_o2    別 org O2 の社内 member … 道具からは拒否
--   u_mfa   社内 member（S1 editor）で二要素認証を登録済み。画面用(rpc_doc_vote_cast)は aal1 では拒否
--             （道具用(_as)は mfa_satisfied() を確かめない。20260912134823 の7本と同じ）
--
-- 失敗したら例外で止まる。最後に「DOC VOTE CLI AS 全項目 PASS」を出す。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-4000-8000-0000000d2a01'
\set O2 '00000000-0000-4000-8000-0000000d2a02'
\set S1 '00000000-0000-4000-8000-0000000d2b01'
\set S2 '00000000-0000-4000-8000-0000000d2b02'
\set u_ed   '00000000-0000-4000-8000-0000000d2c01'
\set u_view '00000000-0000-4000-8000-0000000d2c02'
\set u_cli  '00000000-0000-4000-8000-0000000d2c03'
\set u_o2   '00000000-0000-4000-8000-0000000d2c04'
\set u_mfa  '00000000-0000-4000-8000-0000000d2c05'
\set W1 '00000000-0000-4000-8000-0000000d2d01'
\set P1 '00000000-0000-4000-8000-0000000d2f01'
\set P2 '00000000-0000-4000-8000-0000000d2f02'

-- ---- 検証用の小道具（doc_polls_assert.sql と同じ形。この検証だけの schema） ----
create schema if not exists dvca;
grant usage on schema dvca to authenticated, anon, service_role;

create or replace function dvca.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function dvca.check(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want and not (want like '%\%%' and got like want) then
    raise exception 'FAIL[%] got=% want=%', label, got, want;
  end if;
  raise notice 'PASS[%]', label;
end $$;

create or replace function dvca.as_user(p_uid text, p_aal text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    case when p_aal = '' then '' else json_build_object('sub', p_uid, 'aal', p_aal)::text end, false);
end $$;

grant execute on all functions in schema dvca to authenticated, anon, service_role;

-- service_role は RLS を通らない（本物の Supabase と同じ。run_rpc_definer_authz.sh 等と同じ代役）
alter role service_role bypassrls;

-- ---- 下ごしらえ（superuser で入れる） ----
insert into auth.users(id) values (:'u_ed'), (:'u_view'), (:'u_cli'), (:'u_o2'), (:'u_mfa');
insert into organizations(id, name) values (:'O1', '検証org1(cli)'), (:'O2', '検証org2(cli)');
insert into org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'), (:'O1', :'u_view', 'member'), (:'O1', :'u_cli', 'client'),
  (:'O2', :'u_o2', 'member'), (:'O1', :'u_mfa', 'member');
insert into spaces(id, org_id, type, name) values
  (:'S1', :'O1', 'project', 'S1'), (:'S2', :'O2', 'project', 'S2');
insert into space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'), (:'S1', :'u_view', 'viewer'), (:'S1', :'u_cli', 'client'),
  (:'S2', :'u_o2', 'editor'), (:'S1', :'u_mfa', 'editor');
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W1', :'O1', :'S1', 'W1', '[]', :'u_ed', :'u_ed');

-- 投票を2つ作る（画面と同じ入口。社内の編集者だけ）
set role authenticated;
select dvca.as_user(:'u_ed');
select dvca.check('setup_create_p1',
  dvca.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P1', :'W1', 'none')), 'ok');
select dvca.check('setup_create_p2_ng_hold',
  dvca.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P2', :'W1', 'ng_hold')), 'ok');
reset role;

-- =============================================================================
-- 道具用（rpc_doc_vote_cast_as）は service_role だけが呼べる
-- =============================================================================
set role service_role;

select dvca.check('as_editor_cast_ok',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ok', '')), 'ok');
select dvca.check('as_editor_vote_row',
  (select choice from doc_votes where poll_id = :'P1' and user_id = :'u_ed'), 'ok');
select dvca.check('as_editor_event_cast',
  (select action from doc_vote_events where poll_id = :'P1' and user_id = :'u_ed' order by id desc limit 1), 'cast');

-- 同じ内容の押し直しは履歴を増やさない（rpc_doc_vote_cast と同じ挙動）
select dvca.check('as_editor_recast_same_noop',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ok', '')), 'ok');
select dvca.check('as_editor_recast_same_no_new_event',
  (select count(*)::text from doc_vote_events where poll_id = :'P1' and user_id = :'u_ed'), '1');

-- 選び直す（change）
select dvca.check('as_editor_change_ng',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ng', '選び直した')), 'ok');
select dvca.check('as_editor_change_event',
  (select action from doc_vote_events where poll_id = :'P1' and user_id = :'u_ed' order by id desc limit 1), 'change');

-- 取り消す（retract。p_choice = null）
select dvca.check('as_editor_retract',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, null, %L)', :'u_ed', :'P1', '')), 'ok');
select dvca.check('as_editor_retract_row_gone',
  (select count(*)::text from doc_votes where poll_id = :'P1' and user_id = :'u_ed'), '0');
select dvca.check('as_editor_retract_event',
  (select action from doc_vote_events where poll_id = :'P1' and user_id = :'u_ed' order by id desc limit 1), 'retract');

-- 読むだけの人（viewer）も道具から押せる
select dvca.check('as_viewer_cast_ok',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_view', :'P1', 'hold', '')), 'ok');

-- 相手先（client）は道具からも拒否
select dvca.check('as_client_denied',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_cli', :'P1', 'ok', '')), 'err:42501:%');

-- 別 org のメンバーは道具からも拒否（その space に属していない）
select dvca.check('as_other_org_denied',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_o2', :'P1', 'ok', '')), 'err:42501:%');

-- 理由必須（ng_hold）は道具からも守られる
select dvca.check('as_reason_required_empty_denied',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P2', 'ng', '')), 'err:22023:reason_required');
select dvca.check('as_reason_required_with_memo_ok',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P2', 'ng', 'ここが心配')), 'ok');

-- 引数の形が違うものは道具からも拒否
select dvca.check('as_invalid_choice',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'maybe', '')), 'err:22023:invalid_choice');
select dvca.check('as_memo_too_long',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ok', repeat('x', 2001))), 'err:22023:memo_too_long');

-- 存在しない投票は forbidden（有無を見分けさせない。app_can_read_doc_poll と同じ）
select dvca.check('as_unknown_poll_denied',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', '00000000-0000-4000-8000-0000000d2fff', 'ok', '')), 'err:42501:%');

reset role;

-- =============================================================================
-- authenticated / anon は rpc_doc_vote_cast_as を呼べない（実行権が service_role だけ）
-- =============================================================================
set role authenticated;
select dvca.as_user(:'u_ed');
select dvca.check('authenticated_cannot_call_as',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ok', '')), 'err:42501:permission denied%');
reset role;

set role anon;
select dvca.check('anon_cannot_call_as',
  dvca.try(format('select rpc_doc_vote_cast_as(%L, %L, %L, %L)', :'u_ed', :'P1', 'ok', '')), 'err:42501:permission denied%');
reset role;

-- =============================================================================
-- 画面用（rpc_doc_vote_cast・auth.uid()）はこれまでどおり動く（回帰）
-- =============================================================================
set role authenticated;
select dvca.as_user(:'u_ed');
select dvca.check('screen_cast_ok',
  dvca.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'ok');

-- 二要素認証を登録した人は、満たすまで画面からも拒否（既存の挙動を変えていない）
select dvca.as_user(:'u_mfa', 'aal1');
select dvca.check('screen_mfa_aal1_denied',
  dvca.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'err:42501:forbidden');
select dvca.as_user(:'u_mfa', 'aal2');
select dvca.check('screen_mfa_aal2_ok',
  dvca.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'ok');
reset role;

select dvca.check('DOC VOTE CLI AS 全項目 PASS', 'ok', 'ok');
