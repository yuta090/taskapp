-- =============================================================================
-- 投票ブロック（doc_polls / doc_votes / doc_vote_events）の検証
-- 前提: run_doc_polls.sh が空DBに全 migration を適用済み。
-- 仕様: docs/spec/DOC_VOTE_SPEC.md §4（表・入口の関数・読める範囲）
--
-- 視点（org O1 に S1・S2、別 org O2 に S3）:
--   u_ed    社内 member（S1 editor）… 投票を作れる・押せる
--   u_view  社内 member（S1 viewer）… 作れない・押せる（読むだけの人も押せる）
--   u_cli   相手先（org=client ＋ S1 space=client）… PR1 では読めない・押せない
--   u_o2    別 org O2 の社内 member … 読めない・押せない
--   u_mfa   社内 member（S1 editor）で二要素認証を登録済み。aal1 では読めない・押せない
--
-- 失敗したら例外で止まる。最後に「DOC POLLS 全項目 PASS」を出す。
-- 権限拒否も RLS 拒否も SQLSTATE は 42501 なので、直書きの拒否はメッセージも見る。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-4000-8000-0000000d0a01'
\set O2 '00000000-0000-4000-8000-0000000d0a02'
\set S1 '00000000-0000-4000-8000-0000000d0b01'
\set S2 '00000000-0000-4000-8000-0000000d0b02'
\set S3 '00000000-0000-4000-8000-0000000d0b03'
\set u_ed   '00000000-0000-4000-8000-0000000d0c01'
\set u_view '00000000-0000-4000-8000-0000000d0c02'
\set u_cli  '00000000-0000-4000-8000-0000000d0c03'
\set u_o2   '00000000-0000-4000-8000-0000000d0c04'
\set u_mfa  '00000000-0000-4000-8000-0000000d0c05'
\set W1 '00000000-0000-4000-8000-0000000d0d01'
\set W2 '00000000-0000-4000-8000-0000000d0d02'
\set W3 '00000000-0000-4000-8000-0000000d0d03'
\set M1 '00000000-0000-4000-8000-0000000d0e01'
\set P1 '00000000-0000-4000-8000-0000000d0f01'
\set P2 '00000000-0000-4000-8000-0000000d0f02'
\set P3 '00000000-0000-4000-8000-0000000d0f03'
\set PX '00000000-0000-4000-8000-0000000d0f04'

-- ---- 検証用の小道具（呼んだ人の権限で動く） ----
create schema if not exists dvt;
grant usage on schema dvt to authenticated, anon;

-- 文を実行して ok / err:<SQLSTATE>:<メッセージ> を返す。成功した分はそのまま残す
create or replace function dvt.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function dvt.check(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want and not (want like '%\%%' and got like want) then
    raise exception 'FAIL[%] got=% want=%', label, got, want;
  end if;
  raise notice 'PASS[%]', label;
end $$;

-- 呼ぶ人を切り替える（auth.uid() は request.jwt.claim.sub、aal は request.jwt.claims を読む）
create or replace function dvt.as_user(p_uid text, p_aal text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    case when p_aal = '' then '' else json_build_object('sub', p_uid, 'aal', p_aal)::text end, false);
end $$;

grant execute on all functions in schema dvt to authenticated, anon;

-- ---- 下ごしらえ（superuser で入れる） ----
insert into auth.users(id) values (:'u_ed'), (:'u_view'), (:'u_cli'), (:'u_o2'), (:'u_mfa');
insert into organizations(id, name) values (:'O1', '検証org1'), (:'O2', '検証org2');
insert into org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'), (:'O1', :'u_view', 'member'), (:'O1', :'u_cli', 'client'),
  (:'O2', :'u_o2', 'member'), (:'O1', :'u_mfa', 'member');
insert into spaces(id, org_id, type, name) values
  (:'S1', :'O1', 'project', 'S1'), (:'S2', :'O1', 'project', 'S2'), (:'S3', :'O2', 'project', 'S3');
insert into space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'), (:'S1', :'u_view', 'viewer'), (:'S1', :'u_cli', 'client'),
  (:'S3', :'u_o2', 'editor'), (:'S1', :'u_mfa', 'editor');
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W1', :'O1', :'S1', 'W1', '[]', :'u_ed', :'u_ed'),
  (:'W2', :'O1', :'S1', 'W2', '[]', :'u_ed', :'u_ed'),
  (:'W3', :'O2', :'S3', 'W3', '[]', :'u_o2', :'u_o2');
insert into meetings(id, org_id, space_id, title, held_at, created_by) values
  (:'M1', :'O1', :'S1', 'M1', now(), :'u_ed');

set role authenticated;

-- ---- 作る（rpc_doc_poll_create） ----
select dvt.as_user(:'u_ed');
select dvt.check('create_editor',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P1', :'W1', 'none')), 'ok');
select dvt.check('create_editor_ng_hold',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P2', :'W1', 'ng_hold')), 'ok');
select dvt.check('create_meeting',
  dvt.try(format('select rpc_doc_poll_create(%L, null, %L, %L)', :'P3', :'M1', 'none')), 'ok');
-- 同じ番号・同じ文書で作り直しても通る（通信の再送で二重にならない）
select dvt.check('create_idempotent',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P1', :'W1', 'none')), 'ok');
-- 同じ番号を別の文書で使おうとすると拒否（コピーした番号の横取りを防ぐ）
select dvt.check('create_same_id_other_doc',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P1', :'W2', 'none')), 'err:22023:%');
select dvt.check('create_bad_reason',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'PX', :'W1', 'always')), 'err:22023:%');
select dvt.check('create_both_docs',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, %L, %L)', :'PX', :'W1', :'M1', 'none')), 'err:22023:%');
select dvt.check('create_no_doc',
  dvt.try(format('select rpc_doc_poll_create(%L, null, null, %L)', :'PX', 'none')), 'err:22023:%');

select dvt.as_user(:'u_view');
select dvt.check('create_viewer_denied',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'PX', :'W1', 'none')), 'err:42501:%');
select dvt.as_user(:'u_cli');
select dvt.check('create_client_denied',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'PX', :'W1', 'none')), 'err:42501:%');
select dvt.as_user(:'u_o2');
select dvt.check('create_other_org_denied',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'PX', :'W1', 'none')), 'err:42501:%');

-- 行の space / org は文書から取る（引数で受けない）
reset role;
select dvt.check('create_space_from_doc',
  (select space_id::text || '/' || org_id::text || '/' || created_by::text from doc_polls where id = :'P1'),
  :'S1' || '/' || :'O1' || '/' || :'u_ed');
select dvt.check('create_meeting_space',
  (select space_id::text from doc_polls where id = :'P3'), :'S1');
set role authenticated;

-- ---- 押す（rpc_doc_vote_cast） ----
select dvt.as_user(:'u_view');
select dvt.check('vote_viewer_ok',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'ok');
select dvt.check('vote_row',
  (select choice || '/' || memo from doc_votes where poll_id = :'P1' and user_id = :'u_view'), 'ok/');
select dvt.check('vote_event_cast',
  (select string_agg(action || ':' || coalesce(choice, '-'), ',' order by id) from doc_vote_events where poll_id = :'P1'),
  'cast:ok');
-- 同じ内容で押し直しても履歴は増えない
select dvt.check('vote_same_again',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'ok');
select dvt.check('vote_same_no_event',
  (select count(*)::text from doc_vote_events where poll_id = :'P1'), '1');
-- 選び直すと履歴に change が残り、行は1つのまま
select dvt.check('vote_change',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'hold', E'来週まで待って\n理由は後で')), 'ok');
select dvt.check('vote_change_row_count',
  (select count(*)::text from doc_votes where poll_id = :'P1'), '1');
select dvt.check('vote_change_memo_newline',
  (select memo from doc_votes where poll_id = :'P1' and user_id = :'u_view'), E'来週まで待って\n理由は後で');
select dvt.check('vote_change_events',
  (select string_agg(action || ':' || coalesce(choice, '-'), ',' order by id) from doc_vote_events where poll_id = :'P1'),
  'cast:ok,change:hold');
-- メモだけ直しても change
select dvt.check('vote_memo_only',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'hold', '金曜まで')), 'ok');
select dvt.check('vote_memo_only_event',
  (select count(*)::text from doc_vote_events where poll_id = :'P1' and action = 'change'), '2');
-- 取り消すと行が消え、retract が残る
select dvt.check('vote_retract',
  dvt.try(format('select rpc_doc_vote_cast(%L, null, %L)', :'P1', '')), 'ok');
select dvt.check('vote_retract_row',
  (select count(*)::text from doc_votes where poll_id = :'P1' and user_id = :'u_view'), '0');
select dvt.check('vote_retract_event',
  (select action from doc_vote_events where poll_id = :'P1' order by id desc limit 1), 'retract');
-- 押していないのに取り消しても何も残さない
select dvt.check('vote_retract_twice',
  dvt.try(format('select rpc_doc_vote_cast(%L, null, %L)', :'P1', '')), 'ok');
select dvt.check('vote_retract_twice_no_event',
  (select count(*)::text from doc_vote_events where poll_id = :'P1' and action = 'retract'), '1');

-- 選べるのは ok / ng / hold だけ。メモは 2000 字まで
select dvt.check('vote_bad_choice',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'yes', '')), 'err:22023:%');
select dvt.check('vote_memo_too_long',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', repeat('あ', 2001))), 'err:22023:%');

-- 理由必須（ng_hold）: NG・保留は空メモを拒否。OK は空でよい
select dvt.as_user(:'u_ed');
select dvt.check('reason_ng_empty',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P2', 'ng', '  ')), 'err:22023:reason_required');
select dvt.check('reason_hold_empty',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P2', 'hold', '')), 'err:22023:reason_required');
select dvt.check('reason_ng_with_memo',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P2', 'ng', '予算が合わない')), 'ok');
select dvt.check('reason_ok_empty',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P2', 'ok', '')), 'ok');
-- 理由任意（none）: NG を空メモで押せる
select dvt.check('reason_none_ng_empty',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P3', 'ng', '')), 'ok');

-- 存在しない投票は、読めない投票と同じ返事にする（有無を見分けさせない）
select dvt.check('vote_unknown_poll',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'PX', 'ok', '')), 'err:42501:%');

-- 相手先・別組織は（PR1 では）押せない
select dvt.as_user(:'u_cli');
select dvt.check('vote_client_denied',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'err:42501:%');
select dvt.as_user(:'u_o2');
select dvt.check('vote_other_org_denied',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'err:42501:%');

-- ---- 読める範囲 ----
select dvt.as_user(:'u_ed');
select dvt.check('read_editor',
  (select count(*) from doc_polls)::text || '/' || (select count(*) from doc_votes)::text
    || '/' || (select count(*) from doc_vote_events)::text, '3/2/7');
select dvt.as_user(:'u_view');
select dvt.check('read_viewer', (select count(*) from doc_polls)::text, '3');
select dvt.as_user(:'u_cli');
select dvt.check('read_client',
  (select count(*) from doc_polls)::text || '/' || (select count(*) from doc_votes)::text
    || '/' || (select count(*) from doc_vote_events)::text, '0/0/0');
select dvt.as_user(:'u_o2');
select dvt.check('read_other_org', (select count(*) from doc_polls)::text, '0');

-- ---- 直接は書けない（入口の関数だけ） ----
select dvt.as_user(:'u_ed');
select dvt.check('direct_insert_poll',
  dvt.try(format('insert into doc_polls(id, org_id, space_id, wiki_page_id, reason_required) values (%L, %L, %L, %L, %L)',
    :'PX', :'O1', :'S1', :'W1', 'none')), 'err:42501:permission denied%');
select dvt.check('direct_update_poll',
  dvt.try(format('update doc_polls set reason_required = %L where id = %L', 'none', :'P2')), 'err:42501:permission denied%');
select dvt.check('direct_insert_vote',
  dvt.try(format('insert into doc_votes(poll_id, user_id, choice) values (%L, %L, %L)', :'P1', :'u_ed', 'ok')),
  'err:42501:permission denied%');
select dvt.check('direct_update_vote',
  dvt.try(format('update doc_votes set memo = %L', 'x')), 'err:42501:permission denied%');
select dvt.check('direct_delete_event',
  dvt.try('delete from doc_vote_events'), 'err:42501:permission denied%');
select dvt.check('direct_update_event',
  dvt.try(format('update doc_vote_events set memo = %L', 'x')), 'err:42501:permission denied%');

-- ---- 二要素認証 ----
select dvt.as_user(:'u_mfa');
select dvt.check('mfa_aal1_read', (select count(*) from doc_polls)::text, '0');
select dvt.check('mfa_aal1_vote',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'err:42501:%');
select dvt.check('mfa_aal1_create',
  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'PX', :'W1', 'none')), 'err:42501:%');
select dvt.as_user(:'u_mfa', 'aal2');
select dvt.check('mfa_aal2_read', (select count(*) from doc_polls)::text, '3');
select dvt.check('mfa_aal2_vote',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'ok');

-- ---- 未ログイン（anon）は関数も表も使えない ----
reset role;
set role anon;
select dvt.as_user('');
select dvt.check('anon_vote',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P1', 'ok', '')), 'err:42501:permission denied%');
select dvt.check('anon_read',
  dvt.try('select count(*) from doc_polls'), 'err:42501:permission denied%');

-- ---- 設定は作ったあと変えられない（service role・所有者でも） ----
reset role;
select dvt.check('reason_immutable',
  dvt.try(format('update doc_polls set reason_required = %L where id = %L', 'none', :'P2')), 'err:22023:%');

-- ---- 投票を作った人のアカウントを消せる（作成者の記録だけ空になる） ----
\set u_cr '00000000-0000-4000-8000-0000000d0c06'
\set P4 '00000000-0000-4000-8000-0000000d0f05'
insert into auth.users(id) values (:'u_cr');
insert into org_memberships(org_id, user_id, role) values (:'O1', :'u_cr', 'member');
insert into space_memberships(space_id, user_id, role) values (:'S1', :'u_cr', 'editor');
set role authenticated;
select dvt.as_user(:'u_cr');
select dvt.check('creator_creates',
  dvt.try(format('select rpc_doc_poll_create(%L, null, %L, %L)', :'P4', :'M1', 'none')), 'ok');
select dvt.check('creator_votes',
  dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P4', 'ok', '')), 'ok');
reset role;
select dvt.check('delete_creator',
  dvt.try(format('delete from auth.users where id = %L', :'u_cr')), 'ok');
select dvt.check('creator_nulled',
  (select coalesce(created_by::text, 'null') || '/' || reason_required from doc_polls where id = :'P4'), 'null/none');
select dvt.check('creator_votes_gone',
  (select count(*)::text from doc_votes where poll_id = :'P4'), '0');
-- 作成者を空にする以外の更新は、これまでどおり拒否
select dvt.check('reason_still_immutable',
  dvt.try(format('update doc_polls set reason_required = %L where id = %L', 'ng_hold', :'P4')), 'err:22023:%');
select dvt.check('creator_cannot_be_set',
  dvt.try(format('update doc_polls set created_by = %L where id = %L', :'u_view', :'P4')), 'err:22023:%');

-- ---- 文書を消すと投票・票・履歴も消える ----
delete from wiki_pages where id = :'W1';
select dvt.check('cascade_wiki',
  (select count(*) from doc_polls where wiki_page_id = :'W1')::text || '/'
    || (select count(*) from doc_votes where poll_id in (:'P1', :'P2'))::text || '/'
    || (select count(*) from doc_vote_events where poll_id in (:'P1', :'P2'))::text, '0/0/0');

\echo 'DOC POLLS 全項目 PASS'
