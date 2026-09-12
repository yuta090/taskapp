-- =============================================================================
-- public の表・ビュー・シーケンスの権限（*_table_privileges.sql）の挙動検証
-- 前提: run_table_privileges.sh が _local_bootstrap → Supabase の権限の代役（既定の付与を含む）→ migrations（本 migration の手前まで）→
--   table_privileges_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。データと人物・控えは seed のとおり。
-- 画面と同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。未ログインは set role anon。
-- サーバーの鍵と同じ読み書きは set role service_role（RLS を通らない）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "TABLE PRIVILEGES CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}'
\set rw 'DELETE,INSERT,SELECT,UPDATE'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: どの役割の視点のままでも記録できる）
--   want が 'like:' で始まるときは LIKE で、それ以外は完全一致で比べる。
create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql security definer set search_path = test, public as $$
declare
  v_ok boolean := coalesce(
    case when p_want like 'like:%' then p_got like substr(p_want, 6) else p_got = p_want end, false);
begin
  insert into test.results(label, ok, got, want) values (p_label, v_ok, p_got, p_want);
  if v_ok then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

-- 呼んだ人の権限で SQL を順に流し、最後に p_probe の値を返して必ず巻き戻す（ok:<値> / err:<SQLSTATE>:<メッセージ>）
create or replace function test.flow(p_sqls text[], p_probe text)
returns text language plpgsql security invoker as $$
declare s text; v text; v_state text; v_detail text; v_msg text;
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

-- 表・ビューの anon と authenticated の権限（名前の順。無ければ -）
create or replace function test.rel_privs(p_rel text)
returns text language sql stable as $$
  select 'anon=' || coalesce((select string_agg(x.priv, ',' order by x.priv collate "C")
                                from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as x(priv)
                               where has_table_privilege('anon', p_rel, x.priv)), '-')
      || ' authenticated=' || coalesce((select string_agg(x.priv, ',' order by x.priv collate "C")
                                          from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as x(priv)
                                         where has_table_privilege('authenticated', p_rel, x.priv)), '-')
$$;

-- シーケンスの anon と authenticated の権限
create or replace function test.seq_privs(p_seq text)
returns text language sql stable as $$
  select 'anon=' || coalesce((select string_agg(x.priv, ',' order by x.priv collate "C")
                                from unnest(array['SELECT', 'UPDATE', 'USAGE']) as x(priv)
                               where has_sequence_privilege('anon', p_seq, x.priv)), '-')
      || ' authenticated=' || coalesce((select string_agg(x.priv, ',' order by x.priv collate "C")
                                          from unnest(array['SELECT', 'UPDATE', 'USAGE']) as x(priv)
                                         where has_sequence_privilege('authenticated', p_seq, x.priv)), '-')
$$;

-- postgres が public に作る物の既定の付与（r = 表・ビュー、S = シーケンス）
create or replace function test.default_privs(p_objtype "char")
returns text language sql stable as $$
  select 'anon=' || coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type collate "C")
                                from pg_default_acl d, aclexplode(d.defaclacl) a
                               where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                                 and d.defaclobjtype = p_objtype and a.grantee = 'anon'::regrole), '-')
      || ' authenticated=' || coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type collate "C")
                                          from pg_default_acl d, aclexplode(d.defaclacl) a
                                         where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                                           and d.defaclobjtype = p_objtype and a.grantee = 'authenticated'::regrole), '-')
$$;

-- タスクの番号（short_id）が付いているか。RLS に隠されずに読む
create or replace function test.task_numbered(p_title text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select bool_and(t.short_id is not null)::text from public.tasks t where t.title = p_title), 'no row')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: 権限・列ごとの付与・既定の付与・ビューと RLS の無い表
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_anon_has_no_privileges', (
  select count(distinct g.relname)::text
    from (select c.relname, a.grantee from pg_class c, aclexplode(c.relacl) a
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
          union all
          select c.relname, x.grantee from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x
           where c.relnamespace = 'public'::regnamespace and at.attnum > 0 and not at.attisdropped) g
   where g.grantee in (0, 'anon'::regrole)
), '0');

select test.check('chg_authenticated_read_write_only', (
  select count(*)::text from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and exists (select 1 from aclexplode(c.relacl) a
                  where a.grantee = 'authenticated'::regrole
                    and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
), '0');

select test.check('chg_sequence_privileges', test.seq_privs('public.tasks_short_id_seq'), 'anon=- authenticated=USAGE');

select test.check('same_authenticated_read_write_unchanged', (
  select ((select md5(string_agg(relname || ':' || privilege_type, ',' order by relname collate "C", privilege_type collate "C"))
             from snap.authenticated_rw)
          = (select md5(string_agg(c.relname || ':' || a.privilege_type, ',' order by c.relname collate "C", a.privilege_type collate "C"))
               from pg_class c, aclexplode(c.relacl) a
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                and a.grantee = 'authenticated'::regrole
                and ((c.relkind <> 'S' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
                  or (c.relkind = 'S' and a.privilege_type = 'USAGE'))))::text
), 'true');

select test.check('same_column_grants_unchanged', (
  select ((select md5(string_agg(relname || '.' || attname || ':' || grantee || ':' || privilege_type, ','
                                 order by relname collate "C", attname collate "C", grantee collate "C", privilege_type collate "C"))
             from snap.column_grants)
          = (select md5(string_agg(c.relname || '.' || at.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type, ','
                                   order by c.relname collate "C", at.attname collate "C", x.grantee::regrole::text collate "C",
                                            x.privilege_type collate "C"))
               from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x
              where c.relnamespace = 'public'::regnamespace and at.attnum > 0 and not at.attisdropped))::text
), 'true');

-- 列ごとの付与は本番（2026-09-12）と同じ数（meetings は 18 列 × select / insert / update）
select test.check('same_column_grants_match_production', (
  select string_agg(relname || ':' || n, ',' order by relname collate "C")
    from (select c.relname::text as relname, count(*)::text as n
            from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x
           where c.relnamespace = 'public'::regnamespace and at.attnum > 0 and not at.attisdropped
             and x.grantee = 'authenticated'::regrole
           group by c.relname) s
), 'github_issues:13,github_pull_requests:13,integration_connections:21,integration_sinks:14,invites:9,meetings:54,notifications:1');

select test.check('same_service_role_unchanged', (
  select ((select md5(string_agg(relname || ':' || privilege_type, ',' order by relname collate "C", privilege_type collate "C"))
             from snap.service_role)
          = (select md5(string_agg(c.relname || ':' || a.privilege_type, ',' order by c.relname collate "C", a.privilege_type collate "C"))
               from pg_class c, aclexplode(c.relacl) a
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                and a.grantee = 'service_role'::regrole))::text
), 'true');

select test.check('chg_default_privileges_tables', test.default_privs('r'), 'anon=- authenticated=' || :'rw');
select test.check('chg_default_privileges_sequences', test.default_privs('S'), 'anon=- authenticated=USAGE');

-- security_invoker でないビューに anon / authenticated / PUBLIC の権限が無い
select test.check('same_views_without_invoker_have_no_privileges', (
  select count(*)::text from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
     and not coalesce(c.reloptions @> array['security_invoker=true'], false)
     and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))
), '0');

-- RLS が無効な表に anon / authenticated / PUBLIC の書き込みの権限が無い
select test.check('same_rls_off_tables_have_no_writes', (
  select count(*)::text from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
     and exists (select 1 from aclexplode(c.relacl) a
                  where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
                    and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
), '0');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

-- これから postgres が作る表・ビュー・シーケンスに付く権限（作ってすぐ取り消す。値は psql の変数に控える）
\set new_table 'unset'
\set new_view 'unset'
\set new_seq 'unset'
begin;
create table public._probe_new_table (id int);
create view public._probe_new_view as select 1 as x;
create sequence public._probe_new_seq;
select test.rel_privs('public._probe_new_table') as new_table,
       test.rel_privs('public._probe_new_view') as new_view,
       test.seq_privs('public._probe_new_seq') as new_seq \gset
rollback;
select test.check('chg_new_table_privileges', :'new_table', 'anon=- authenticated=' || :'rw');
select test.check('chg_new_view_privileges', :'new_view', 'anon=- authenticated=' || :'rw');
select test.check('chg_new_sequence_privileges', :'new_seq', 'anon=- authenticated=USAGE');

-- -----------------------------------------------------------------------------
-- 未ログイン（anon）: 公開中の記事・案内枠・料金表も含め、表とシーケンスは権限で断られる
-- -----------------------------------------------------------------------------
\echo '== anon =='
begin;
set local role anon;
select set_config('request.jwt.claims', '', true);
select test.check('chg_anon_cannot_read_blog_posts', test.flow(array[]::text[],
  $q$select count(*)::text from public.blog_posts where slug = 'post-1'$q$), 'err:42501:permission denied for table blog_posts');
select test.check('chg_anon_cannot_read_cta_blocks', test.flow(array[]::text[],
  $q$select count(*)::text from public.cta_blocks where key = 'cta-1'$q$), 'err:42501:permission denied for table cta_blocks');
select test.check('chg_anon_cannot_read_plans', test.flow(array[]::text[],
  $q$select count(*)::text from public.plans where id = 'probe-plan'$q$), 'err:42501:permission denied for table plans');
select test.check('chg_anon_cannot_insert_ai_usage_events', test.flow(
  array[format($q$insert into public.ai_usage_events(org_id, provider, model) values (%L, 'p', 'm')$q$, :'O1')],
  $q$select 'inserted'$q$), 'err:42501:permission denied for table ai_usage_events');
select test.check('chg_anon_cannot_take_task_numbers', test.flow(array[]::text[],
  $q$select nextval('public.tasks_short_id_seq')::text$q$), 'err:42501:permission denied for sequence tasks_short_id_seq');
commit;

-- -----------------------------------------------------------------------------
-- ログイン中の人（O1 owner・S1 admin）: タスクを作れて番号が付く（シーケンスの usage）。読み書きは今までどおり。
--   truncate と、番号の付け直し（setval）はできない
-- -----------------------------------------------------------------------------
\echo '== logged in =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_member_creates_task_with_number', test.flow(
  array[format($q$insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, 'probe task', 'todo', %L)$q$,
               :'O1', :'S1', :'u_own')],
  $q$select test.task_numbered('probe task')$q$), 'ok:true');
select test.check('same_member_takes_task_number', test.flow(array[]::text[],
  $q$select (nextval('public.tasks_short_id_seq') > 0)::text$q$), 'ok:true');
select test.check('chg_member_cannot_reset_task_numbers', test.flow(array[]::text[],
  $q$select setval('public.tasks_short_id_seq', 1)::text$q$), 'err:42501:permission denied for sequence tasks_short_id_seq');
select test.check('chg_member_cannot_truncate', test.flow(
  array[$q$truncate public.cli_usage_logs$q$],
  $q$select 'truncated'$q$), 'err:42501:permission denied for table cli_usage_logs');
select test.check('same_member_reads_plans', test.flow(array[]::text[],
  $q$select count(*)::text from public.plans where id = 'probe-plan'$q$), 'ok:1');
-- 列ごとの付与（invites は 9 列の select だけ）は今までどおり効く
select test.check('same_member_invites_column_select', test.flow(array[]::text[],
  $q$select count(*)::text from public.invites$q$), 'ok:0');
select test.check('same_member_invites_token_denied', test.flow(array[]::text[],
  $q$select count(token)::text from public.invites$q$), 'err:42501:permission denied for table invites');
commit;

-- -----------------------------------------------------------------------------
-- service_role（サーバーの鍵）: 今までどおり読み書きできる
-- -----------------------------------------------------------------------------
\echo '== service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select test.check('same_service_role_reads_blog_posts', test.flow(array[]::text[],
  $q$select count(*)::text from public.blog_posts where slug = 'post-1'$q$), 'ok:1');
select test.check('same_service_role_writes_ai_usage_events', test.flow(
  array[format($q$insert into public.ai_usage_events(org_id, provider, model) values (%L, 'p', 'm')$q$, :'O1')],
  $q$select count(*)::text from public.ai_usage_events$q$), 'ok:1');
commit;

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
    raise exception 'TABLE PRIVILEGES CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'TABLE PRIVILEGES CHECKS PASSED' as result;
