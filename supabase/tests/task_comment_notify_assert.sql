-- =============================================================================
-- タスクのコメントのお知らせ（*_task_comment_notify.sql）の挙動検証
-- 前提: run_task_comment_notify.sh が migrations → task_comment_notify_seed.sql →（GREEN なら）本 migration を
--       2回適用済み。人物・データは task_comment_notify_seed.sql を参照。
--
-- label:
--   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS）
--   same_*  変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
--   コメントを書く確認は1つずつ begin … rollback で包み、互いに影響させない。
--   書き込みは test.add_comment（中で test.run）が行い、失敗しても文字列で返す
--   （適用前は mention_user_ids の列が無いので、名指し付きの書き込みは失敗する）。
-- =============================================================================
set client_min_messages = notice;

\set O1 'a0000000-0000-0000-0000-000000000001'
\set S1 'b0000000-0000-0000-0000-000000000001'
\set u_au  'c0000000-0000-0000-0000-000000000001'
\set u_as  'c0000000-0000-0000-0000-000000000002'
\set u_rv  'c0000000-0000-0000-0000-000000000003'
\set u_ap  'c0000000-0000-0000-0000-000000000004'
\set u_rx  'c0000000-0000-0000-0000-000000000005'
\set u_pc  'c0000000-0000-0000-0000-000000000006'
\set u_dc  'c0000000-0000-0000-0000-000000000007'
\set u_mn  'c0000000-0000-0000-0000-000000000008'
\set u_nm  'c0000000-0000-0000-0000-000000000009'
\set u_cl  'c0000000-0000-0000-0000-000000000010'
\set u_vd  'c0000000-0000-0000-0000-000000000011'
\set u_cl2 'c0000000-0000-0000-0000-000000000012'
\set u_o2  'c0000000-0000-0000-0000-000000000013'
\set u_nob 'c0000000-0000-0000-0000-000000000017'
\set T1 'd0000000-0000-0000-0000-000000000001'
\set T2 'd0000000-0000-0000-0000-000000000002'
\set T3 'd0000000-0000-0000-0000-000000000003'
-- この確認で書くコメント
\set N01 'f1000000-0000-0000-0000-000000000001'
\set N02 'f1000000-0000-0000-0000-000000000002'
\set N03 'f1000000-0000-0000-0000-000000000003'
\set N04 'f1000000-0000-0000-0000-000000000004'
\set N05 'f1000000-0000-0000-0000-000000000005'
\set N06 'f1000000-0000-0000-0000-000000000006'
\set N07 'f1000000-0000-0000-0000-000000000007'
\set N08 'f1000000-0000-0000-0000-000000000008'
\set N09 'f1000000-0000-0000-0000-000000000009'
\set N10 'f1000000-0000-0000-0000-000000000010'
\set N11 'f1000000-0000-0000-0000-000000000011'
\set N12 'f1000000-0000-0000-0000-000000000012'
\set N13 'f1000000-0000-0000-0000-000000000013'
\set N14 'f1000000-0000-0000-0000-000000000014'
\set N20 'f1000000-0000-0000-0000-000000000020'
\set N21 'f1000000-0000-0000-0000-000000000021'
\set N30 'f1000000-0000-0000-0000-000000000030'
\set N31 'f1000000-0000-0000-0000-000000000031'
\set N32 'f1000000-0000-0000-0000-000000000032'
\set T7 'd0000000-0000-0000-0000-000000000007'
-- シードのコメント（消す確認で使う）
\set C01 'f0000000-0000-0000-0000-000000000001'
\set C02 'f0000000-0000-0000-0000-000000000002'
\set C03 'f0000000-0000-0000-0000-000000000003'
\set C04 'f0000000-0000-0000-0000-000000000004'
\set C13 'f0000000-0000-0000-0000-000000000013'
\set C14 'f0000000-0000-0000-0000-000000000014'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;

create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

-- 人物とコメントの呼び名（出力を読みやすくする）
create table test.people (id uuid primary key, name text not null);
insert into test.people (id, name) values
  (:'u_au', 'au'), (:'u_as', 'as'), (:'u_rv', 'rv'), (:'u_ap', 'ap'), (:'u_rx', 'rx'), (:'u_pc', 'pc'),
  (:'u_dc', 'dc'), (:'u_mn', 'mn'), (:'u_nm', 'nm'), (:'u_cl', 'cl'), (:'u_vd', 'vd'), (:'u_cl2', 'cl2'),
  (:'u_o2', 'o2'), (:'u_nob', 'nob');

create table test.comment_names (id uuid primary key, name text not null);
insert into test.comment_names (id, name)
select format('f0000000-0000-0000-0000-0000000000%s', lpad(i::text, 2, '0'))::uuid, format('C%s', lpad(i::text, 2, '0'))
  from generate_series(1, 14) as i;

-- p_role（authenticated / service_role）として SQL を1つ実行し、postgres に戻る。
-- authenticated のときは request.jwt.claims の sub を p_user にする。
-- 成功なら 'ok'、失敗なら 'error:<SQLSTATE>:<文言>'（失敗しても外のトランザクションは続けられる）
create or replace function test.run(p_user uuid, p_role text, p_sql text)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    if p_role = 'authenticated' then
      perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    else
      perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    end if;
    execute format('set local role %I', p_role);
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- コメントを1つ書く（画面 = authenticated / ポータルのサーバー = service_role）。
-- p_mentions が null なら mention_user_ids を書かない（適用前でも書ける）
create or replace function test.add_comment(p_role text, p_actor uuid, p_id uuid, p_task uuid, p_visibility text,
                                            p_body text, p_mentions uuid[] default null, p_deleted boolean default false)
returns text language plpgsql as $$
declare
  v_org uuid;
  v_space uuid;
begin
  select t.org_id, t.space_id into v_org, v_space from public.tasks t where t.id = p_task;
  return test.run(p_actor, p_role, format(
    'insert into public.task_comments (id, org_id, space_id, task_id, actor_id, body, visibility, deleted_at%s) '
    'values (%L, %L, %L, %L, %L, %L, %L, %s%s)',
    case when p_mentions is null then '' else ', mention_user_ids' end,
    p_id, v_org, v_space, p_task, p_actor, p_body, p_visibility,
    case when p_deleted then 'now()' else 'null' end,
    case when p_mentions is null then '' else format(', %L::uuid[]', p_mentions) end));
end $$;

-- postgres で1つの値を返す SQL を実行する（失敗は 'error:<SQLSTATE>:<文言>'）
create or replace function test.val(p_sql text)
returns text language plpgsql as $$
declare
  v text;
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql into v;
    return v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- あるコメントのお知らせ（「宛先:種類」を宛先の名前の順にカンマ区切り。無ければ空文字）
create or replace function test.notices(p_comment uuid)
returns text language sql as $$
  select coalesce(string_agg(coalesce(p.name, n.to_user_id::text) || ':' || n.channel || ':' || n.type, ','
                             order by coalesce(p.name, n.to_user_id::text) collate "C"), '')
    from public.notifications n
    left join test.people p on p.id = n.to_user_id
   where n.dedupe_key = 'task_comment:' || p_comment::text
      or n.payload->>'comment_id' = p_comment::text;
$$;

-- あるコメントについて、ある人あてのお知らせの件数
create or replace function test.count_to(p_comment uuid, p_user uuid)
returns text language sql as $$
  select count(*)::text
    from public.notifications n
   where n.to_user_id = p_user
     and (n.dedupe_key = 'task_comment:' || p_comment::text or n.payload->>'comment_id' = p_comment::text);
$$;

-- コメントの id の並びを呼び名にする
create or replace function test.cnames(p_ids uuid[])
returns text language sql as $$
  select coalesce(string_agg(coalesce(c.name, x.id::text), ',' order by coalesce(c.name, x.id::text) collate "C"), '')
    from unnest(p_ids) as x(id)
    left join test.comment_names c on c.id = x.id;
$$;

-- p_user として（authenticated・RLS を通して）読めるコメント
create or replace function test.rls_ids(p_user uuid)
returns text language plpgsql as $$
declare
  v uuid[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select coalesce(array_agg(c.id), ''{}'') from public.task_comments c' into v;
  execute 'reset role';
  return test.cnames(v);
end $$;

-- 補助関数が「p_user は読める」と答えるコメント（postgres で。関数が無ければそう返す）
create or replace function test.helper_ids(p_user uuid)
returns text language plpgsql as $$
declare
  v uuid[];
begin
  if to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)') is null then
    return '(補助関数が無い)';
  end if;
  execute 'select coalesce(array_agg(c.id), ''{}'') from public.task_comments c '
          'where public.app_task_comment_visible_to_user($1, c.space_id, c.org_id, c.task_id, c.visibility)'
    into v using p_user;
  return test.cnames(v);
end $$;

-- -----------------------------------------------------------------------------
-- 「読めるか」の補助関数が、task_comments の読み取りのポリシー（RLS）と同じ答えを返す（人ごと・シードの全コメントで）
-- -----------------------------------------------------------------------------
select test.check('chg_helper_matches_rls_' || p.name, test.helper_ids(p.id), test.rls_ids(p.id))
  from test.people p
 order by p.name collate "C";

-- 比べる相手（RLS の答え）が、シードの想定どおりであること（一致が空の比較になっていないことの確認）
select test.check('same_rls_seed_cl',  test.rls_ids(:'u_cl'),  'C05,C08,C10');
select test.check('same_rls_seed_vd',  test.rls_ids(:'u_vd'),  'C06');
select test.check('same_rls_seed_cl2', test.rls_ids(:'u_cl2'), 'C11');
select test.check('same_rls_seed_o2',  test.rls_ids(:'u_o2'),  'C12');
select test.check('same_rls_seed_nob', test.rls_ids(:'u_nob'), '');
select test.check('same_rls_seed_pc',  test.rls_ids(:'u_pc'),  'C01,C02,C03,C04,C05,C06,C07,C08,C09,C10,C11,C13,C14');

-- -----------------------------------------------------------------------------
-- 列・関数・トリガーの形
-- -----------------------------------------------------------------------------
select test.check('chg_mention_column',
  (select format('%s|%s|%s', format_type(a.atttypid, a.atttypmod), a.attnotnull::text, pg_get_expr(d.adbin, d.adrelid))
     from pg_attribute a
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.task_comments'::regclass and a.attname = 'mention_user_ids' and not a.attisdropped),
  'uuid[]|true|''{}''::uuid[]');

select test.check('chg_mention_limit_constraint',
  (select format('%s|%s', pg_get_constraintdef(c.oid), c.convalidated::text)
     from pg_constraint c
    where c.conrelid = 'public.task_comments'::regclass and c.conname = 'task_comments_mention_user_ids_check'),
  'CHECK ((cardinality(mention_user_ids) <= 20))|true');

-- 前からあるコメントは、名指しが空
select test.check('chg_existing_comments_have_no_mentions',
  test.val('select format(''%s/%s'', count(*) filter (where mention_user_ids = ''{}''), count(*)) from public.task_comments'),
  '14/14');

select test.check('chg_trigger_after_insert_each_row',
  (select format('%s|%s|%s|%s', count(*), string_agg(t.tgtype::text, ','), string_agg(t.tgenabled::text, ','),
                 bool_and(t.tgqual is null)::text)
     from pg_trigger t
    where t.tgrelid = 'public.task_comments'::regclass
      and not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.app_task_comment_notify()')),
  '1|5|O|true');

select test.check('chg_functions_definer_search_path',
  (select string_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, array_to_string(p.proconfig, ';')), ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('app_task_comment_notify', 'app_task_comment_visible_to_user')),
  'app_task_comment_notify:true:search_path=public,app_task_comment_visible_to_user:true:search_path=public');

-- 補助関数は service_role だけが実行できる（PUBLIC・anon・authenticated は不可）
select test.check('chg_helper_service_role_only',
  (select format('%s|%s|%s|%s',
     coalesce(has_function_privilege('public', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('anon', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('authenticated', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('service_role', f, 'execute')::text, 'none'))
     from (select to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)') as f) x),
  'false|false|false|true');

-- トリガー関数は利用者が直接呼べない
select test.check('chg_trigger_function_not_callable',
  (select format('%s|%s|%s',
     coalesce(has_function_privilege('public', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('anon', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('authenticated', f, 'execute')::text, 'none'))
     from (select to_regprocedure('public.app_task_comment_notify()') as f) x),
  'false|false|false');

-- プッシュのトリガーはそのまま動いている
select test.check('same_push_trigger_enabled',
  (select tgenabled::text from pg_trigger
    where tgname = 'notifications_push_dispatch' and tgrelid = 'public.notifications'::regclass), 'O');

-- -----------------------------------------------------------------------------
-- 社内のコメント（画面から）: 担当者・承認者（承認済みも）・前にコメントした人に届く。本人・消したコメントの書き手には届かない
-- -----------------------------------------------------------------------------
begin;
select test.check('same_member_can_comment',
  test.add_comment('authenticated', :'u_au', :'N01', :'T1', 'internal', '確認お願いします'), 'ok');
select test.check('chg_comment_notifies_involved', test.notices(:'N01'),
  'ap:in_app:comment_added,as:in_app:comment_added,pc:in_app:comment_added,rv:in_app:comment_added');
select test.check('same_author_not_notified', test.count_to(:'N01', :'u_au'), '0');
select test.check('same_deleted_comment_author_not_counted', test.count_to(:'N01', :'u_dc'), '0');
select test.check('chg_notice_row',
  (select format('%s|%s|%s|%s|%s', (n.org_id = :'O1')::text, (n.space_id = :'S1')::text,
                 (n.dedupe_key = 'task_comment:' || :'N01')::text, (n.read_at is null)::text, (n.actioned_at is null)::text)
     from public.notifications n where n.to_user_id = :'u_as' and n.payload->>'comment_id' = :'N01'),
  'true|true|true|true|true');
select test.check('chg_notice_payload',
  (select format('%s|%s|%s|%s|%s|%s', n.payload->>'task_id', n.payload->>'task_title', n.payload->>'comment_id',
                 n.payload->>'from_user_name', n.payload->>'title', n.payload->>'message')
     from public.notifications n where n.to_user_id = :'u_as' and n.payload->>'comment_id' = :'N01'),
  format('%s|コメントを付けるタスク|%s|書く人|「コメントを付けるタスク」にコメントが付きました|確認お願いします', :'T1', :'N01'));
select test.check('chg_notice_payload_keys',
  (select string_agg(k, ',' order by k)
     from public.notifications n, jsonb_object_keys(n.payload) k
    where n.to_user_id = :'u_as' and n.payload->>'comment_id' = :'N01'),
  'comment_id,from_user_name,message,task_id,task_title,title');
rollback;

-- -----------------------------------------------------------------------------
-- 名指し: 名指しされた人には mention で届く。前にコメントした人でもある人は mention の1行だけ。
--   読めない人（相手先・別の案件・別の組織・所属の無い人）と本人は、名指ししても届かない
-- -----------------------------------------------------------------------------
begin;
select test.check('chg_member_can_comment_with_mentions',
  test.add_comment('authenticated', :'u_au', :'N02', :'T1', 'internal', 'ご意見ください',
                   array[:'u_pc', :'u_mn', :'u_nm', :'u_cl', :'u_cl2', :'u_o2', :'u_nob', :'u_au']::uuid[]), 'ok');
select test.check('chg_mention_recipients', test.notices(:'N02'),
  'ap:in_app:comment_added,as:in_app:comment_added,mn:in_app:mention,nm:in_app:mention,pc:in_app:mention,rv:in_app:comment_added');
select test.check('chg_mention_and_commenter_one_row',
  (select format('%s|%s', count(*), string_agg(type, ','))
     from public.notifications where to_user_id = :'u_pc' and payload->>'comment_id' = :'N02'),
  '1|mention');
select test.check('same_mention_cannot_read_not_notified',
  (select format('%s|%s|%s|%s|%s', test.count_to(:'N02', :'u_cl'), test.count_to(:'N02', :'u_cl2'),
                 test.count_to(:'N02', :'u_o2'), test.count_to(:'N02', :'u_nob'), test.count_to(:'N02', :'u_au'))),
  '0|0|0|0|0');
select test.check('chg_mention_title',
  (select format('%s|%s', payload->>'title', payload->>'from_user_name')
     from public.notifications where to_user_id = :'u_mn' and payload->>'comment_id' = :'N02'),
  '書く人さんがコメントであなたを呼んでいます: 「コメントを付けるタスク」|書く人');
rollback;

-- -----------------------------------------------------------------------------
-- 取り消した依頼の承認者には届かない
-- -----------------------------------------------------------------------------
begin;
select test.add_comment('authenticated', :'u_au', :'N03', :'T2', 'internal', '取り消したあとのコメント');
select test.check('chg_cancelled_review_recipients', test.notices(:'N03'), 'as:in_app:comment_added');
select test.check('same_cancelled_reviewer_not_notified', test.count_to(:'N03', :'u_rx'), '0');
rollback;

-- -----------------------------------------------------------------------------
-- 社内のみのコメントは、担当者・前にコメントした人・名指しの人が相手先 / vendor でも届かない
-- -----------------------------------------------------------------------------
begin;
select test.check('chg_internal_comment_with_mentions_saved',
  test.add_comment('authenticated', :'u_au', :'N04', :'T3', 'internal', '社内で相談',
                   array[:'u_cl', :'u_mn']::uuid[]), 'ok');
select test.check('chg_internal_comment_recipients', test.notices(:'N04'),
  'mn:in_app:mention,pc:in_app:comment_added,rv:in_app:comment_added');
select test.check('same_internal_comment_not_to_client', test.count_to(:'N04', :'u_cl'), '0');
select test.check('same_internal_comment_not_to_vendor', test.count_to(:'N04', :'u_vd'), '0');
rollback;

-- -----------------------------------------------------------------------------
-- 相手先向けのコメント: 相手先の担当者に届く。vendor には届かない
-- -----------------------------------------------------------------------------
begin;
select test.add_comment('authenticated', :'u_au', :'N05', :'T3', 'client', 'ご確認ください');
select test.check('chg_client_comment_recipients', test.notices(:'N05'),
  'cl:in_app:comment_added,pc:in_app:comment_added,rv:in_app:comment_added');
rollback;

-- vendor 向けのコメント: vendor に届く。相手先には届かない
begin;
select test.add_comment('authenticated', :'u_au', :'N07', :'T3', 'vendor', '作業をお願いします');
select test.check('chg_vendor_comment_recipients', test.notices(:'N07'),
  'pc:in_app:comment_added,rv:in_app:comment_added,vd:in_app:comment_added');
rollback;

-- 相手先が画面から書いて社内の人を名指しする。別の案件の相手先を名指ししても届かない
begin;
select test.check('chg_client_can_comment_with_mention',
  test.add_comment('authenticated', :'u_cl', :'N08', :'T3', 'client', '見ていただけますか',
                   array[:'u_mn', :'u_cl2']::uuid[]), 'ok');
select test.check('chg_client_mention_recipients', test.notices(:'N08'),
  'mn:in_app:mention,pc:in_app:comment_added,rv:in_app:comment_added');
select test.check('chg_client_mention_title',
  (select payload->>'title' from public.notifications where to_user_id = :'u_mn' and payload->>'comment_id' = :'N08'),
  '相手先の人さんがコメントであなたを呼んでいます: 「相手先に見えるタスク」');
rollback;

-- -----------------------------------------------------------------------------
-- ポータルのサーバー（service role）から書いても届く
-- -----------------------------------------------------------------------------
begin;
select test.check('same_service_role_can_comment',
  test.add_comment('service_role', :'u_cl', :'N06', :'T3', 'client', '見積もりを見直してください'), 'ok');
select test.check('chg_service_role_comment_recipients', test.notices(:'N06'),
  'pc:in_app:comment_added,rv:in_app:comment_added');
select test.check('same_service_role_author_not_notified', test.count_to(:'N06', :'u_cl'), '0');
rollback;

-- 消した状態で入ってきた行には何も作らない
begin;
select test.check('same_deleted_on_insert_saved',
  test.add_comment('service_role', :'u_au', :'N09', :'T1', 'internal', '消した状態で入る', null, true), 'ok');
select test.check('same_deleted_on_insert_no_notice', test.notices(:'N09'), '');
rollback;

-- -----------------------------------------------------------------------------
-- 表示名が空の人が名指しすると「メンバー」になり、from_user_name は null
-- -----------------------------------------------------------------------------
begin;
select test.add_comment('authenticated', :'u_nm', :'N10', :'T1', 'internal', '名前の無い人から', array[:'u_mn']::uuid[]);
select test.check('chg_mention_title_without_name',
  (select format('%s|%s', payload->>'title', coalesce(payload->>'from_user_name', '(null)'))
     from public.notifications where to_user_id = :'u_mn' and payload->>'comment_id' = :'N10'),
  'メンバーさんがコメントであなたを呼んでいます: 「コメントを付けるタスク」|(null)');
rollback;

-- -----------------------------------------------------------------------------
-- お知らせの本文はコメントの先頭120文字。超えたら末尾に「…」
-- -----------------------------------------------------------------------------
begin;
select test.add_comment('authenticated', :'u_au', :'N11', :'T1', 'internal', repeat('あ', 121));
select test.add_comment('authenticated', :'u_au', :'N12', :'T1', 'internal', repeat('い', 120));
select test.check('chg_message_cut_after_120',
  (select format('%s|%s', char_length(payload->>'message'), (payload->>'message' = repeat('あ', 120) || '…')::text)
     from public.notifications where to_user_id = :'u_as' and payload->>'comment_id' = :'N11'),
  '121|true');
select test.check('chg_message_kept_at_120',
  (select format('%s|%s', char_length(payload->>'message'), (payload->>'message' = repeat('い', 120))::text)
     from public.notifications where to_user_id = :'u_as' and payload->>'comment_id' = :'N12'),
  '120|true');
rollback;

-- -----------------------------------------------------------------------------
-- 名指しは20人まで
-- -----------------------------------------------------------------------------
begin;
select test.check('chg_mentions_up_to_20_saved',
  test.add_comment('authenticated', :'u_au', :'N13', :'T1', 'internal', '20人',
                   (select array_agg(gen_random_uuid()) from generate_series(1, 20))), 'ok');
select test.check('chg_mentions_over_20_rejected',
  left(test.add_comment('authenticated', :'u_au', :'N14', :'T1', 'internal', '21人',
                        (select array_agg(gen_random_uuid()) from generate_series(1, 21))), 11), 'error:23514');
rollback;

-- -----------------------------------------------------------------------------
-- お知らせづくりが失敗しても、コメントは保存される。そのあとも同じトランザクションで書ける
-- -----------------------------------------------------------------------------
begin;
alter table public.notifications add constraint test_block_comment_added check (type <> 'comment_added') not valid;
select test.check('same_comment_saved_when_notice_fails',
  test.add_comment('authenticated', :'u_au', :'N20', :'T1', 'internal', 'お知らせが作れなくても保存される'), 'ok');
select test.check('same_comment_row_kept_when_notice_fails',
  (select count(*)::text from public.task_comments where id = :'N20'), '1');
select test.check('same_no_partial_notice_when_notice_fails', test.notices(:'N20'), '');
alter table public.notifications drop constraint test_block_comment_added;
select test.add_comment('authenticated', :'u_au', :'N21', :'T1', 'internal', '直ったあとのコメント');
select test.check('chg_notice_works_after_failure', test.notices(:'N21'),
  'ap:in_app:comment_added,as:in_app:comment_added,pc:in_app:comment_added,rv:in_app:comment_added');
rollback;


-- =============================================================================
-- コメントを消したら、そのコメントのお知らせ（comment_added / mention）を受信トレイから消す
--   多くの確認は、お知らせを test.put_notice で直接入れる（お知らせづくりに頼らず、消す側だけを見る。
--   適用前はお知らせが残るので chg_* が FAIL になる）。最後に、お知らせづくりから消すまでを通しで見る。
-- =============================================================================

-- お知らせを1行入れる（postgres で。そのコメントの組織・案件で、dedupe_key = 'task_comment:<コメントの id>'）
create or replace function test.put_notice(p_comment uuid, p_user uuid, p_type text, p_channel text default 'in_app')
returns void language sql as $$
  insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
  select c.org_id, c.space_id, p_user, p_channel, p_type, 'task_comment:' || c.id::text,
         jsonb_build_object('comment_id', c.id, 'message', c.body)
    from public.task_comments c
   where c.id = p_comment;
$$;

-- dedupe_key = 'task_comment:<コメントの id>' のお知らせ（「宛先:経路:種類」を宛先・経路・種類の順に。無ければ空文字）
create or replace function test.notices_all(p_comment uuid)
returns text language sql as $$
  select coalesce(string_agg(coalesce(p.name, n.to_user_id::text) || ':' || n.channel || ':' || n.type, ','
                             order by coalesce(p.name, n.to_user_id::text) collate "C", n.channel collate "C",
                                      n.type collate "C"), '')
    from public.notifications n
    left join test.people p on p.id = n.to_user_id
   where n.dedupe_key = 'task_comment:' || p_comment::text;
$$;

-- 実行計画（explain。実行はしない）を1行にする
create or replace function test.plan(p_sql text)
returns text language plpgsql as $$
declare
  r record;
  v text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop
    v := v || r."QUERY PLAN" || ' ';
  end loop;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- 形: トリガー（AFTER UPDATE OF deleted_at OR DELETE・行ごと・条件なし）・関数・実行権・索引
-- -----------------------------------------------------------------------------
select test.check('chg_retract_trigger_form',
  (select format('%s|%s|%s|%s|%s|%s', count(*), string_agg(t.tgname, ','), string_agg(t.tgtype::text, ','),
                 string_agg(t.tgenabled::text, ','), bool_and(t.tgqual is null)::text,
                 string_agg((select string_agg(a.attname, ',' order by a.attnum)
                               from pg_attribute a
                              where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])), ';'))
     from pg_trigger t
    where t.tgrelid = 'public.task_comments'::regclass
      and not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.app_task_comment_retract_notice()')),
  '1|task_comments_retract_notice|25|O|true|deleted_at');

select test.check('chg_retract_function_definer_search_path',
  (select format('%s:%s', p.prosecdef::text, array_to_string(p.proconfig, ';'))
     from pg_proc p
    where p.oid = to_regprocedure('public.app_task_comment_retract_notice()')),
  'true:search_path=public');

-- トリガー関数は利用者が直接呼べない
select test.check('chg_retract_function_not_callable',
  (select format('%s|%s|%s',
     coalesce(has_function_privilege('public', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('anon', f, 'execute')::text, 'none'),
     coalesce(has_function_privilege('authenticated', f, 'execute')::text, 'none'))
     from (select to_regprocedure('public.app_task_comment_retract_notice()') as f) x),
  'false|false|false');

select test.check('chg_retract_dedupe_index',
  pg_get_indexdef(to_regclass('public.notifications_task_comment_dedupe_idx')),
  'CREATE INDEX notifications_task_comment_dedupe_idx ON public.notifications USING btree (dedupe_key) WHERE ((channel = ''in_app''::text) AND (type = ANY (ARRAY[''comment_added''::text, ''mention''::text])))');

-- 消すときの問い合わせ（トリガー関数と同じ形）が索引を使える（表を端から読まない）
begin;
set local enable_seqscan = off;
select test.check('chg_retract_delete_uses_index',
  (test.plan(format('delete from public.notifications where channel = ''in_app'' and dedupe_key = %L '
                    'and type in (''comment_added'', ''mention'')', 'task_comment:' || :'C03'))
     like '%notifications_task_comment_dedupe_idx%')::text,
  'true');
rollback;

-- -----------------------------------------------------------------------------
-- 論理削除（deleted_at を立てる。画面の「削除」）: そのコメントの comment_added / mention を、既読も含めて全員分消す。
--   ball_passed（ポータルの修正依頼）・メールの行・ほかのコメントのお知らせは消さない
-- -----------------------------------------------------------------------------
begin;
select test.put_notice(:'C03', :'u_as', 'comment_added');
select test.put_notice(:'C03', :'u_rv', 'comment_added');
select test.put_notice(:'C03', :'u_mn', 'mention');
select test.put_notice(:'C03', :'u_nm', 'mention');
update public.notifications set read_at = now() where to_user_id = :'u_nm' and dedupe_key = 'task_comment:' || :'C03';
select test.put_notice(:'C03', :'u_pc', 'ball_passed');
select test.put_notice(:'C03', :'u_as', 'comment_added', 'email');
select test.put_notice(:'C01', :'u_as', 'comment_added');
select test.put_notice(:'C01', :'u_mn', 'mention');
select test.check('same_retract_seeded', test.notices_all(:'C03'),
  'as:email:comment_added,as:in_app:comment_added,mn:in_app:mention,nm:in_app:mention,pc:in_app:ball_passed,rv:in_app:comment_added');
select test.check('same_author_can_soft_delete',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'C03')), 'ok');
select test.check('same_soft_delete_saved',
  (select (deleted_at is not null)::text from public.task_comments where id = :'C03'), 'true');
select test.check('chg_soft_delete_retracts_comment_notices', test.notices_all(:'C03'),
  'as:email:comment_added,pc:in_app:ball_passed');
select test.check('same_soft_delete_keeps_ball_passed',
  (select count(*)::text from public.notifications where dedupe_key = 'task_comment:' || :'C03' and type = 'ball_passed'), '1');
select test.check('same_soft_delete_keeps_email',
  (select count(*)::text from public.notifications where dedupe_key = 'task_comment:' || :'C03' and channel = 'email'), '1');
select test.check('same_soft_delete_keeps_other_comment_notices', test.notices_all(:'C01'),
  'as:in_app:comment_added,mn:in_app:mention');
rollback;

-- -----------------------------------------------------------------------------
-- 物理削除でも消す（書いた本人が消す・service role が論理削除済みのコメントを消す）
-- -----------------------------------------------------------------------------
begin;
select test.put_notice(:'C04', :'u_as', 'comment_added');
select test.put_notice(:'C04', :'u_mn', 'mention');
select test.put_notice(:'C04', :'u_rv', 'ball_passed');
select test.check('same_author_can_hard_delete',
  test.run(:'u_au', 'authenticated', format('delete from public.task_comments where id = %L', :'C04')), 'ok');
select test.check('same_hard_delete_saved', (select count(*)::text from public.task_comments where id = :'C04'), '0');
select test.check('chg_hard_delete_retracts_comment_notices', test.notices_all(:'C04'), 'rv:in_app:ball_passed');
-- 論理削除済みのコメント（C02）に残っていたお知らせも、物理削除で消す
select test.put_notice(:'C02', :'u_as', 'comment_added');
select test.check('same_service_role_can_hard_delete',
  test.run(null, 'service_role', format('delete from public.task_comments where id = %L', :'C02')), 'ok');
select test.check('chg_hard_delete_of_soft_deleted_retracts', test.notices_all(:'C02'), '');
rollback;

-- タスクを消す（コメントは連鎖で消える）と、そのタスクのコメントのお知らせも消える。ほかのタスクのは残る
begin;
select test.put_notice(:'C13', :'u_au', 'comment_added');
select test.put_notice(:'C14', :'u_mn', 'mention');
select test.put_notice(:'C01', :'u_mn', 'mention');
select test.check('same_task_delete_saved',
  test.val(format('with d as (delete from public.tasks where id = %L returning 1) select count(*)::text from d', :'T7')), '1');
select test.check('chg_task_delete_retracts_comment_notices',
  format('%s|%s', test.notices_all(:'C13'), test.notices_all(:'C14')), '|');
select test.check('same_task_delete_keeps_other_task_notices', test.notices_all(:'C01'), 'mn:in_app:mention');
rollback;

-- -----------------------------------------------------------------------------
-- ほかの更新では何も消さない
-- -----------------------------------------------------------------------------
-- 消していないコメント: 本文を直す・deleted_at を null のまま書く
begin;
select test.put_notice(:'C01', :'u_as', 'comment_added');
select test.put_notice(:'C01', :'u_mn', 'mention');
select test.check('same_body_edit_saved',
  test.run(:'u_pc', 'authenticated', format('update public.task_comments set body = %L where id = %L', '直した本文', :'C01')), 'ok');
select test.check('same_body_edit_keeps_notices', test.notices_all(:'C01'), 'as:in_app:comment_added,mn:in_app:mention');
select test.check('same_null_deleted_at_write_saved',
  test.run(:'u_pc', 'authenticated',
           format('update public.task_comments set body = %L, deleted_at = null where id = %L', 'もう一度直した', :'C01')), 'ok');
select test.check('same_null_deleted_at_write_keeps_notices', test.notices_all(:'C01'), 'as:in_app:comment_added,mn:in_app:mention');
rollback;

-- 消したコメント: 消したあとに残っている行（rv）は、本文を直す・deleted_at を付け直す・元に戻す、のどれでも消さない
begin;
select test.put_notice(:'C03', :'u_as', 'comment_added');
select test.run(:'u_au', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'C03'));
select test.check('chg_soft_delete_before_other_updates', test.notices_all(:'C03'), '');
select test.put_notice(:'C03', :'u_rv', 'comment_added');
select test.check('same_body_edit_after_delete_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set body = %L where id = %L', '消したあとに直す', :'C03')), 'ok');
select test.check('same_body_edit_after_delete_keeps_notice', test.count_to(:'C03', :'u_rv'), '1');
select test.check('same_redelete_saved',
  test.run(:'u_au', 'authenticated',
           format('update public.task_comments set deleted_at = now() + interval ''1 minute'', body = %L where id = %L', '付け直す', :'C03')), 'ok');
select test.check('same_redelete_keeps_notice', test.count_to(:'C03', :'u_rv'), '1');
select test.check('same_restore_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set deleted_at = null where id = %L', :'C03')), 'ok');
select test.check('same_restore_keeps_notice', test.count_to(:'C03', :'u_rv'), '1');
rollback;

-- -----------------------------------------------------------------------------
-- お知らせを消すのに失敗しても、コメントの削除は止めない（警告を出し、お知らせは1行も消さない）。
--   そのあとも同じトランザクションで消せる
-- -----------------------------------------------------------------------------
begin;
select test.put_notice(:'C03', :'u_as', 'comment_added');
select test.put_notice(:'C03', :'u_mn', 'mention');
create function test.block_notice_delete() returns trigger language plpgsql as $f$
begin
  raise exception 'test: お知らせを消せない';
end $f$;
create trigger test_block_notice_delete before delete on public.notifications
  for each row execute function test.block_notice_delete();
select test.check('same_soft_delete_saved_when_retract_fails',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'C03')), 'ok');
select test.check('same_comment_deleted_when_retract_fails',
  (select (deleted_at is not null)::text from public.task_comments where id = :'C03'), 'true');
select test.check('same_no_partial_retract_when_retract_fails', test.notices_all(:'C03'),
  'as:in_app:comment_added,mn:in_app:mention');
drop trigger test_block_notice_delete on public.notifications;
select test.put_notice(:'C01', :'u_as', 'comment_added');
select test.run(:'u_pc', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'C01'));
select test.check('chg_retract_works_after_failure', test.notices_all(:'C01'), '');
rollback;

-- -----------------------------------------------------------------------------
-- 通しで: お知らせづくりが作った行が、コメントを消すと消える。同じタスクのほかのコメントのお知らせは残る
-- -----------------------------------------------------------------------------
begin;
select test.add_comment('authenticated', :'u_au', :'N30', :'T1', 'internal', '消すコメント', array[:'u_mn']::uuid[]);
select test.add_comment('authenticated', :'u_au', :'N31', :'T1', 'internal', '残すコメント');
select test.check('chg_flow_notices_before_delete',
  format('%s|%s', test.notices_all(:'N30'), test.notices_all(:'N31')),
  'ap:in_app:comment_added,as:in_app:comment_added,mn:in_app:mention,pc:in_app:comment_added,rv:in_app:comment_added'
  || '|ap:in_app:comment_added,as:in_app:comment_added,pc:in_app:comment_added,rv:in_app:comment_added');
select test.run(:'u_au', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'N30'));
select test.check('chg_flow_soft_delete_retracts',
  format('%s|%s', test.notices_all(:'N30'), test.notices_all(:'N31')),
  '|ap:in_app:comment_added,as:in_app:comment_added,pc:in_app:comment_added,rv:in_app:comment_added');
rollback;

-- ポータルの修正依頼で ball_passed に書き換えた行は、コメントを消しても残る
begin;
select test.add_comment('service_role', :'u_cl', :'N32', :'T3', 'client', '修正をお願いします');
update public.notifications set type = 'ball_passed'
 where dedupe_key = 'task_comment:' || :'N32' and to_user_id = :'u_rv';
select test.run(:'u_cl', 'authenticated', format('update public.task_comments set deleted_at = now() where id = %L', :'N32'));
select test.check('chg_flow_soft_delete_keeps_ball_passed', test.notices_all(:'N32'), 'rv:in_app:ball_passed');
rollback;
