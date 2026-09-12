-- =============================================================================
-- 議事録のタスク化が、隙間に入った他の人の書き込みを消さないか
--   （*_minutes_taskify_base_check.sql の挙動検証）
--
-- 前提: run_minutes_taskify_base_check.sh が _local_bootstrap → Supabase の権限の代役
--       → migrations を verbatim 適用済み。データはこのファイルが入れる（postgres で
--       入れるので RLS は通らない）。
--
-- 組織 O1・案件 S1。人物: ed（社内の編集者）・vw（社内の閲覧者）。
-- 会議:
--   MT_A  未処理の SPEC 行が1行ある議事録（一致する本文で呼ぶ＝ふつうのタスク化）
--   MT_B  同じ本文（違う本文で呼ぶ＝隙間で誰かが書いた状態）
--   MT_C  議事録が NULL（空の会議でタスク化しても0件で通ること）
--
-- label:
--   chg_*   この migration で定める規則（migration 無しでは成り立たない）
--   same_*  この migration で変えない規則（migration の有無にかかわらず成り立つ）
-- 出力: PASS[label] / FAIL[label]。FAIL が0件なら "MINUTES TASKIFY BASE CHECK PASSED"、
--   1件でもあれば例外で終わる。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set u_ed '00000000-0000-0000-0000-00000000c001'
\set u_vw '00000000-0000-0000-0000-00000000c002'
\set MT_A '00000000-0000-0000-0000-000000004001'
\set MT_B '00000000-0000-0000-0000-000000004002'
\set MT_C '00000000-0000-0000-0000-000000004003'

-- -----------------------------------------------------------------------------
-- 検査の道具
-- -----------------------------------------------------------------------------
create schema if not exists test;
create table test.results(label text, ok boolean, detail text);

create or replace function test.check(p_label text, p_got text, p_want text) returns void
language plpgsql as $$
declare
  v_ok boolean;
begin
  v_ok := case
    when p_want like 'like:%' then p_got like substring(p_want from 6)
    else p_got = p_want
  end;
  insert into test.results values (p_label, v_ok, p_got);
  if v_ok then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got % / want %', p_label, p_got, p_want;
  end if;
end $$;

/* タスク化を1回呼び、成功なら 'ok:<作成件数>'、失敗なら 'err:<SQLSTATE>:<HINT>:<文の先頭>' を返す。
   例外を受けるので、失敗した回の書き込み（tasks・task_events・minutes_md）は巻き戻る
   ——本番でも同じ（関数の中の例外はそのトランザクションを巻き戻す）。 */
create or replace function test.parse(p_meeting uuid, p_body text) returns text
language plpgsql as $$
declare
  v jsonb;
  v_hint text;
  v_msg text;
begin
  v := public.rpc_parse_meeting_minutes(p_meeting, p_body);
  return 'ok:' || (v ->> 'created_count');
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
  return 'err:' || sqlstate || ':' || coalesce(nullif(v_hint, ''), '-') || ':' || left(v_msg, 24);
end $$;

-- -----------------------------------------------------------------------------
-- データ
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1');
insert into auth.users(id) values (:'u_ed'), (:'u_vw');
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'),
  (:'O1', :'u_vw', 'member');
insert into public.spaces(id, org_id, type, name) values (:'S1', :'O1', 'project', 's1');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'),
  (:'S1', :'u_vw', 'viewer');

\set SPEC_LINE '- [ ] SPEC(/spec/REVIEW_SPEC.md#a): 仕様を決める'
insert into public.meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by) values
  (:'MT_A', :'O1', :'S1', 'mt-a', now(), 'ended', :'SPEC_LINE', :'u_ed'),
  (:'MT_B', :'O1', :'S1', 'mt-b', now(), 'ended', :'SPEC_LINE', :'u_ed'),
  (:'MT_C', :'O1', :'S1', 'mt-c', now(), 'ended', null,         :'u_ed');

-- 社内の編集者として呼ぶ
select set_config('request.jwt.claim.sub', :'u_ed', false);

-- -----------------------------------------------------------------------------
-- 1) 隙間で誰かが書いていた（渡された本文が DB の本文と違う）→ 何も書かずに止める
-- -----------------------------------------------------------------------------
select test.check('chg_stale_body_blocked',
  test.parse(:'MT_B', :'SPEC_LINE' || E'\n\nほかの人が書いた追記'),
  'like:err:P0001:minutes_stale:%');

select test.check('chg_stale_body_keeps_minutes',
  (select coalesce(minutes_md, '<null>') from public.meetings where id = :'MT_B'),
  :'SPEC_LINE');

select test.check('chg_stale_body_creates_no_task',
  (select count(*)::text from public.tasks where space_id = :'S1'),
  '0');

-- -----------------------------------------------------------------------------
-- 2) 本文が一致していれば、これまでどおりタスクを作り、行末に目印を足す
-- -----------------------------------------------------------------------------
select test.check('same_matching_body_creates_task', test.parse(:'MT_A', :'SPEC_LINE'), 'ok:1');

select test.check('same_matching_body_writes_marker',
  (select minutes_md from public.meetings where id = :'MT_A'),
  'like:' || :'SPEC_LINE' || ' <!--task:%-->');

-- どのタスクが MT_A から作られたかは task_events（SPEC_CREATED）で辿る
-- （会議ごとに絞らないと、migration 無しで回したとき＝RED のときに別の会議のぶんも拾ってしまう）
select test.check('same_created_task_is_spec',
  (select string_agg(distinct t.type || '/' || t.decision_state || '/' || t.spec_path, ',')
     from public.tasks t
     join public.task_events e on e.task_id = t.id
    where e.meeting_id = :'MT_A' and e.action = 'SPEC_CREATED'),
  'spec/considering//spec/REVIEW_SPEC.md#a');

-- -----------------------------------------------------------------------------
-- 3) 目印が付く前の（古い）本文で もう一度呼ばれても、同じ SPEC 行で2本目を作らない
--    （隙間で他の人が先にタスク化していた場合がこれ）
-- -----------------------------------------------------------------------------
select test.check('chg_second_call_with_old_body_blocked',
  test.parse(:'MT_A', :'SPEC_LINE'),
  'like:err:P0001:minutes_stale:%');

select test.check('chg_no_duplicate_task_for_same_spec_line',
  (select count(*)::text from public.tasks where space_id = :'S1' and spec_path = '/spec/REVIEW_SPEC.md#a'),
  '1');

-- -----------------------------------------------------------------------------
-- 4) 本文が空の会議（NULL）でタスク化しても、これまでどおり0件で通る
--    （NULL と空文字を同じものとして扱っているか）
-- -----------------------------------------------------------------------------
select test.check('same_empty_minutes_ok', test.parse(:'MT_C', ''), 'ok:0');

-- -----------------------------------------------------------------------------
-- 5) 権限の確認は今までどおり先に走る（閲覧者は本文がずれていても「権限が無い」で止まる）
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'u_vw', false);
select test.check('same_viewer_not_authorized',
  test.parse(:'MT_B', 'ぜんぜん違う本文'),
  'like:err:P0001:-:Not authorized%');
select set_config('request.jwt.claim.sub', :'u_ed', false);

-- -----------------------------------------------------------------------------
-- 集計
-- -----------------------------------------------------------------------------
do $$
declare
  v_fail int;
  v_pass int;
begin
  select count(*) filter (where not ok), count(*) filter (where ok) into v_fail, v_pass from test.results;
  if v_fail > 0 then
    raise exception 'MINUTES TASKIFY BASE CHECK FAILED: % 件 / PASS % 件', v_fail, v_pass;
  end if;
  raise notice 'MINUTES TASKIFY BASE CHECK PASSED (% 件)', v_pass;
end $$;
