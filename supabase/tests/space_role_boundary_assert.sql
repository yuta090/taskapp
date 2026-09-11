-- =============================================================================
-- space の役割ごとの権限（*_space_role_boundary.sql）の挙動検証
-- 前提: run_space_role_boundary.sh が _local_bootstrap → Supabase の権限の代役 → migrations を verbatim 適用済み。
--
-- 組織 O1: S1（相手先A の案件）・S2（相手先B の案件）・SP（ed の個人 space）。組織 O2: S3。
-- 人物（set local role authenticated ＋ request.jwt.claims の sub で切り替える）:
--   ed    社内の編集者（O1 member・S1 editor）
--   vw    社内の閲覧者（O1 member・S1 viewer）
--   nm    space の役割が無い社内メンバー（O1 member）… editor として扱う
--   cli   相手先（O1 client・S1 client）
--   ven   vendor（O1 client・S1 vendor：rpc_accept_invite の実際の対応）
--   cli2  別の相手先（O1 client・S2 client）
--   o2    別の組織の社内（O2 owner・S3 editor）
--   ic / iv       org は社内（member）で、S1 の役割は client / vendor
--   ce / ca / cv  org は client で、S1 の役割は editor / admin / viewer
--   svc   service_role（RLS を通らない）
--
-- データ（O1）:
--   tasks      T_del（S1・deliverable・M1）/ T_int（S1・internal・M1）/ T_cb（S1・deliverable・ball=client）/
--              T_rev（S1・deliverable・M2 の唯一のタスク・未承認のレビュー R_rev）/ T_s2（S2）
--   meetings   MT_pl（予定・notes あり）/ MT_ip（進行中）/ MT_en（終了）/ MT_s2（S2・終了）
--   wiki       W_pub（公開済みの M1 に公開）/ W_draft（未公開）/ W_off（公開を取り下げた M3 に公開）/ W_s2（S2・公開済み）
--   comments   internal / client / vendor / agency_only（T_del）・client（T_int）・vendor（T_cb）
--
-- label:
--   chg_*    本 migration で定める規則
--   same_*   本 migration で変えない規則
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "SPACE ROLE BOUNDARY CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- 書き込み・RPC は test.try / test.val / test.flow がサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set S3 '00000000-0000-0000-0000-00000000b003'
\set SP '00000000-0000-0000-0000-00000000b004'
\set u_ed   '00000000-0000-0000-0000-00000000c001'
\set u_vw   '00000000-0000-0000-0000-00000000c002'
\set u_cli  '00000000-0000-0000-0000-00000000c003'
\set u_ven  '00000000-0000-0000-0000-00000000c004'
\set u_o2   '00000000-0000-0000-0000-00000000c005'
\set u_nm   '00000000-0000-0000-0000-00000000c006'
\set u_cli2 '00000000-0000-0000-0000-00000000c007'
\set u_ic   '00000000-0000-0000-0000-00000000c008'
\set u_iv   '00000000-0000-0000-0000-00000000c009'
\set u_ce   '00000000-0000-0000-0000-00000000c00a'
\set u_ca   '00000000-0000-0000-0000-00000000c00b'
\set u_cv   '00000000-0000-0000-0000-00000000c00c'
\set T_del '00000000-0000-0000-0000-00000000d001'
\set T_int '00000000-0000-0000-0000-00000000d002'
\set T_cb  '00000000-0000-0000-0000-00000000d003'
\set T_rev '00000000-0000-0000-0000-00000000d004'
\set T_s2  '00000000-0000-0000-0000-00000000d005'
\set T_o2  '00000000-0000-0000-0000-00000000d006'
\set T_mm  '00000000-0000-0000-0000-00000000d007'
\set M1   '00000000-0000-0000-0000-00000000e001'
\set M2   '00000000-0000-0000-0000-00000000e002'
\set M3   '00000000-0000-0000-0000-00000000e003'
\set M_s2 '00000000-0000-0000-0000-00000000e004'
\set M_o2 '00000000-0000-0000-0000-00000000e005'
\set MP1   '00000000-0000-0000-0000-00000000f001'
\set MP3   '00000000-0000-0000-0000-00000000f003'
\set MP_s2 '00000000-0000-0000-0000-00000000f004'
\set MP_o2 '00000000-0000-0000-0000-00000000f005'
\set W_pub   '00000000-0000-0000-0000-000000001001'
\set W_draft '00000000-0000-0000-0000-000000001002'
\set W_off   '00000000-0000-0000-0000-000000001003'
\set W_s2    '00000000-0000-0000-0000-000000001004'
\set W_o2    '00000000-0000-0000-0000-000000001005'
\set WPP1   '00000000-0000-0000-0000-000000002001'
\set WPP3   '00000000-0000-0000-0000-000000002003'
\set WPP_s2 '00000000-0000-0000-0000-000000002004'
\set WV1 '00000000-0000-0000-0000-000000003001'
\set MT_pl '00000000-0000-0000-0000-000000004001'
\set MT_ip '00000000-0000-0000-0000-000000004002'
\set MT_en '00000000-0000-0000-0000-000000004003'
\set MT_s2 '00000000-0000-0000-0000-000000004004'
\set MT_o2 '00000000-0000-0000-0000-000000004005'
\set MTP1 '00000000-0000-0000-0000-000000004101'
\set MTP2 '00000000-0000-0000-0000-000000004102'
\set MTP3 '00000000-0000-0000-0000-000000004103'
\set MTP4 '00000000-0000-0000-0000-000000004104'
\set R_rev '00000000-0000-0000-0000-000000005001'
\set R_int '00000000-0000-0000-0000-000000005002'
\set DI1 '00000000-0000-0000-0000-000000006001'
\set TR1 '00000000-0000-0000-0000-000000006002'
\set TO1 '00000000-0000-0000-0000-000000006003'
\set TE1 '00000000-0000-0000-0000-000000006004'
\set TO_mm '00000000-0000-0000-0000-000000006005'
\set C_int     '00000000-0000-0000-0000-000000007001'
\set C_cli     '00000000-0000-0000-0000-000000007002'
\set C_ven     '00000000-0000-0000-0000-000000007003'
\set C_ag      '00000000-0000-0000-0000-000000007004'
\set C_cli_int '00000000-0000-0000-0000-000000007005'
\set C_ven_cb  '00000000-0000-0000-0000-000000007006'
\set PR_vw '00000000-0000-0000-0000-000000008001'
\set PR_ed '00000000-0000-0000-0000-000000008002'
\set TP1 '00000000-0000-0000-0000-000000009001'

\set c_ed   '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_vw   '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_cli  '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_ven  '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_o2   '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
\set c_nm   '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'
\set c_cli2 '{"sub":"00000000-0000-0000-0000-00000000c007","role":"authenticated"}'
\set c_ic   '{"sub":"00000000-0000-0000-0000-00000000c008","role":"authenticated"}'
\set c_iv   '{"sub":"00000000-0000-0000-0000-00000000c009","role":"authenticated"}'
\set c_ce   '{"sub":"00000000-0000-0000-0000-00000000c00a","role":"authenticated"}'
\set c_ca   '{"sub":"00000000-0000-0000-0000-00000000c00b","role":"authenticated"}'
\set c_cv   '{"sub":"00000000-0000-0000-0000-00000000c00c","role":"authenticated"}'

-- 画面が会議を読むときの列（develop 9b953e91 のファイルから写した）
--   ポータル   src/lib/portal/fetchPortalMeetingsData.ts の MEETING_COLUMNS
--   社内の一覧 src/lib/supabase/queries.ts の MEETING_LIST_COLUMNS（meeting_participants (*) の埋め込みつき）
--   社内の詳細 src/lib/supabase/queries.ts の MEETING_DETAIL_COLUMNS
\set portal_meeting_columns 'id, title, held_at, status, minutes_md, summary_subject, summary_body, started_at, ended_at'
\set meeting_list_columns 'id, org_id, space_id, title, held_at, status, started_at, ended_at, summary_subject, summary_body, created_at, updated_at'
\set meeting_detail_columns 'id, org_id, space_id, title, held_at, status, started_at, ended_at, minutes_md, summary_subject, summary_body, created_at, updated_at'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

create table test.ids (k text primary key, v uuid not null);
grant select on test.ids to authenticated, service_role;
insert into test.ids(k, v) values
  ('O1', :'O1'), ('S1', :'S1'), ('u_nm', :'u_nm'),
  ('T_del', :'T_del'), ('T_cb', :'T_cb'), ('M1', :'M1'), ('MT_ip', :'MT_ip'), ('MT_pl', :'MT_pl'),
  ('R_rev', :'R_rev'), ('TO1', :'TO1'), ('TE1', :'TE1'), ('TR1', :'TR1'), ('W_pub', :'W_pub'),
  ('W_draft', :'W_draft'), ('WV1', :'WV1'), ('WPP1', :'WPP1'), ('DI1', :'DI1'), ('MTP1', :'MTP1');

create or replace function test.id(p_k text) returns uuid language sql stable as $$
  select v from test.ids where k = p_k;
$$;

-- 結果の記録（definer: authenticated / service_role の視点のままでも記録できる）
--   want が 'like:' で始まるときは LIKE で、'deny' は拒否（RLS の 42501 か、確かめるトリガーの P0001）、それ以外は完全一致で比べる。
create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql security definer set search_path = test, public as $$
declare
  v_ok boolean := coalesce(
    case
      when p_want like 'like:%' then p_got like substr(p_want, 6)
      when p_want = 'deny' then p_got like 'err:42501:%' or p_got like 'err:P0001:%'
      else p_got = p_want
    end, false);
begin
  insert into test.results(label, ok, got, want) values (p_label, v_ok, p_got, p_want);
  if v_ok then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

-- 呼んだ人の権限（RLS が効く）で SQL を1つ流し、影響した行数を返して必ず巻き戻す
--   ok:<行数> / err:<SQLSTATE>:<メッセージ>
create or replace function test.try(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v_n bigint;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception 'test_rollback' using errcode = 'TR001', detail = v_n::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼んだ人の権限で、値を1つ返す SQL（RPC の呼び出し・件数）を流し、値を返して必ず巻き戻す
--   ok:<値> / err:<SQLSTATE>:<メッセージ>
create or replace function test.val(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v text;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    execute p_sql into v;
    raise exception 'test_rollback' using errcode = 'TR001', detail = coalesce(v, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼んだ人の権限で SQL を順に流し、最後に p_probe の値を返して必ず巻き戻す
create or replace function test.flow(p_sqls text[], p_probe text)
returns text language plpgsql security invoker as $$
declare
  s text;
  v text;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    foreach s in array p_sqls loop
      execute s;
    end loop;
    execute p_probe into v;
    raise exception 'test_rollback' using errcode = 'TR001', detail = coalesce(v, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼んだ人の視点で、指定した組織の行が何行見えるか（読めなければ err:<SQLSTATE>）
create or replace function test.cnt(p_table text, p_org uuid)
returns text language plpgsql security invoker as $$
declare
  v bigint;
begin
  execute format('select count(*) from public.%I where org_id = %L', p_table, p_org) into v;
  return v::text;
exception when others then
  return 'err:' || sqlstate;
end $$;

-- 表ごとの見える行数をまとめて確かめる。p_spec は「表=chg|same:行数」をカンマで区切って並べる
--   label は <chg|same>_<人>_rows_<表>
create or replace function test.rows(p_who text, p_org uuid, p_spec text)
returns void language plpgsql security invoker as $$
declare
  v_item text;
  v_tbl text;
  v_kind text;
  v_want text;
begin
  foreach v_item in array string_to_array(p_spec, ',') loop
    v_item := btrim(v_item);
    v_tbl  := split_part(v_item, '=', 1);
    v_kind := split_part(split_part(v_item, '=', 2), ':', 1);
    v_want := split_part(split_part(v_item, '=', 2), ':', 2);
    perform test.check(v_kind || '_' || p_who || '_rows_' || v_tbl, test.cnt(v_tbl, p_org), v_want);
  end loop;
end $$;

-- 見る対象の表ぜんぶで、指定した組織の行が何行見えるか
create or replace function test.all_rows(p_org uuid)
returns text language plpgsql security invoker as $$
declare
  t text;
  n bigint;
  v bigint := 0;
begin
  foreach t in array array['tasks', 'milestones', 'spaces', 'meetings', 'meeting_participants', 'discussion_items',
                           'task_relations', 'task_owners', 'task_events', 'reviews', 'wiki_pages', 'task_comments',
                           'wiki_page_versions', 'meeting_transcripts', 'meeting_drafts', 'task_publications',
                           'milestone_publications', 'wiki_page_publications', 'review_approvals'] loop
    execute format('select count(*) from public.%I where org_id = %L', t, p_org) into n;
    v := v + n;
  end loop;
  return v::text;
end $$;

-- 11 表と wiki の版・公開への代表的な書き込み（insert は S1 に1行・update / delete は S1 の既存の1行）
create or replace function test.write_sql(p_table text, p_op text, p_uid uuid)
returns text language plpgsql stable as $$
declare
  o1 uuid := test.id('O1');
  s1 uuid := test.id('S1');
begin
  return case p_table || ':' || p_op
    when 'tasks:insert' then format(
      'insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L)', o1, s1, 'w', 'todo', p_uid)
    when 'tasks:update' then format('update public.tasks set title = %L where id = %L', 'w', test.id('T_del'))
    when 'tasks:delete' then format('delete from public.tasks where id = %L', test.id('T_del'))
    when 'milestones:insert' then format(
      'insert into public.milestones(org_id, space_id, name) values (%L, %L, %L)', o1, s1, 'w')
    when 'milestones:update' then format('update public.milestones set name = %L where id = %L', 'w', test.id('M1'))
    when 'milestones:delete' then format('delete from public.milestones where id = %L', test.id('M1'))
    when 'meetings:insert' then format(
      'insert into public.meetings(org_id, space_id, title, held_at, created_by) values (%L, %L, %L, now(), %L)', o1, s1, 'w', p_uid)
    when 'meetings:update' then format('update public.meetings set title = %L where id = %L', 'w', test.id('MT_ip'))
    when 'meetings:delete' then format('delete from public.meetings where id = %L', test.id('MT_ip'))
    when 'reviews:insert' then format(
      'insert into public.reviews(org_id, space_id, task_id, created_by) values (%L, %L, %L, %L)', o1, s1, test.id('T_del'), p_uid)
    when 'reviews:update' then format('update public.reviews set updated_at = now() where id = %L', test.id('R_rev'))
    when 'reviews:delete' then format('delete from public.reviews where id = %L', test.id('R_rev'))
    when 'task_owners:insert' then format(
      'insert into public.task_owners(org_id, space_id, task_id, side, user_id) values (%L, %L, %L, %L, %L)',
      o1, s1, test.id('T_del'), 'internal', test.id('u_nm'))
    when 'task_owners:update' then format('update public.task_owners set side = %L where id = %L', 'internal', test.id('TO1'))
    when 'task_owners:delete' then format('delete from public.task_owners where id = %L', test.id('TO1'))
    when 'task_events:insert' then format(
      'insert into public.task_events(org_id, space_id, task_id, actor_id, action) values (%L, %L, %L, %L, %L)',
      o1, s1, test.id('T_del'), p_uid, 'TEST')
    when 'task_events:update' then format('update public.task_events set action = %L where id = %L', 'TEST', test.id('TE1'))
    when 'task_events:delete' then format('delete from public.task_events where id = %L', test.id('TE1'))
    when 'task_relations:insert' then format(
      'insert into public.task_relations(org_id, space_id, from_task_id, to_task_id, type) values (%L, %L, %L, %L, %L)',
      o1, s1, test.id('T_del'), test.id('T_cb'), 'related')
    when 'task_relations:update' then format('update public.task_relations set type = %L where id = %L', 'related', test.id('TR1'))
    when 'task_relations:delete' then format('delete from public.task_relations where id = %L', test.id('TR1'))
    when 'wiki_pages:insert' then format(
      'insert into public.wiki_pages(org_id, space_id, title, created_by, updated_by) values (%L, %L, %L, %L, %L)', o1, s1, 'w', p_uid, p_uid)
    when 'wiki_pages:update' then format('update public.wiki_pages set title = %L where id = %L', 'w', test.id('W_pub'))
    when 'wiki_pages:delete' then format('delete from public.wiki_pages where id = %L', test.id('W_pub'))
    when 'discussion_items:insert' then format(
      'insert into public.discussion_items(org_id, space_id, milestone_id, title, status, next_owner, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
      o1, s1, test.id('M1'), 'w', 'open', 'dev', p_uid)
    when 'discussion_items:update' then format('update public.discussion_items set title = %L where id = %L', 'w', test.id('DI1'))
    when 'discussion_items:delete' then format('delete from public.discussion_items where id = %L', test.id('DI1'))
    when 'meeting_participants:insert' then format(
      'insert into public.meeting_participants(org_id, space_id, meeting_id, user_id, side) values (%L, %L, %L, %L, %L)',
      o1, s1, test.id('MT_pl'), test.id('u_nm'), 'internal')
    when 'meeting_participants:update' then format('update public.meeting_participants set side = side where id = %L', test.id('MTP1'))
    when 'meeting_participants:delete' then format('delete from public.meeting_participants where id = %L', test.id('MTP1'))
    when 'spaces:insert' then format('insert into public.spaces(org_id, type, name) values (%L, %L, %L)', o1, 'project', 'w')
    when 'spaces:update' then format('update public.spaces set name = %L where id = %L', 'w', s1)
    when 'spaces:delete' then format('delete from public.spaces where id = %L', s1)
    when 'wiki_page_versions:insert' then format(
      'insert into public.wiki_page_versions(org_id, page_id, title, body, created_by) values (%L, %L, %L, %L, %L)',
      o1, test.id('W_pub'), 'w', 'b', p_uid)
    when 'wiki_page_versions:update' then format('update public.wiki_page_versions set title = %L where id = %L', 'w', test.id('WV1'))
    when 'wiki_page_versions:delete' then format('delete from public.wiki_page_versions where id = %L', test.id('WV1'))
    when 'wiki_page_publications:insert' then format(
      'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
      o1, test.id('M1'), test.id('W_draft'), 'w', 'b', p_uid)
    when 'wiki_page_publications:update' then format('update public.wiki_page_publications set published_title = %L where id = %L', 'w', test.id('WPP1'))
    when 'wiki_page_publications:delete' then format('delete from public.wiki_page_publications where id = %L', test.id('WPP1'))
  end;
end $$;

-- 11 表 × insert / update / delete の期待をまとめて作る（x = RLS で拒否・d = RLS か確かめるトリガーで拒否・1 = 1 行・0 = 0 行）
create or replace function test.spec11(p_kind text, p_ins text, p_upd text, p_del text)
returns text language sql immutable as $$
  select string_agg(
           format('%1$s:insert=%2$s:%3$s, %1$s:update=%2$s:%4$s, %1$s:delete=%2$s:%5$s', t, p_kind, p_ins, p_upd, p_del),
           ', ' order by o)
  from unnest(array['tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_events', 'task_relations',
                    'wiki_pages', 'discussion_items', 'meeting_participants', 'spaces']) with ordinality as u(t, o);
$$;

-- wiki の版・公開 × insert / update / delete の期待をまとめて作る
create or replace function test.spec_wiki(p_kind text, p_ins text, p_upd text, p_del text)
returns text language sql immutable as $$
  select string_agg(
           format('%1$s:insert=%2$s:%3$s, %1$s:update=%2$s:%4$s, %1$s:delete=%2$s:%5$s', t, p_kind, p_ins, p_upd, p_del),
           ', ' order by o)
  from unnest(array['wiki_page_versions', 'wiki_page_publications']) with ordinality as u(t, o);
$$;

-- 書き込みをまとめて確かめる。p_spec は「表:操作=chg|same:x|1|0」をカンマで区切って並べる
--   label は <chg|same>_<人>_<操作>_<表>
create or replace function test.writes(p_who text, p_uid uuid, p_spec text)
returns void language plpgsql security invoker as $$
declare
  v_item text;
  v_key text;
  v_kind text;
  v_exp text;
begin
  foreach v_item in array string_to_array(p_spec, ',') loop
    v_item := btrim(v_item);
    v_key  := split_part(v_item, '=', 1);
    v_kind := split_part(split_part(v_item, '=', 2), ':', 1);
    v_exp  := split_part(split_part(v_item, '=', 2), ':', 2);
    perform test.check(
      v_kind || '_' || p_who || '_' || split_part(v_key, ':', 2) || '_' || split_part(v_key, ':', 1),
      test.try(test.write_sql(split_part(v_key, ':', 1), split_part(v_key, ':', 2), p_uid)),
      case v_exp when 'x' then 'like:err:42501:%' when 'd' then 'deny' else 'ok:' || v_exp end);
  end loop;
end $$;

-- コメントを1件足す SQL（space を指定しなければ S1）
create or replace function test.comment_sql(p_task uuid, p_actor uuid, p_visibility text, p_space uuid default null)
returns text language sql stable as $$
  select format(
    'insert into public.task_comments(org_id, space_id, task_id, actor_id, body, visibility) values (%L, %L, %L, %L, %L, %L)',
    test.id('O1'), coalesce(p_space, test.id('S1')), p_task, p_actor, 'c', p_visibility);
$$;

-- rpc_pass_ball の呼び出し（受け手の社内担当は呼んだ人自身）
create or replace function test.pass_ball_sql(p_task uuid, p_uid uuid)
returns text language sql immutable as $$
  select format('select public.rpc_pass_ball(%L::uuid, %L, %L::uuid[], %L::uuid[])::text',
                p_task, 'internal', '{}', '{' || p_uid::text || '}');
$$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1'), (:'O2', 'o2');
insert into auth.users(id) values
  (:'u_ed'), (:'u_vw'), (:'u_cli'), (:'u_ven'), (:'u_o2'), (:'u_nm'), (:'u_cli2'),
  (:'u_ic'), (:'u_iv'), (:'u_ce'), (:'u_ca'), (:'u_cv');
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed',   'member'),
  (:'O1', :'u_vw',   'member'),
  (:'O1', :'u_nm',   'member'),
  (:'O1', :'u_cli',  'client'),
  (:'O1', :'u_ven',  'client'),   -- vendor 招待の受諾結果は org=client（20260706004313）
  (:'O1', :'u_cli2', 'client'),
  (:'O1', :'u_ic',   'member'),
  (:'O1', :'u_iv',   'member'),
  (:'O1', :'u_ce',   'client'),
  (:'O1', :'u_ca',   'client'),
  (:'O1', :'u_cv',   'client'),
  (:'O2', :'u_o2',   'owner');
insert into public.spaces(id, org_id, type, name, owner_user_id) values
  (:'S1', :'O1', 'project',  's1', null),
  (:'S2', :'O1', 'project',  's2', null),
  (:'SP', :'O1', 'personal', 'sp', :'u_ed'),
  (:'S3', :'O2', 'project',  's3', null);
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed',   'editor'),
  (:'S1', :'u_vw',   'viewer'),
  (:'S1', :'u_cli',  'client'),
  (:'S1', :'u_ven',  'vendor'),   -- vendor 招待の受諾結果は space=vendor
  (:'S1', :'u_ic',   'client'),
  (:'S1', :'u_iv',   'vendor'),
  (:'S1', :'u_ce',   'editor'),
  (:'S1', :'u_ca',   'admin'),
  (:'S1', :'u_cv',   'viewer'),
  (:'S2', :'u_cli2', 'client'),
  (:'S3', :'u_o2',   'editor');

insert into public.milestones(id, org_id, space_id, name) values
  (:'M1',   :'O1', :'S1', 'm1'),
  (:'M2',   :'O1', :'S1', 'm2'),
  (:'M3',   :'O1', :'S1', 'm3'),
  (:'M_s2', :'O1', :'S2', 'm-s2'),
  (:'M_o2', :'O2', :'S3', 'm-o2');
insert into public.milestone_publications(id, org_id, milestone_id, is_published, published_by) values
  (:'MP1',   :'O1', :'M1',   true, :'u_ed'),
  (:'MP3',   :'O1', :'M3',   true, :'u_ed'),
  (:'MP_s2', :'O1', :'M_s2', true, :'u_ed'),
  (:'MP_o2', :'O2', :'M_o2', true, :'u_o2');

insert into public.tasks(id, org_id, space_id, milestone_id, title, status, ball, client_scope, created_by) values
  (:'T_del', :'O1', :'S1', :'M1',   't-del', 'in_progress', 'internal', 'deliverable', :'u_ed'),
  (:'T_int', :'O1', :'S1', :'M1',   't-int', 'todo',        'internal', 'internal',    :'u_ed'),
  (:'T_cb',  :'O1', :'S1', null,    't-cb',  'todo',        'client',   'deliverable', :'u_ed'),
  (:'T_rev', :'O1', :'S1', :'M2',   't-rev', 'in_progress', 'internal', 'deliverable', :'u_ed'),
  (:'T_s2',  :'O1', :'S2', :'M_s2', 't-s2',  'todo',        'internal', 'deliverable', :'u_ed'),
  (:'T_o2',  :'O2', :'S3', :'M_o2', 't-o2',  'todo',        'internal', 'deliverable', :'u_o2');

insert into public.wiki_pages(id, org_id, space_id, title, created_by, updated_by) values
  (:'W_pub',   :'O1', :'S1', 'w-pub',   :'u_ed', :'u_ed'),
  (:'W_draft', :'O1', :'S1', 'w-draft', :'u_ed', :'u_ed'),
  (:'W_off',   :'O1', :'S1', 'w-off',   :'u_ed', :'u_ed'),
  (:'W_s2',    :'O1', :'S2', 'w-s2',    :'u_ed', :'u_ed'),
  (:'W_o2',    :'O2', :'S3', 'w-o2',    :'u_o2', :'u_o2');
insert into public.wiki_page_publications(id, org_id, milestone_id, source_page_id, published_title, published_body, published_by) values
  (:'WPP1',   :'O1', :'M1',   :'W_pub', 'w-pub', 'body', :'u_ed'),
  (:'WPP3',   :'O1', :'M3',   :'W_off', 'w-off', 'body', :'u_ed'),
  (:'WPP_s2', :'O1', :'M_s2', :'W_s2',  'w-s2',  'body', :'u_ed');
-- M3 は公開を取り下げた（W_off は公開済みではなくなる）
update public.milestone_publications set is_published = false where id = :'MP3';
insert into public.wiki_page_versions(id, org_id, page_id, title, body, created_by) values
  (:'WV1', :'O1', :'W_pub', 'w-pub', 'v1', :'u_ed');

insert into public.meetings(id, org_id, space_id, title, held_at, status, notes, created_by) values
  (:'MT_pl', :'O1', :'S1', 'mt-planned',     now(), 'planned',     'internal memo', :'u_ed'),
  (:'MT_ip', :'O1', :'S1', 'mt-in-progress', now(), 'in_progress', null,            :'u_ed'),
  (:'MT_en', :'O1', :'S1', 'mt-ended',       now(), 'ended',       null,            :'u_ed'),
  (:'MT_s2', :'O1', :'S2', 'mt-s2',          now(), 'ended',       null,            :'u_ed'),
  (:'MT_o2', :'O2', :'S3', 'mt-o2',          now(), 'ended',       null,            :'u_o2');
insert into public.meeting_participants(id, org_id, space_id, meeting_id, user_id, side) values
  (:'MTP1', :'O1', :'S1', :'MT_ip', :'u_cli', 'client'),
  (:'MTP2', :'O1', :'S1', :'MT_en', :'u_ed',  'internal'),
  (:'MTP3', :'O1', :'S1', :'MT_en', :'u_vw',  'internal'),
  (:'MTP4', :'O1', :'S1', :'MT_en', :'u_cli', 'client');
insert into public.meeting_transcripts(org_id, meeting_id, provider, raw_text) values
  (:'O1', :'MT_en', 'manual', 'text');
insert into public.meeting_drafts(org_id, meeting_id, draft_json, created_by, status) values
  (:'O1', :'MT_en', '{}'::jsonb, :'u_ed', 'draft');

insert into public.discussion_items(id, org_id, space_id, milestone_id, title, status, next_owner, created_by) values
  (:'DI1', :'O1', :'S1', :'M1', 'di', 'open', 'dev', :'u_ed');
insert into public.task_relations(id, org_id, space_id, from_task_id, to_task_id, type) values
  (:'TR1', :'O1', :'S1', :'T_del', :'T_int', 'related');
insert into public.task_owners(id, org_id, space_id, task_id, side, user_id) values
  (:'TO1', :'O1', :'S1', :'T_del', 'internal', :'u_ed');
insert into public.task_events(id, org_id, space_id, task_id, actor_id, action) values
  (:'TE1', :'O1', :'S1', :'T_del', :'u_ed', 'CREATED');
insert into public.reviews(id, org_id, space_id, task_id, status, created_by) values
  (:'R_rev', :'O1', :'S1', :'T_rev', 'open', :'u_ed'),
  (:'R_int', :'O1', :'S1', :'T_int', 'open', :'u_ed');
insert into public.review_approvals(org_id, review_id, reviewer_id, state) values
  (:'O1', :'R_rev', :'u_ed', 'pending'),
  (:'O1', :'R_rev', :'u_vw', 'pending'),
  (:'O1', :'R_int', :'u_ed', 'pending');
insert into public.task_publications(id, org_id, task_id, milestone_id, published_by) values
  (:'TP1', :'O1', :'T_del', :'M1', :'u_ed');
insert into public.task_comments(id, org_id, space_id, task_id, actor_id, body, visibility) values
  (:'C_int',     :'O1', :'S1', :'T_del', :'u_ed',  'c', 'internal'),
  (:'C_cli',     :'O1', :'S1', :'T_del', :'u_cli', 'c', 'client'),
  (:'C_ven',     :'O1', :'S1', :'T_del', :'u_ed',  'c', 'vendor'),
  (:'C_ag',      :'O1', :'S1', :'T_del', :'u_ed',  'c', 'agency_only'),
  (:'C_cli_int', :'O1', :'S1', :'T_int', :'u_ed',  'c', 'client'),
  (:'C_ven_cb',  :'O1', :'S1', :'T_cb',  :'u_ed',  'c', 'vendor');
insert into public.scheduling_proposals(id, org_id, space_id, title, created_by, status) values
  (:'PR_vw', :'O1', :'S1', 'p-vw', :'u_vw', 'open'),
  (:'PR_ed', :'O1', :'S1', 'p-ed', :'u_ed', 'open');

-- -----------------------------------------------------------------------------
-- ed: 社内の編集者（O1 member・S1 editor）
-- -----------------------------------------------------------------------------
\echo '== ed: internal editor (O1 member, S1 editor) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);

select test.rows('ed', :'O1',
  'tasks=same:5, milestones=same:4, spaces=same:3, meetings=same:4, meeting_participants=same:4, '
  'discussion_items=same:1, task_relations=same:1, task_owners=same:1, task_events=same:1, reviews=same:2, '
  'wiki_pages=same:4, task_comments=same:6, wiki_page_versions=same:1, meeting_transcripts=same:1, '
  'meeting_drafts=same:1, task_publications=same:1, milestone_publications=same:3, '
  'wiki_page_publications=same:3, review_approvals=same:3');
select test.writes('ed', :'u_ed', test.spec11('same', '1', '1', '1') || ', ' || test.spec_wiki('same', '1', '1', '1'));

-- meetings.notes は列ごと読めない・書けない（notes 以外の列は読める・書ける）
select test.check('same_ed_meetings_read_listed_columns',
  test.val('select count(*)::text from (select id, title, status, minutes_md, summary_body from public.meetings) s'), 'like:ok:%');
select test.check('same_ed_meeting_list_columns', test.val(format(
  'select count(*)::text from (select %s from public.meetings) s', :'meeting_list_columns')), 'like:ok:%');
select test.check('same_ed_meeting_list_participants_embed', test.val(
  'select count(*)::text from (select * from public.meeting_participants) s'), 'like:ok:%');
select test.check('same_ed_meeting_detail_columns', test.val(format(
  'select count(*)::text from (select %s from public.meetings) s', :'meeting_detail_columns')), 'like:ok:%');
select test.check('chg_ed_meetings_read_notes', test.val('select count(notes)::text from public.meetings'), 'like:err:42501:%');
select test.check('chg_ed_meetings_read_all_columns', test.val('select count(*)::text from (select * from public.meetings) s'), 'like:err:42501:%');
select test.check('chg_ed_meetings_insert_with_notes', test.try(format(
  'insert into public.meetings(org_id, space_id, title, held_at, notes, created_by) values (%L, %L, %L, now(), %L, %L)',
  :'O1', :'S1', 'w', 'memo', :'u_ed')), 'like:err:42501:%');
select test.check('chg_ed_meetings_update_notes', test.try(format(
  'update public.meetings set notes = %L where id = %L', 'memo', :'MT_pl')), 'like:err:42501:%');
select test.check('same_ed_meetings_update_listed_columns', test.try(format(
  'update public.meetings set title = %L, minutes_md = %L where id = %L', 'w', 'm', :'MT_pl')), 'ok:1');

-- task_comments
select test.check('same_ed_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_ed', 'internal')), 'ok:1');

-- 変更系の RPC は社内の編集者なら通る
select test.check('same_ed_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_ed')), 'like:ok:%');
select test.check('same_ed_rpc_review_approve', test.val(format(
  'select public.rpc_review_approve(%L::uuid)::text', :'T_rev')), 'like:ok:%');
select test.check('same_ed_rpc_review_block', test.val(format(
  'select public.rpc_review_block(%L::uuid, %L)::text', :'T_rev', 'r')), 'like:ok:%');
select test.check('same_ed_rpc_review_cancel', test.val(format(
  'select public.rpc_review_cancel(%L::uuid)::text', :'R_rev')), 'like:ok:%');
select test.check('same_ed_rpc_meeting_start', test.val(format(
  'select public.rpc_meeting_start(%L::uuid)::text', :'MT_pl')), 'like:ok:%');
select test.check('same_ed_rpc_meeting_end', test.val(format(
  'select public.rpc_meeting_end(%L::uuid)::text', :'MT_ip')), 'like:ok:%');
select test.check('same_ed_rpc_set_spec_state_passes_guard', test.val(format(
  'select public.rpc_set_spec_state(%L::uuid, %L)::text', :'T_del', 'decided')), 'like:err:P0001:Only spec tasks%');
select test.check('same_ed_rpc_decide_considering', test.val(format(
  'select public.rpc_decide_considering(%L::uuid, %L, %L, %L)::text', :'T_del', 'd', 'internal', 'meeting')), 'like:ok:%');
select test.check('same_ed_rpc_generate_meeting_minutes', test.val(format(
  'select (public.rpc_generate_meeting_minutes(%L::uuid) ? %L)::text', :'MT_en', 'email_subject')), 'ok:true');
select test.check('same_ed_rpc_parse_meeting_minutes', test.val(format(
  'select public.rpc_parse_meeting_minutes(%L::uuid, %L)::text', :'MT_en', 'memo')), 'like:ok:%');
select test.check('same_ed_rpc_get_minutes_preview', test.val(format(
  'select public.rpc_get_minutes_preview(%L::uuid, %L)::text', :'MT_en', 'memo')), 'like:ok:%');
select test.check('same_ed_rpc_invoke_meeting_minutes_email', test.val(format(
  'select public.rpc_invoke_meeting_minutes_email(%L::uuid)::text', :'MT_en')), 'like:ok:%');
select test.check('same_ed_rpc_confirm_proposal_slot_passes_guard', test.val(format(
  'select public.rpc_confirm_proposal_slot(%L::uuid, gen_random_uuid()) ->> %L', :'PR_ed', 'error')), 'ok:slot_not_found');
select test.check('same_ed_rpc_review_open', test.val(format(
  'select public.rpc_review_open(%L::uuid, %L::uuid[])::text', :'T_del', '{' || :'u_ed' || '}')), 'like:ok:%');
select test.check('same_ed_rpc_apply_preset_passes_guard', test.val(format(
  'select public.rpc_apply_preset_to_space(%L::uuid, %L) ->> %L', :'S1', 'blank', 'error')), 'ok:space_not_empty');
select test.check('chg_ed_check_and_update_milestone_not_callable', test.val(format(
  'select public.check_and_update_milestone(%L::uuid)::text', :'M2')), 'like:err:42501:%');

-- トリガー: 未承認のレビューがあれば完了にできない・承認後に完了にするとマイルストーンが完了になる
select test.check('same_ed_review_gate_blocks_done', test.try(format(
  'update public.tasks set status = %L where id = %L', 'done', :'T_rev')), 'like:err:23514:%');
select test.check('same_ed_milestone_completes_after_approval', test.flow(
  array[format('update public.reviews set status = %L where id = %L', 'approved', :'R_rev'),
        format('update public.tasks set status = %L where id = %L', 'done', :'T_rev')],
  format('select (completed_at is not null)::text from public.milestones where id = %L', :'M2')), 'ok:true');

-- マイルストーン: tasks / meetings は同じ space のものだけ
select test.check('chg_ed_task_milestone_other_space', test.try(format(
  'update public.tasks set milestone_id = %L where id = %L', :'M_s2', :'T_cb')), 'like:err:P0001:%same space%');
select test.check('chg_ed_task_milestone_other_org', test.try(format(
  'update public.tasks set milestone_id = %L where id = %L', :'M_o2', :'T_cb')), 'like:err:P0001:%same space%');
select test.check('chg_ed_task_insert_milestone_other_space', test.try(format(
  'insert into public.tasks(org_id, space_id, milestone_id, title, status, created_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'S1', :'M_s2', 'w', 'todo', :'u_ed')), 'like:err:P0001:%same space%');
select test.check('chg_ed_meeting_milestone_other_space', test.try(format(
  'update public.meetings set milestone_id = %L where id = %L', :'M_s2', :'MT_pl')), 'like:err:P0001:%same space%');
select test.check('same_ed_meeting_milestone_same_space', test.try(format(
  'update public.meetings set milestone_id = %L where id = %L', :'M1', :'MT_pl')), 'ok:1');
select test.check('same_ed_task_milestone_same_space_completes', test.flow(
  array[format('update public.tasks set milestone_id = %L where id = %L', :'M2', :'T_cb'),
        format('update public.reviews set status = %L where id = %L', 'approved', :'R_rev'),
        format('update public.tasks set status = %L where id in (%L, %L)', 'done', :'T_rev', :'T_cb')],
  format('select (completed_at is not null)::text from public.milestones where id = %L', :'M2')), 'ok:true');

select test.check('chg_ed_wiki_publication_milestone_other_space', test.try(format(
  'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'M_s2', :'W_draft', 'w', 'b', :'u_ed')), 'like:err:P0001:%same org and space%');

-- 個人 space: 持ち主は書ける
select test.check('same_ed_personal_space_own_insert', test.try(format(
  'insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L)',
  :'O1', :'SP', 'p', 'todo', :'u_ed')), 'ok:1');
commit;

-- -----------------------------------------------------------------------------
-- vw: 社内の閲覧者（O1 member・S1 viewer）… 読むのは編集者と同じ・11 表・wiki の版と公開・変更系 RPC は書けない・コメントは書ける
-- -----------------------------------------------------------------------------
\echo '== vw: internal viewer (O1 member, S1 viewer) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_vw', true);

select test.rows('vw', :'O1',
  'tasks=same:5, milestones=same:4, spaces=same:3, meetings=same:4, meeting_participants=same:4, '
  'discussion_items=same:1, task_relations=same:1, task_owners=same:1, task_events=same:1, reviews=same:2, '
  'wiki_pages=same:4, task_comments=same:6, wiki_page_versions=same:1, meeting_transcripts=same:1, '
  'meeting_drafts=same:1, task_publications=same:1, milestone_publications=same:3, '
  'wiki_page_publications=same:3, review_approvals=same:3');
-- 新しい space を作るのは組織の操作（その組織の社内メンバー）
select test.writes('vw', :'u_vw',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:1')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));

select test.check('same_vw_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_vw', 'internal')), 'ok:1');

-- 変更系の RPC 13 本は社内の編集者だけ
select test.check('chg_vw_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_vw')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_review_approve', test.val(format(
  'select public.rpc_review_approve(%L::uuid)::text', :'T_rev')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_review_block', test.val(format(
  'select public.rpc_review_block(%L::uuid, %L)::text', :'T_rev', 'r')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_review_cancel', test.val(format(
  'select public.rpc_review_cancel(%L::uuid)::text', :'R_rev')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_meeting_start', test.val(format(
  'select public.rpc_meeting_start(%L::uuid)::text', :'MT_pl')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_meeting_end', test.val(format(
  'select public.rpc_meeting_end(%L::uuid)::text', :'MT_ip')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_set_spec_state', test.val(format(
  'select public.rpc_set_spec_state(%L::uuid, %L)::text', :'T_del', 'decided')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_decide_considering', test.val(format(
  'select public.rpc_decide_considering(%L::uuid, %L, %L, %L)::text', :'T_del', 'd', 'internal', 'meeting')),
  'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_generate_meeting_minutes', test.val(format(
  'select public.rpc_generate_meeting_minutes(%L::uuid)::text', :'MT_en')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_parse_meeting_minutes', test.val(format(
  'select public.rpc_parse_meeting_minutes(%L::uuid, %L)::text', :'MT_en', 'memo')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_get_minutes_preview', test.val(format(
  'select public.rpc_get_minutes_preview(%L::uuid, %L)::text', :'MT_en', 'memo')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_invoke_meeting_minutes_email', test.val(format(
  'select public.rpc_invoke_meeting_minutes_email(%L::uuid)::text', :'MT_en')), 'like:err:P0001:Not authorized%');
select test.check('chg_vw_rpc_confirm_proposal_slot', test.val(format(
  'select public.rpc_confirm_proposal_slot(%L::uuid, gen_random_uuid()) ->> %L', :'PR_vw', 'error')), 'ok:not_authorized');
-- rpc_review_open は space の admin / editor だけ（本 migration では変えない）
select test.check('same_vw_rpc_review_open', test.val(format(
  'select public.rpc_review_open(%L::uuid, %L::uuid[])::text', :'T_del', '{' || :'u_ed' || '}')),
  'like:err:P0001:Insufficient permissions%');
commit;

-- -----------------------------------------------------------------------------
-- nm: space の役割が無い社内メンバー（O1 member）… editor として扱う
-- -----------------------------------------------------------------------------
\echo '== nm: internal member without a space role (treated as editor) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_nm', true);

select test.rows('nm', :'O1', 'tasks=same:5, meetings=same:4, task_owners=same:1, wiki_pages=same:4, task_comments=chg:6');
select test.writes('nm', :'u_nm', test.spec11('same', '1', '1', '1') || ', ' || test.spec_wiki('same', '1', '1', '1'));
-- task_comments も他の space の表と同じく、社内メンバーは space の役割が無くても読める・書ける
select test.check('chg_nm_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_nm', 'internal')), 'ok:1');
-- 個人 space: 持ち主以外は書けない（enforce_personal_task_rules）
select test.check('same_nm_personal_space_other_insert', test.try(format(
  'insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L)',
  :'O1', :'SP', 'p', 'todo', :'u_nm')), 'like:err:P0001:Cannot write to another user personal space%');
commit;

-- -----------------------------------------------------------------------------
-- cli: 相手先（O1 client・S1 client）
-- -----------------------------------------------------------------------------
\echo '== cli: client (O1 client, S1 client) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_cli', true);

select test.rows('cli', :'O1',
  'tasks=same:3, milestones=same:3, spaces=same:1, meetings=chg:2, meeting_participants=chg:0, '
  'discussion_items=chg:0, task_relations=chg:0, task_owners=chg:0, task_events=chg:0, reviews=chg:1, '
  'wiki_pages=chg:1, task_comments=chg:1, wiki_page_versions=chg:0, meeting_transcripts=chg:0, '
  'meeting_drafts=chg:0, task_publications=chg:0, milestone_publications=chg:1, '
  'wiki_page_publications=chg:1, review_approvals=chg:2');

-- どの行が見えるか
select test.check('same_cli_tasks_internal_scope_hidden', test.val(format(
  'select count(*)::text from public.tasks where id = %L', :'T_int')), 'ok:0');
select test.check('chg_cli_meetings_planned_hidden', test.val(format(
  'select count(*)::text from public.meetings where id = %L', :'MT_pl')), 'ok:0');
select test.check('same_cli_meetings_ended_visible', test.val(format(
  'select count(*)::text from public.meetings where id = %L', :'MT_en')), 'ok:1');
select test.check('chg_cli_meetings_read_notes', test.val('select count(notes)::text from public.meetings'), 'like:err:42501:%');
select test.check('same_cli_meetings_read_listed_columns', test.val(
  'select count(*)::text from (select id, title from public.meetings) s'), 'like:ok:%');
select test.check('same_cli_portal_meeting_columns', test.val(format(
  'select count(*)::text from (select %s from public.meetings) s', :'portal_meeting_columns')), 'like:ok:%');
select test.check('chg_cli_wiki_draft_hidden', test.val(format(
  'select count(*)::text from public.wiki_pages where id = %L', :'W_draft')), 'ok:0');
select test.check('chg_cli_wiki_unpublished_milestone_hidden', test.val(format(
  'select count(*)::text from public.wiki_pages where id = %L', :'W_off')), 'ok:0');
select test.check('same_cli_wiki_published_visible', test.val(format(
  'select count(*)::text from public.wiki_pages where id = %L', :'W_pub')), 'ok:1');
select test.check('same_cli_wiki_other_space_hidden', test.val(format(
  'select count(*)::text from public.wiki_pages where id = %L', :'W_s2')), 'ok:0');
select test.check('chg_cli_comments_internal_hidden', test.val(format(
  'select count(*)::text from public.task_comments where id = %L', :'C_int')), 'ok:0');
select test.check('same_cli_comments_client_visible', test.val(format(
  'select count(*)::text from public.task_comments where id = %L', :'C_cli')), 'ok:1');
select test.check('chg_cli_comments_on_hidden_task_hidden', test.val(format(
  'select count(*)::text from public.task_comments where id = %L', :'C_cli_int')), 'ok:0');
select test.check('chg_cli_review_on_hidden_task_hidden', test.val(format(
  'select count(*)::text from public.reviews where id = %L', :'R_int')), 'ok:0');
select test.check('same_cli_review_on_visible_task_visible', test.val(format(
  'select count(*)::text from public.reviews where id = %L', :'R_rev')), 'ok:1');
-- ポータルの Wiki の読み方（公開・自分の space・公開済みのマイルストーン）
select test.check('same_cli_portal_wiki_query', test.val(format(
  'select count(*)::text from public.wiki_page_publications p join public.wiki_pages w on w.id = p.source_page_id '
  'join public.milestone_publications mp on mp.milestone_id = p.milestone_id '
  'where p.org_id = %L and mp.is_published and w.space_id = %L', :'O1', :'S1')), 'ok:1');

-- ポータルのサーバー側が相手先のセッションのまま行う読み書き（本 migration では変えない）
--   同じ space のメンバーの役割を読める（差し戻し先の担当者を決める resolveReturnAssignee の読み方）
select test.check('same_cli_space_memberships_same_space_rows', test.val(format(
  'select count(*)::text from public.space_memberships where space_id = %L', :'S1')), 'ok:9');
select test.check('same_cli_space_memberships_assignee_role', test.val(format(
  'select role from public.space_memberships where space_id = %L and user_id = %L', :'S1', :'u_ed')), 'ok:editor');
select test.check('same_cli_space_memberships_other_space_hidden', test.val(format(
  'select count(*)::text from public.space_memberships where space_id = %L', :'S2')), 'ok:0');
select test.check('same_cli_org_memberships_own_row', test.val(format(
  'select count(*)::text from public.org_memberships where org_id = %L and user_id = %L', :'O1', :'u_cli')), 'ok:1');
--   監査ログを書ける（createAuditLog と同じ列）
select test.check('same_cli_audit_logs_insert', test.try(format(
  'insert into public.audit_logs(org_id, space_id, actor_id, actor_role, event_type, target_type, target_id, summary, '
  'data_before, data_after, metadata, visibility, occurred_at) '
  'values (%L, %L, %L, %L, %L, %L, %L, %L, null, null, null, %L, now())',
  :'O1', :'S1', :'u_cli', 'client', 'approval.approved', 'task', :'T_del', 'approved', 'client')), 'ok:1');

-- 書き込み: 11 表・wiki の版と公開とも書けない（spaces の新規作成は組織の社内メンバーだけ）
select test.writes('cli', :'u_cli',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:x')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));

-- task_comments: 見えるタスクに 'client' だけ・自分の名前だけ・直す消すは自分のだけ
select test.check('same_cli_comment_insert_client', test.try(test.comment_sql(:'T_del', :'u_cli', 'client')), 'ok:1');
select test.check('chg_cli_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_cli', 'internal')), 'like:err:42501:%');
select test.check('chg_cli_comment_insert_on_hidden_task', test.try(test.comment_sql(:'T_int', :'u_cli', 'client')), 'like:err:42501:%');
select test.check('same_cli_comment_insert_as_other', test.try(test.comment_sql(:'T_del', :'u_ed', 'client')), 'like:err:42501:%');
select test.check('same_cli_comment_update_own_body', test.try(format(
  'update public.task_comments set body = %L where id = %L', 'edited', :'C_cli')), 'ok:1');
select test.check('chg_cli_comment_update_own_to_internal', test.try(format(
  'update public.task_comments set visibility = %L where id = %L', 'internal', :'C_cli')), 'like:err:42501:%');
select test.check('same_cli_comment_update_others', test.try(format(
  'update public.task_comments set body = %L where id = %L', 'edited', :'C_int')), 'ok:0');
select test.check('same_cli_comment_delete_own', test.try(format(
  'delete from public.task_comments where id = %L', :'C_cli')), 'ok:1');

-- RPC
select test.check('chg_cli_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_ed')), 'like:err:P0001:Not authorized%');
select test.check('chg_cli_rpc_meeting_end', test.val(format(
  'select public.rpc_meeting_end(%L::uuid)::text', :'MT_ip')), 'like:err:P0001:Not authorized%');
select test.check('chg_cli_rpc_decide_considering', test.val(format(
  'select public.rpc_decide_considering(%L::uuid, %L, %L, %L)::text', :'T_del', 'd', 'client', 'meeting')),
  'like:err:P0001:Not authorized%');
-- 会議の参加者でも、議事録の生成・メール送信の RPC は社内の編集者だけ
select test.check('chg_cli_rpc_generate_meeting_minutes', test.val(format(
  'select public.rpc_generate_meeting_minutes(%L::uuid)::text', :'MT_en')), 'like:err:P0001:Not authorized%');
select test.check('chg_cli_rpc_invoke_meeting_minutes_email', test.val(format(
  'select public.rpc_invoke_meeting_minutes_email(%L::uuid)::text', :'MT_en')), 'like:err:P0001:Not authorized%');
select test.check('same_cli_create_task_notification_not_callable', test.val(format(
  'select public._create_task_notification(%L::uuid, %L::uuid, %L::uuid, %L, %L, %L::jsonb)::text',
  :'O1', :'S1', :'u_ed', 'x', 'k', '{}')), 'like:err:42501:%');
select test.check('same_cli_rpc_review_open', test.val(format(
  'select public.rpc_review_open(%L::uuid, %L::uuid[])::text', :'T_del', '{' || :'u_ed' || '}')),
  'like:err:P0001:Insufficient permissions%');
commit;

-- -----------------------------------------------------------------------------
-- ven: vendor（O1 client・S1 vendor）
-- -----------------------------------------------------------------------------
\echo '== ven: vendor (O1 client, S1 vendor) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ven', true);

select test.rows('ven', :'O1',
  'tasks=same:2, milestones=same:3, spaces=same:1, meetings=chg:2, meeting_participants=chg:0, '
  'discussion_items=chg:0, task_relations=chg:0, task_owners=chg:0, task_events=chg:0, reviews=chg:1, '
  'wiki_pages=chg:1, task_comments=chg:1, wiki_page_versions=chg:0, meeting_transcripts=chg:0, '
  'meeting_drafts=chg:0, task_publications=chg:0, milestone_publications=chg:1, '
  'wiki_page_publications=chg:1, review_approvals=chg:2');
select test.check('same_ven_tasks_client_ball_hidden', test.val(format(
  'select count(*)::text from public.tasks where id = %L', :'T_cb')), 'ok:0');
select test.check('chg_ven_tasks_update_status', test.try(format(
  'update public.tasks set status = %L where id = %L', 'done', :'T_del')), 'ok:0');
select test.writes('ven', :'u_ven',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:x')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));

select test.check('same_ven_comment_insert_vendor', test.try(test.comment_sql(:'T_del', :'u_ven', 'vendor')), 'ok:1');
select test.check('chg_ven_comment_insert_client', test.try(test.comment_sql(:'T_del', :'u_ven', 'client')), 'like:err:42501:%');
select test.check('chg_ven_comment_insert_on_hidden_task', test.try(test.comment_sql(:'T_cb', :'u_ven', 'vendor')), 'like:err:42501:%');
select test.check('chg_ven_comments_client_hidden', test.val(format(
  'select count(*)::text from public.task_comments where id = %L', :'C_cli')), 'ok:0');
select test.check('same_ven_comments_vendor_visible', test.val(format(
  'select count(*)::text from public.task_comments where id = %L', :'C_ven')), 'ok:1');
commit;

-- -----------------------------------------------------------------------------
-- cli2: 別の相手先（O1 client・S2 client）… 同じ組織でも S1 のものは見えず、書けない
-- -----------------------------------------------------------------------------
\echo '== cli2: another client in the same org (S2 client) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_cli2', true);

select test.rows('cli2', :'O1',
  'tasks=same:1, milestones=same:1, spaces=same:1, meetings=same:1, meeting_participants=same:0, '
  'discussion_items=same:0, task_relations=same:0, task_owners=same:0, task_events=same:0, reviews=same:0, '
  'wiki_pages=same:1, task_comments=same:0, wiki_page_versions=chg:0, meeting_transcripts=chg:0, '
  'meeting_drafts=chg:0, task_publications=chg:0, milestone_publications=chg:1, '
  'wiki_page_publications=chg:1, review_approvals=chg:0');
select test.check('chg_cli2_wiki_publications_other_space_hidden', test.val(format(
  'select count(*)::text from public.wiki_page_publications where id = %L', :'WPP1')), 'ok:0');
select test.check('chg_cli2_milestone_publications_other_space_hidden', test.val(format(
  'select count(*)::text from public.milestone_publications where id = %L', :'MP1')), 'ok:0');
select test.check('same_cli2_wiki_pages_other_space_hidden', test.val(format(
  'select count(*)::text from public.wiki_pages where id = %L', :'W_pub')), 'ok:0');
-- S1 への書き込み・コメント
-- wiki_page_publications の insert は、マイルストーンが公開済みか確かめるトリガーが RLS より先に止めることがある（どちらでも拒否）
select test.writes('cli2', :'u_cli2', test.spec11('same', 'x', '0', '0') || ', '
  || replace(test.spec_wiki('chg', 'x', '0', '0'), 'wiki_page_publications:insert=chg:x', 'wiki_page_publications:insert=chg:d'));
select test.check('same_cli2_comment_insert_s1_task', test.try(test.comment_sql(:'T_del', :'u_cli2', 'client')), 'like:err:42501:%');
select test.check('chg_cli2_comment_insert_own_space_other_task', test.try(
  test.comment_sql(:'T_del', :'u_cli2', 'client', :'S2')), 'like:err:42501:%');
commit;

-- -----------------------------------------------------------------------------
-- o2: 別の組織の社内（O2 owner・S3 editor）… O1 の行は何も見えず、書けない
-- -----------------------------------------------------------------------------
\echo '== o2: internal member of another org =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_o2', true);

select test.check('same_o2_no_o1_rows', test.all_rows(:'O1'), '0');
select test.rows('o2', :'O2', 'tasks=same:1, milestones=same:1, spaces=same:1, meetings=same:1, wiki_pages=same:1');
select test.writes('o2', :'u_o2', test.spec11('same', 'x', '0', '0') || ', '
  || replace(test.spec_wiki('same', 'x', '0', '0'), 'wiki_page_publications:insert=same:x', 'wiki_page_publications:insert=same:d'));
select test.check('same_o2_comment_insert', test.try(test.comment_sql(:'T_del', :'u_o2', 'internal')), 'like:err:42501:%');
select test.check('same_o2_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_o2')), 'like:err:P0001:Not authorized%');
select test.check('chg_o2_rpc_decide_considering', test.val(format(
  'select public.rpc_decide_considering(%L::uuid, %L, %L, %L)::text', :'T_del', 'd', 'internal', 'meeting')),
  'like:err:P0001:Not authorized%');
commit;

-- -----------------------------------------------------------------------------
-- space と組織の対応: space_id の space が org_id の組織のものでない行は、社内でも社内として扱わない
--   O1 の space（S1）を指して org_id を O2 にした行を postgres で入れておく（このブロックのあとで消す）
-- -----------------------------------------------------------------------------
\echo '== space / org mismatch (rows that point at S1 with org_id = O2) =='
insert into public.tasks(id, org_id, space_id, title, status, ball, client_scope, created_by) values
  (:'T_mm', :'O2', :'S1', 't-mm', 'todo', 'internal', 'deliverable', :'u_o2');
insert into public.task_owners(id, org_id, space_id, task_id, side, user_id) values
  (:'TO_mm', :'O2', :'S1', :'T_mm', 'internal', :'u_o2');
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_o2', true);

select test.check('chg_o2_mismatch_insert_tasks', test.try(format(
  'insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L)',
  :'O2', :'S1', 'w', 'todo', :'u_o2')), 'like:err:42501:%');
select test.check('same_o2_mismatch_insert_task_comments', test.try(format(
  'insert into public.task_comments(org_id, space_id, task_id, actor_id, body, visibility) values (%L, %L, %L, %L, %L, %L)',
  :'O2', :'S1', :'T_o2', :'u_o2', 'c', 'internal')), 'like:err:42501:%');
select test.check('chg_o2_mismatch_update_tasks', test.try(format(
  'update public.tasks set title = %L where id = %L', 'w', :'T_mm')), 'ok:0');
select test.check('chg_o2_mismatch_delete_tasks', test.try(format(
  'delete from public.tasks where id = %L', :'T_mm')), 'ok:0');
select test.check('chg_o2_mismatch_read_task_owners', test.val(format(
  'select count(*)::text from public.task_owners where id = %L', :'TO_mm')), 'ok:0');
select test.check('chg_o2_mismatch_update_task_owners', test.try(format(
  'update public.task_owners set side = side where id = %L', :'TO_mm')), 'ok:0');
-- 自分の組織に新しい space を作るのは、組織の社内メンバーなら通る
select test.check('same_o2_insert_own_org_space', test.try(format(
  'insert into public.spaces(org_id, type, name) values (%L, %L, %L)', :'O2', 'project', 'w')), 'ok:1');
commit;
delete from public.tasks where id = :'T_mm';

-- -----------------------------------------------------------------------------
-- 役割の組み合わせ: org は社内で space は client / vendor（ic / iv）・org は client で space は editor / admin / viewer（ce / ca / cv）
--   どれも 11 表・wiki の版と公開・変更系 RPC は書けない
-- -----------------------------------------------------------------------------
\echo '== ic: org member, S1 client =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ic', true);
select test.writes('ic', :'u_ic',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:1')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));
select test.check('chg_ic_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_ic', 'internal')), 'like:err:42501:%');
select test.check('chg_ic_meetings_planned_hidden', test.val(format(
  'select count(*)::text from public.meetings where id = %L', :'MT_pl')), 'ok:0');
select test.check('chg_ic_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_ic')), 'like:err:P0001:Not authorized%');
commit;

\echo '== iv: org member, S1 vendor =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_iv', true);
select test.writes('iv', :'u_iv',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:1')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));
select test.check('chg_iv_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_iv', 'internal')), 'like:err:42501:%');
select test.check('chg_iv_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_iv')), 'like:err:P0001:Not authorized%');
commit;

\echo '== ce: org client, S1 editor =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ce', true);
select test.writes('ce', :'u_ce',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:x')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));
select test.check('chg_ce_comment_insert_internal', test.try(test.comment_sql(:'T_del', :'u_ce', 'internal')), 'like:err:42501:%');
select test.check('chg_ce_meetings_planned_hidden', test.val(format(
  'select count(*)::text from public.meetings where id = %L', :'MT_pl')), 'ok:0');
select test.check('chg_ce_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_ce')), 'like:err:P0001:Not authorized%');
select test.check('chg_ce_rpc_review_open', test.val(format(
  'select public.rpc_review_open(%L::uuid, %L::uuid[])::text', :'T_del', '{' || :'u_ed' || '}')), 'like:err:P0001:Not authorized%');
select test.check('chg_ce_rpc_apply_preset', test.val(format(
  'select public.rpc_apply_preset_to_space(%L::uuid, %L) ->> %L', :'S1', 'blank', 'error')), 'ok:insufficient_permissions');
commit;

\echo '== ca: org client, S1 admin =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ca', true);
select test.writes('ca', :'u_ca',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:x')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));
select test.check('chg_ca_rpc_pass_ball', test.val(test.pass_ball_sql(:'T_del', :'u_ca')), 'like:err:P0001:Not authorized%');
commit;

\echo '== cv: org client, S1 viewer =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_cv', true);
select test.writes('cv', :'u_cv',
  replace(test.spec11('chg', 'x', '0', '0'), 'spaces:insert=chg:x', 'spaces:insert=same:x')
  || ', ' || test.spec_wiki('chg', 'x', '0', '0'));
commit;

-- -----------------------------------------------------------------------------
-- svc: service_role（RLS を通らない）… 承認相当の更新でレビューの確認とマイルストーンの完了が動く・
--   マイルストーンの同じ space の確認は service role にも効く
-- -----------------------------------------------------------------------------
\echo '== svc: service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);

select test.check('same_svc_sees_all_o1_rows', test.all_rows(:'O1'), '49');
select test.check('same_svc_review_gate_blocks_done', test.try(format(
  'update public.tasks set status = %L where id = %L', 'done', :'T_rev')), 'like:err:23514:%');
select test.check('same_svc_milestone_completes_after_approval', test.flow(
  array[format('update public.reviews set status = %L where id = %L', 'approved', :'R_rev'),
        format('update public.tasks set status = %L where id = %L', 'done', :'T_rev')],
  format('select (completed_at is not null)::text from public.milestones where id = %L', :'M2')), 'ok:true');
select test.check('same_svc_rpc_generate_meeting_minutes', test.val(format(
  'select (public.rpc_generate_meeting_minutes(%L::uuid) ? %L)::text', :'MT_en', 'email_subject')), 'ok:true');
select test.check('same_svc_create_task_notification', test.val(format(
  'select public._create_task_notification(%L::uuid, %L::uuid, %L::uuid, %L, %L, %L::jsonb)::text',
  :'O1', :'S1', :'u_ed', 'x', 'k', '{}')), 'ok:');
select test.check('chg_svc_task_milestone_other_space', test.try(format(
  'update public.tasks set milestone_id = %L where id = %L', :'M_s2', :'T_cb')), 'like:err:P0001:%same space%');
select test.check('chg_svc_meeting_insert_milestone_other_space', test.try(format(
  'insert into public.meetings(org_id, space_id, milestone_id, title, held_at, created_by) values (%L, %L, %L, %L, now(), %L)',
  :'O1', :'S1', :'M_s2', 'w', :'u_ed')), 'like:err:P0001:%same space%');
-- wiki_page_publications: マイルストーンと元のページがどちらも行の組織のもので、同じ space にあるときだけ
select test.check('chg_svc_wiki_publication_milestone_other_org', test.try(format(
  'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'M_o2', :'W_draft', 'w', 'b', :'u_ed')), 'like:err:P0001:%same org and space%');
select test.check('chg_svc_wiki_publication_milestone_other_space', test.try(format(
  'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'M_s2', :'W_draft', 'w', 'b', :'u_ed')), 'like:err:P0001:%same org and space%');
select test.check('chg_svc_wiki_publication_page_other_org', test.try(format(
  'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'M1', :'W_o2', 'w', 'b', :'u_ed')), 'like:err:P0001:%same org and space%');
select test.check('chg_svc_wiki_publication_update_page_other_space', test.try(format(
  'update public.wiki_page_publications set source_page_id = %L where id = %L', :'W_s2', :'WPP1')), 'like:err:P0001:%same org and space%');
select test.check('same_svc_wiki_publication_same_space', test.try(format(
  'insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'M1', :'W_draft', 'w', 'b', :'u_ed')), 'ok:1');
commit;

-- -----------------------------------------------------------------------------
-- 二要素認証の RESTRICTIVE ポリシーは置き換えたポリシーにも効く（登録済みで aal1 なら 0 行）
-- -----------------------------------------------------------------------------
\echo '== mfa restrictive policy still applies =='
insert into auth.mfa_factors(user_id, status) values (:'u_ed', 'verified');
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}', true);
select test.check('same_mfa_ed_aal1_tasks', test.cnt('tasks', :'O1'), '0');
select test.check('same_mfa_ed_aal1_meetings', test.cnt('meetings', :'O1'), '0');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select test.check('same_mfa_ed_aal2_tasks', test.cnt('tasks', :'O1'), '5');
commit;
delete from auth.mfa_factors where user_id = :'u_ed';

-- -----------------------------------------------------------------------------
-- 形: 関数・ポリシー・権限・トリガー・索引
-- -----------------------------------------------------------------------------
\echo '== shape =='
-- 役割を見る関数: SECURITY DEFINER・stable・search_path 固定・authenticated / service_role は呼べる・anon は呼べない
select test.check('chg_shape_helpers', (
  select coalesce(string_agg(p.proname || ':definer=' || p.prosecdef || ':volatile=' || p.provolatile::text
           || ':' || coalesce(array_to_string(p.proconfig, ';'), '-')
           || ':auth=' || has_function_privilege('authenticated', p.oid, 'execute')
           || ':svc=' || has_function_privilege('service_role', p.oid, 'execute')
           || ':anon=' || has_function_privilege('anon', p.oid, 'execute'), ',' order by p.proname), '(none)')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('app_space_role_of_caller', 'app_is_space_internal', 'app_can_write_space', 'app_can_write_wiki_page')
), 'app_can_write_space:definer=true:volatile=s:search_path=public:auth=true:svc=true:anon=false,'
   'app_can_write_wiki_page:definer=true:volatile=s:search_path=public:auth=true:svc=true:anon=false,'
   'app_is_space_internal:definer=true:volatile=s:search_path=public:auth=true:svc=true:anon=false,'
   'app_space_role_of_caller:definer=true:volatile=s:search_path=public:auth=true:svc=true:anon=false');
-- 社内として読む・書く判定は、space がその組織のものであることも確かめる
select test.check('chg_shape_helpers_check_space_org', (
  select count(*)::text from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('app_is_space_internal', 'app_can_write_space')
    and prosrc like '%from public.spaces s%' and prosrc like '%s.org_id = p_org%'
), '2');

-- 11 表の書き込みのポリシー: spaces の insert 以外（32 本）は app_can_write_space・spaces の insert は組織の社内メンバー
select test.check('chg_shape_write_policies', (
  select count(*) filter (where coalesce(qual, '') || coalesce(with_check, '') like '%app_can_write_space(%'
                            and coalesce(qual, '') || coalesce(with_check, '') not like '%app_can_access_space(%'
                            and coalesce(qual, '') || coalesce(with_check, '') not like '%app_task_visible_to_caller(%')::text
         || '/' || count(*)::text
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and tablename in ('tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_events', 'task_relations',
                      'wiki_pages', 'discussion_items', 'meeting_participants', 'spaces')
    and not (tablename = 'spaces' and cmd = 'INSERT')
), '32/32');
select test.check('chg_shape_spaces_insert_policy', (
  select with_check from pg_policies
  where schemaname = 'public' and tablename = 'spaces' and policyname = 'spaces_insert_member'
), 'app_is_org_internal(org_id)');
-- wiki の版・公開の書き込み（6 本）は、元のページの space で書ける人だけ
select test.check('chg_shape_wiki_write_policies', (
  select count(*)::text from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and tablename in ('wiki_page_versions', 'wiki_page_publications')
    and coalesce(qual, '') || coalesce(with_check, '') like '%app_can_write_wiki_page(%'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%app_is_org_member(%'
), '6');

-- 読み取りのポリシー: 社内だけの5表は app_is_space_internal・tasks / milestones / spaces は変えない
select test.check('chg_shape_internal_only_select_policies', (
  select count(*)::text from pg_policies
  where schemaname = 'public' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
    and tablename in ('meeting_participants', 'discussion_items', 'task_relations', 'task_owners', 'task_events')
    and qual = 'app_is_space_internal(space_id, org_id)'
), '5');
select test.check('same_shape_unchanged_select_policies', (
  select string_agg(tablename || ':' || qual, ',' order by tablename) from pg_policies
  where schemaname = 'public' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
    and tablename in ('tasks', 'milestones', 'spaces')
), 'milestones:app_can_access_space(space_id, org_id),'
   'spaces:app_can_access_space(id, org_id),'
   'tasks:app_task_visible_to_caller(space_id, org_id, client_scope, ball)');

-- 対象の表の permissive ポリシーの名前（本 migration は同じ名前で置き換える）
select test.check('same_shape_permissive_policy_names', (
  select string_agg(tablename || ':' || cmd || ':' || policyname, ',' order by tablename, cmd, policyname)
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE'
    and tablename in ('tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_events', 'task_relations',
                      'wiki_pages', 'discussion_items', 'meeting_participants', 'spaces', 'task_comments',
                      'review_approvals', 'meeting_transcripts', 'meeting_drafts', 'task_publications',
                      'milestone_publications', 'wiki_page_versions', 'wiki_page_publications')
), 'discussion_items:DELETE:discussion_items_delete_member,'
   'discussion_items:INSERT:discussion_items_insert_member,'
   'discussion_items:SELECT:discussion_items_select_member,'
   'discussion_items:UPDATE:discussion_items_update_member,'
   'meeting_drafts:SELECT:meeting_drafts_select_member,'
   'meeting_participants:DELETE:meeting_participants_delete_member,'
   'meeting_participants:INSERT:meeting_participants_insert_member,'
   'meeting_participants:SELECT:meeting_participants_select_member,'
   'meeting_participants:UPDATE:meeting_participants_update_member,'
   'meeting_transcripts:SELECT:meeting_transcripts_select_member,'
   'meetings:DELETE:meetings_delete_member,'
   'meetings:INSERT:meetings_insert_member,'
   'meetings:SELECT:meetings_select_member,'
   'meetings:UPDATE:meetings_update_member,'
   'milestone_publications:SELECT:milestone_publications_select_member,'
   'milestones:DELETE:milestones_delete_member,'
   'milestones:INSERT:milestones_insert_member,'
   'milestones:SELECT:milestones_select_member,'
   'milestones:UPDATE:milestones_update_member,'
   'review_approvals:SELECT:review_approvals_select_member,'
   'reviews:DELETE:reviews_delete_member,'
   'reviews:INSERT:reviews_insert_member,'
   'reviews:SELECT:reviews_select_member,'
   'reviews:UPDATE:reviews_update_member,'
   'spaces:DELETE:spaces_delete_member,'
   'spaces:INSERT:spaces_insert_member,'
   'spaces:SELECT:spaces_select_member,'
   'spaces:UPDATE:spaces_update_member,'
   'task_comments:DELETE:task_comments_delete,'
   'task_comments:INSERT:task_comments_insert,'
   'task_comments:SELECT:task_comments_select,'
   'task_comments:UPDATE:task_comments_update,'
   'task_events:DELETE:task_events_delete_member,'
   'task_events:INSERT:task_events_insert_member,'
   'task_events:SELECT:task_events_select_member,'
   'task_events:UPDATE:task_events_update_member,'
   'task_owners:DELETE:task_owners_delete_member,'
   'task_owners:INSERT:task_owners_insert_member,'
   'task_owners:SELECT:task_owners_select_member,'
   'task_owners:UPDATE:task_owners_update_member,'
   'task_publications:SELECT:task_publications_select_member,'
   'task_relations:DELETE:task_relations_delete_member,'
   'task_relations:INSERT:task_relations_insert_member,'
   'task_relations:SELECT:task_relations_select_member,'
   'task_relations:UPDATE:task_relations_update_member,'
   'tasks:DELETE:tasks_delete_member,'
   'tasks:INSERT:tasks_insert_member,'
   'tasks:SELECT:tasks_select_member,'
   'tasks:UPDATE:tasks_update_member,'
   'wiki_page_publications:DELETE:wiki_page_publications_delete_member,'
   'wiki_page_publications:INSERT:wiki_page_publications_insert_member,'
   'wiki_page_publications:SELECT:wiki_page_publications_select_member,'
   'wiki_page_publications:UPDATE:wiki_page_publications_update_member,'
   'wiki_page_versions:DELETE:wiki_page_versions_delete_member,'
   'wiki_page_versions:INSERT:wiki_page_versions_insert_member,'
   'wiki_page_versions:SELECT:wiki_page_versions_select_member,'
   'wiki_page_versions:UPDATE:wiki_page_versions_update_member,'
   'wiki_pages:DELETE:wiki_pages_delete_member,'
   'wiki_pages:INSERT:wiki_pages_insert_member,'
   'wiki_pages:SELECT:wiki_pages_select_member,'
   'wiki_pages:UPDATE:wiki_pages_update_member');

-- 変更系の RPC 15 本: app_can_access_space を含まず、app_can_write_space で確かめる
select test.check('chg_shape_rpcs_without_access_space', (
  select coalesce(string_agg(proname, ',' order by proname), '(none)') from pg_proc
  where prosrc like '%app_can_access_space%'
    and proname in ('rpc_pass_ball', 'rpc_review_approve', 'rpc_review_block', 'rpc_review_cancel', 'rpc_meeting_start',
                    'rpc_meeting_end', 'rpc_set_spec_state', 'rpc_decide_considering', 'rpc_generate_meeting_minutes',
                    'rpc_parse_meeting_minutes', 'rpc_get_minutes_preview', 'rpc_invoke_meeting_minutes_email',
                    'rpc_confirm_proposal_slot', 'rpc_review_open', 'rpc_apply_preset_to_space')
), '(none)');
select test.check('chg_shape_rpcs_write_guard', (
  select count(*)::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and 'search_path=public' = any(p.proconfig)
    and p.prosrc like '%public.app_can_write_space(%'
    and p.proname in ('rpc_pass_ball', 'rpc_review_approve', 'rpc_review_block', 'rpc_review_cancel', 'rpc_meeting_start',
                      'rpc_meeting_end', 'rpc_set_spec_state', 'rpc_decide_considering', 'rpc_generate_meeting_minutes',
                      'rpc_parse_meeting_minutes', 'rpc_get_minutes_preview', 'rpc_invoke_meeting_minutes_email',
                      'rpc_confirm_proposal_slot', 'rpc_review_open', 'rpc_apply_preset_to_space')
), '15');
-- 一覧: authenticated が実行できる SECURITY DEFINER 関数（トリガー関数を除く）のうち、11 表を書くものは
--   すべて app_can_write_space で確かめる。新しい space を作る関数は、spaces の insert のポリシーと同じく
--   組織の社内メンバー（owner / admin / member）であることを確かめていればよい（作る時点では space の役割が無いため）
select test.check('chg_shape_definer_writers_use_write_guard', (
  select coalesce(string_agg(p.proname, ',' order by p.proname), '(none)')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(tasks|milestones|meetings|reviews|task_owners|task_events|task_relations|wiki_pages|discussion_items|meeting_participants|spaces)\M'
    and p.prosrc not like '%app_can_write_space(%'
    and not (
      p.prosrc ~* 'insert\s+into\s+(public\.)?spaces\M'
      and (p.prosrc like '%app_is_org_internal(%'
           or p.prosrc ~* 'role\s+in\s+\(\s*''owner''\s*,\s*''admin''\s*,\s*''member''\s*\)')
    )
), '(none)');
-- rpc_review_open の「space の admin / editor か」の確かめは残す（そのあとに app_can_write_space を足した）
select test.check('same_shape_rpc_review_open_guard', (
  select (prosrc like '%role IN (''admin'', ''editor'')%')::text from pg_proc
  where oid = 'public.rpc_review_open(uuid,uuid[],uuid)'::regprocedure
), 'true');

-- _create_task_notification: authenticated / anon は呼べない・service_role は呼べる（実行権は本 migration では変えない）
select test.check('same_shape_create_task_notification_execute', (
  select 'auth=' || has_function_privilege('authenticated', p.oid, 'execute')
      || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
      || ':svc=' || has_function_privilege('service_role', p.oid, 'execute')
  from pg_proc p where p.oid = 'public._create_task_notification(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
), 'auth=false:anon=false:svc=true');
-- _create_task_notification: search_path を public に固定する
select test.check('chg_shape_create_task_notification_search_path', (
  select coalesce(array_to_string(p.proconfig, ';'), '-')
  from pg_proc p where p.oid = 'public._create_task_notification(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
), 'search_path=public');

-- トリガー関数: SECURITY DEFINER・search_path 固定。check_and_update_milestone は authenticated / anon から呼べない
select test.check('chg_shape_trigger_functions', (
  select string_agg(p.proname || ':definer=' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'),
                    ',' order by p.proname)
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('enforce_review_gate', 'trg_check_milestone_completion', 'check_and_update_milestone',
                      'enforce_personal_task_rules', 'enforce_milestone_same_space')
), 'check_and_update_milestone:definer=true:search_path=public,'
   'enforce_milestone_same_space:definer=true:search_path=public,'
   'enforce_personal_task_rules:definer=true:search_path=public,'
   'enforce_review_gate:definer=true:search_path=public,'
   'trg_check_milestone_completion:definer=true:search_path=public');
select test.check('chg_shape_check_and_update_milestone_execute', (
  select 'auth=' || has_function_privilege('authenticated', p.oid, 'execute')
      || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
      || ':svc=' || has_function_privilege('service_role', p.oid, 'execute')
  from pg_proc p where p.oid = 'public.check_and_update_milestone(uuid)'::regprocedure
), 'auth=false:anon=false:svc=true');
-- マイルストーンの同じ space（wiki_page_publications は同じ組織）を確かめるトリガー
select test.check('chg_shape_milestone_same_space_triggers', (
  select coalesce(string_agg(t.tgrelid::regclass::text, ',' order by t.tgrelid::regclass::text), '(none)')
  from pg_trigger t
  where t.tgname = 'trg_enforce_milestone_same_space' and not t.tgisinternal
    and t.tgfoid in (select p.oid from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_milestone_same_space')
), 'meetings,tasks,wiki_page_publications');
-- トリガー関数 enforce_milestone_same_space は public / anon / authenticated からは呼べない（トリガーとしては動く）
select test.check('chg_shape_enforce_milestone_same_space_execute', (
  select coalesce(string_agg('public=' || has_function_privilege('public', p.oid, 'execute')
      || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
      || ':auth=' || has_function_privilege('authenticated', p.oid, 'execute'), ','), '(none)')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_milestone_same_space'
), 'public=false:anon=false:auth=false');
-- 索引: wiki_page_publications (source_page_id)
select test.check('chg_shape_wiki_publications_source_page_index', (
  select count(*)::text from pg_index i
  where i.indrelid = 'public.wiki_page_publications'::regclass
    and i.indnatts = 1
    and i.indkey[0] = (select a.attnum from pg_attribute a
                       where a.attrelid = 'public.wiki_page_publications'::regclass and a.attname = 'source_page_id')
), '1');

-- meetings: 表の select は外し、notes 以外の全列を authenticated に許可（notes は読めない・書けない）
select test.check('chg_shape_meetings_notes', (
  select 'notes=' || has_column_privilege('authenticated', 'public.meetings', 'notes', 'select')
      || '/' || has_column_privilege('authenticated', 'public.meetings', 'notes', 'insert')
      || '/' || has_column_privilege('authenticated', 'public.meetings', 'notes', 'update')
      || ':others=' || (
           select bool_and(has_column_privilege('authenticated', 'public.meetings', a.attname, 'select')
                       and has_column_privilege('authenticated', 'public.meetings', a.attname, 'insert')
                       and has_column_privilege('authenticated', 'public.meetings', a.attname, 'update'))
           from pg_attribute a
           where a.attrelid = 'public.meetings'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'notes')
      || ':table_select=' || has_table_privilege('authenticated', 'public.meetings', 'select')
      || ':delete=' || has_table_privilege('authenticated', 'public.meetings', 'delete')
), 'notes=false/false/false:others=true:table_select=false:delete=true');

-- audit_logs / space_memberships / org_memberships のポリシーは変えない（名前と条件の md5 が本 migration の前と同じ）
select test.check('same_shape_audit_membership_policies', (
  select string_agg(tablename || ':' || cmd || ':' || policyname || ':'
                    || md5(roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')),
                    ',' order by tablename, cmd, policyname)
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE'
    and tablename in ('audit_logs', 'space_memberships', 'org_memberships')
), 'audit_logs:DELETE:audit_logs_no_delete:23c9a596494ef905d3dbeba653cb23f8,'
   'audit_logs:INSERT:audit_logs_insert:c66fbbba214b93c0311c0c5e61e6a3e9,'
   'audit_logs:SELECT:audit_logs_select:aadce0bb5b9f59a84699374bd616c31b,'
   'audit_logs:UPDATE:audit_logs_no_update:23c9a596494ef905d3dbeba653cb23f8,'
   'org_memberships:SELECT:org_memberships_select_member:cb8345231dbee874579c9e0239a4206b,'
   'space_memberships:SELECT:space_memberships_select_member:9b1f12b0f60b04f81f5b35ac79672ebe');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_shape_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

-- -----------------------------------------------------------------------------
-- 集計
-- -----------------------------------------------------------------------------
do $$
declare
  v_pass int;
  v_fail int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from test.results;
  raise notice 'SUMMARY: PASS=% FAIL=%', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'SPACE ROLE BOUNDARY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'SPACE ROLE BOUNDARY CHECKS PASSED' as result;
