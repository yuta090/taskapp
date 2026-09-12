-- =============================================================================
-- public の表・ビュー・シーケンスの権限は、アプリが使う物だけ
--
-- 規則:
--   anon（未ログイン）と PUBLIC は、public の表・ビュー・シーケンスの権限を持たない（列ごとの付与も）。アプリは未ログインで
--     表を使わない（公開ページはサーバーの鍵か SECURITY DEFINER の関数で読む）。
--   authenticated は、表とビューでは select / insert / update / delete だけを持つ（truncate / references / trigger / maintain は
--     持たない）。どの表で何を持つかは今のまま（行は RLS で絞る）。列ごとの付与（select / insert / update）も今のまま。
--   authenticated は、シーケンスでは usage だけを持つ（タスクを作るトリガー set_task_short_id が nextval を呼ぶ）。
--   service_role はそのまま。
--   既定の付与: postgres がこれから public に作る表・ビュー・シーケンスも同じ（anon には付かない。authenticated には、表と
--     ビューなら select / insert / update / delete、シーケンスなら usage が付く）。supabase_admin が作る物の既定の付与は
--     postgres からは変えられない（anon / authenticated にも全部付く）。public の表・ビュー・シーケンスは postgres で作る
--     （migration は postgres で流す）。
--
-- 書き方: 表に revoke all をすると、同じ種類の列ごとの付与（select / insert / update）も消える。そのため authenticated からは
--   「select / insert / update / delete 以外」の権限を、今の付与の一覧（aclexplode）から名前を組み立てて外す（DO 文の中）。
--   anon と PUBLIC は列ごとの付与を持たない（節 0 で確かめる）ので revoke all で外す。
--   既定の付与の authenticated は、いったん全部を外してから select / insert / update / delete（シーケンスは usage）を付ける。
-- ロック: 表のロックは取らない（pg_class の行を書き換えるだけ）。同じ表の DDL がコミット前なら待つので、先頭で待つのを 3 秒までに
--   する。取れなければ全体を取り消すので、流し直す（DO 文の中で決める。空の DB から順に流す確認はトランザクションで包まない）。
-- 冪等: revoke / grant / alter default privileges は 2 回流しても同じ。
-- 可逆: 節 1〜4 の末尾のロールバック節（後ろの節から順に流す）。2026-09-12 の棚卸しの形に戻す。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 待つのは 3 秒まで・当てる前の形の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
end $$;

-- 当てる前の形（2026-09-12 の棚卸し）であることを確かめる。違えば止める（本番だけにある付与を、知らずに外さないため。
--   止まったら棚卸しをやり直して一覧を直す）。空の DB では、この形か、その一部になる。
--   1) anon か PUBLIC の権限がある物は、一覧（anon）の中だけ
--   2) authenticated に select / insert / update / delete 以外の権限がある表・ビューは、一覧（authenticated）の中だけ。
--      シーケンスで usage 以外があるのは tasks_short_id_seq だけ
--   3) 列ごとの付与: anon と PUBLIC は持たない。authenticated は select / insert / update だけ
--   4) anon / authenticated / PUBLIC への付与（表と列）は、どれも今の役割（postgres）が付けた物で、付け直す権利を持たない
--   5) postgres が public に作る表・シーケンスの既定の付与は、Supabase の既定（anon / authenticated / service_role に全部）か、
--      本 migration の形か、無し
-- 列ごとの付与と、authenticated の読み書き（表とビューの select / insert / update / delete・シーケンスの usage）の今の形は、
--   この接続の設定（app.table_privileges_before）に控え、節 5 で同じか確かめる。
do $$
declare
  -- 棚卸しで anon に権限があった物（表 46・シーケンス 1）
  v_anon_listed text[] := array[
    'ai_usage_events', 'api_key_usage', 'api_keys', 'applied_migrations', 'audit_logs', 'auth_event_logs',
    'billing_quotes', 'blog_posts', 'cli_usage_logs', 'client_reminder_log', 'connector_inbound_events',
    'connector_jobs', 'connector_task_links', 'cta_blocks', 'email_action_tokens', 'export_templates', 'files',
    'github_installations', 'github_issues', 'github_pull_requests', 'github_repositories',
    'github_webhook_events', 'integration_connections', 'notification_email_prefs', 'org_ai_config',
    'org_free_cap_nudge', 'org_pool_exhausted_nudge', 'plans', 'proposal_respondents', 'proposal_slots',
    'push_subscriptions', 'scheduling_proposals', 'scheduling_reminder_log', 'slack_message_logs',
    'slack_workspaces', 'slot_responses', 'space_github_repos', 'space_slack_channels', 'task_comments',
    'task_due_reminder_occurrences', 'task_github_issue_links', 'task_github_issue_rollups', 'task_github_links',
    'tasks_short_id_seq', 'user_preferences', 'user_task_mirror_jobs', 'user_task_mirror_refs'
  ];
  -- 棚卸しで authenticated に select / insert / update / delete 以外の権限があった表（79）
  v_auth_listed text[] := array[
    'ai_usage_events', 'announcement_reads', 'announcements', 'api_key_usage', 'api_keys', 'applied_migrations',
    'audit_logs', 'auth_event_logs', 'billing_quotes', 'blog_posts', 'cli_usage_logs', 'client_reminder_log',
    'connector_inbound_events', 'connector_jobs', 'connector_task_links', 'cta_blocks', 'discussion_comments',
    'discussion_items', 'email_action_tokens', 'export_templates', 'files', 'github_installations',
    'github_issues', 'github_pull_requests', 'github_repositories', 'github_webhook_events',
    'integration_connections', 'invites', 'llm_runs', 'mcp_confirm_tokens', 'meeting_drafts',
    'meeting_participants', 'meeting_transcripts', 'meetings', 'milestone_publications', 'milestones',
    'notification_email_prefs', 'notifications', 'onboarding_progress', 'org_ai_config', 'org_billing',
    'org_free_cap_nudge', 'org_memberships', 'org_pool_exhausted_nudge', 'organizations', 'plans', 'profiles',
    'proposal_respondents', 'proposal_slots', 'push_subscriptions', 'review_approvals', 'reviews',
    'scheduling_proposals', 'scheduling_reminder_log', 'slack_message_logs', 'slack_workspaces', 'slot_responses',
    'space_github_repos', 'space_groups', 'space_memberships', 'space_slack_channels', 'spaces', 'task_comments',
    'task_due_reminder_occurrences', 'task_events', 'task_github_issue_links', 'task_github_issue_rollups',
    'task_github_links', 'task_owners', 'task_pricing', 'task_publications', 'task_relations', 'tasks',
    'user_preferences', 'user_task_mirror_jobs', 'user_task_mirror_refs', 'wiki_page_publications',
    'wiki_page_versions', 'wiki_pages'
  ];
  v_bad  text := '';
  v_text text;
  v_want text;
  v_def  record;
begin
  -- 1) anon か PUBLIC の権限がある物は、一覧の中だけ
  select string_agg(c.relname, ', ' order by c.relname)
    into v_text
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole))
     and c.relname <> all (v_anon_listed);
  if v_text is not null then
    v_bad := v_bad || ' 一覧に無い物に anon か PUBLIC の権限: ' || v_text || ';';
  end if;

  -- 2) authenticated の読み書き以外の権限がある物は、一覧の中だけ
  select string_agg(c.relname, ', ' order by c.relname)
    into v_text
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and ((c.relkind in ('r', 'p', 'v', 'm', 'f')
           and exists (select 1 from aclexplode(c.relacl) a
                        where a.grantee = 'authenticated'::regrole
                          and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
           and c.relname <> all (v_auth_listed))
       or (c.relkind = 'S'
           and exists (select 1 from aclexplode(c.relacl) a
                        where a.grantee = 'authenticated'::regrole and a.privilege_type <> 'USAGE')
           and c.relname <> 'tasks_short_id_seq'));
  if v_text is not null then
    v_bad := v_bad || ' 一覧に無い物に authenticated の読み書き以外の権限: ' || v_text || ';';
  end if;

  -- 3) 列ごとの付与: anon と PUBLIC は持たない・authenticated は select / insert / update だけ
  select string_agg(distinct c.relname || '.' || at.attname, ', ')
    into v_text
    from pg_attribute at
    join pg_class c on c.oid = at.attrelid,
         aclexplode(at.attacl) x
   where c.relnamespace = 'public'::regnamespace
     and at.attnum > 0 and not at.attisdropped
     and (x.grantee in (0, 'anon'::regrole)
          or (x.grantee = 'authenticated'::regrole and x.privilege_type not in ('SELECT', 'INSERT', 'UPDATE')));
  if v_text is not null then
    v_bad := v_bad || ' 想定と違う列ごとの付与: ' || v_text || ';';
  end if;

  -- 4) anon / authenticated / PUBLIC への付与は、今の役割が付けた物で、付け直す権利を持たない（表と列）
  select string_agg(distinct g.relname, ', ')
    into v_text
    from (select c.relname, a.grantee, a.grantor, a.is_grantable
            from pg_class c,
                 aclexplode(c.relacl) a
           where c.relnamespace = 'public'::regnamespace
             and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
          union all
          select c.relname, x.grantee, x.grantor, x.is_grantable
            from pg_attribute at
            join pg_class c on c.oid = at.attrelid,
                 aclexplode(at.attacl) x
           where c.relnamespace = 'public'::regnamespace
             and at.attnum > 0 and not at.attisdropped) g
   where g.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
     and (g.is_grantable or g.grantor <> current_user::text::regrole);
  if v_text is not null then
    v_bad := v_bad || ' ほかの役割が付けたか、付け直す権利のある付与: ' || v_text || ';';
  end if;

  -- 5) postgres が public に作る表（r）・シーケンス（S）の既定の付与
  for v_def in
    select t.objtype,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'anon'::regrole), '') as anon_privs,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'authenticated'::regrole), '') as auth_privs,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'service_role'::regrole), '') as svc_privs
      from (values ('r'::"char"), ('S'::"char")) as t(objtype)
      left join pg_default_acl d
        on d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = t.objtype
  loop
    -- 期待する形はいったん変数に入れる（plpgsql は if の条件の中の case の then を条件の終わりと読む）
    if v_def.objtype = 'r' then
      v_want := 'DELETE,INSERT,SELECT,UPDATE';
    else
      v_want := 'USAGE';
    end if;
    if not ((v_def.anon_privs = '' and v_def.auth_privs = '')
            or (v_def.anon_privs = '' and v_def.auth_privs = v_want)
            or (v_def.svc_privs <> '' and v_def.anon_privs = v_def.svc_privs and v_def.auth_privs = v_def.svc_privs)) then
      v_bad := v_bad || format(' 既定の付与（%s）: anon=%s authenticated=%s;', v_def.objtype, v_def.anon_privs, v_def.auth_privs);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'table privileges: 当てる前の形と違います:%', v_bad;
  end if;

  -- 列ごとの付与と authenticated の読み書きの今の形を、この接続の設定に控える
  perform set_config('app.table_privileges_before',
    (select md5(coalesce(string_agg(g.k, ',' order by g.k), ''))
       from (select 'col ' || c.relname || '.' || at.attname || ' ' || x.privilege_type as k
               from pg_attribute at
               join pg_class c on c.oid = at.attrelid,
                    aclexplode(at.attacl) x
              where c.relnamespace = 'public'::regnamespace
                and at.attnum > 0 and not at.attisdropped
                and x.grantee = 'authenticated'::regrole
             union all
             select 'rel ' || c.relname || ' ' || a.privilege_type
               from pg_class c,
                    aclexplode(c.relacl) a
              where c.relnamespace = 'public'::regnamespace
                and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                and a.grantee = 'authenticated'::regrole
                and ((c.relkind <> 'S' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
                  or (c.relkind = 'S' and a.privilege_type = 'USAGE'))) g),
    false);
end $$;

-- ロールバック（節 0）: なし（待つ時間はトランザクションの終わりで戻る。確認は何も変えない）
-- =============================================================================
-- 節 1: anon と PUBLIC は、public の表・ビュー・シーケンスの権限を持たない
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel, c.relkind
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole))
     order by c.oid::regclass::text
  loop
    execute format('revoke all on %s %s from public, anon',
                   case when r.relkind = 'S' then 'sequence' else 'table' end, r.rel);
  end loop;
end $$;

-- ロールバック（節 1。棚卸しの形に戻す。無い表は飛ばす）:
--   do $$
--   declare
--     r record;
--     n text;
--   begin
--     for r in
--       select * from (values
--         ('all', 'sequence', array[
--           'tasks_short_id_seq'
--         ]),
--         ('all', 'table', array[
--           'ai_usage_events', 'api_key_usage', 'applied_migrations', 'audit_logs', 'auth_event_logs',
--           'billing_quotes', 'blog_posts', 'cli_usage_logs', 'client_reminder_log', 'connector_inbound_events',
--           'connector_jobs', 'connector_task_links', 'cta_blocks', 'email_action_tokens', 'export_templates', 'files',
--           'github_installations', 'github_repositories', 'github_webhook_events', 'notification_email_prefs',
--           'org_ai_config', 'org_free_cap_nudge', 'org_pool_exhausted_nudge', 'proposal_respondents',
--           'proposal_slots', 'push_subscriptions', 'scheduling_proposals', 'scheduling_reminder_log',
--           'slack_message_logs', 'slack_workspaces', 'slot_responses', 'space_github_repos', 'space_slack_channels',
--           'task_comments', 'task_due_reminder_occurrences', 'task_github_issue_links', 'task_github_issue_rollups',
--           'task_github_links', 'user_preferences', 'user_task_mirror_jobs', 'user_task_mirror_refs'
--         ]),
--         ('delete, insert, maintain, references, trigger, truncate, update', 'table', array[
--           'github_issues', 'github_pull_requests', 'integration_connections'
--         ]),
--         ('maintain, references, trigger', 'table', array[
--           'api_keys'
--         ]),
--         ('maintain, select', 'table', array[
--           'plans'
--         ])
--       ) as v(privs, kind, names)
--     loop
--       foreach n in array r.names loop
--         if to_regclass('public.' || quote_ident(n)) is not null then
--           execute format('grant %s on %s public.%I to anon', r.privs, r.kind, n);
--         end if;
--       end loop;
--     end loop;
--   end $$;
-- =============================================================================
-- 節 2: authenticated は、表とビューでは select / insert / update / delete だけ
--   外す権限の名前は、今の付与の一覧から組み立てる（表に revoke all をすると列ごとの付与も消えるため）。
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel,
           string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
      from pg_class c,
           aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and a.grantee = 'authenticated'::regrole
       and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     group by c.oid
     order by c.oid::regclass::text
  loop
    execute format('revoke %s on table %s from authenticated', r.privs, r.rel);
  end loop;
end $$;

-- ロールバック（節 2。棚卸しの形に戻す。無い表は飛ばす）:
--   do $$
--   declare
--     r record;
--     n text;
--   begin
--     for r in
--       select * from (values
--         ('maintain', 'table', array[
--           'announcement_reads', 'announcements', 'discussion_comments', 'discussion_items', 'invites', 'llm_runs',
--           'mcp_confirm_tokens', 'meeting_drafts', 'meeting_participants', 'meeting_transcripts', 'meetings',
--           'milestone_publications', 'milestones', 'notifications', 'onboarding_progress', 'org_billing',
--           'org_memberships', 'organizations', 'plans', 'profiles', 'review_approvals', 'reviews', 'space_groups',
--           'space_memberships', 'spaces', 'task_events', 'task_owners', 'task_pricing', 'task_publications',
--           'task_relations', 'tasks', 'wiki_page_publications', 'wiki_page_versions', 'wiki_pages'
--         ]),
--         ('maintain, references, trigger', 'table', array[
--           'api_keys'
--         ]),
--         ('maintain, references, trigger, truncate', 'table', array[
--           'ai_usage_events', 'api_key_usage', 'applied_migrations', 'audit_logs', 'auth_event_logs',
--           'billing_quotes', 'blog_posts', 'cli_usage_logs', 'client_reminder_log', 'connector_inbound_events',
--           'connector_jobs', 'connector_task_links', 'cta_blocks', 'email_action_tokens', 'export_templates', 'files',
--           'github_installations', 'github_issues', 'github_pull_requests', 'github_repositories',
--           'github_webhook_events', 'integration_connections', 'notification_email_prefs', 'org_ai_config',
--           'org_free_cap_nudge', 'org_pool_exhausted_nudge', 'proposal_respondents', 'proposal_slots',
--           'push_subscriptions', 'scheduling_proposals', 'scheduling_reminder_log', 'slack_message_logs',
--           'slack_workspaces', 'slot_responses', 'space_github_repos', 'space_slack_channels', 'task_comments',
--           'task_due_reminder_occurrences', 'task_github_issue_links', 'task_github_issue_rollups',
--           'task_github_links', 'user_preferences', 'user_task_mirror_jobs', 'user_task_mirror_refs'
--         ])
--       ) as v(privs, kind, names)
--     loop
--       foreach n in array r.names loop
--         if to_regclass('public.' || quote_ident(n)) is not null then
--           execute format('grant %s on %s public.%I to authenticated', r.privs, r.kind, n);
--         end if;
--       end loop;
--     end loop;
--   end $$;
-- =============================================================================
-- 節 3: authenticated は、シーケンスでは usage だけ
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel,
           string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
      from pg_class c,
           aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'S'
       and a.grantee = 'authenticated'::regrole
       and a.privilege_type <> 'USAGE'
     group by c.oid
     order by c.oid::regclass::text
  loop
    execute format('revoke %s on sequence %s from authenticated', r.privs, r.rel);
  end loop;
end $$;

-- ロールバック（節 3）:
--   grant select, update on sequence public.tasks_short_id_seq to authenticated;
-- =============================================================================
-- 節 4: postgres がこれから public に作る表・ビュー・シーケンスの既定の付与
--   anon には付けない。authenticated は、表とビューなら select / insert / update / delete、シーケンスなら usage。
--   supabase_admin の既定の付与は postgres からは変えられない（上の規則のとおり、public の物は postgres で作る）。
-- =============================================================================

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from authenticated;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on sequences from authenticated;
alter default privileges for role postgres in schema public grant usage on sequences to authenticated;

-- ロールバック（節 4。Supabase の既定＝anon / authenticated にも全部、に戻す）:
--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
-- =============================================================================
-- 節 5: 末尾の確認（何も変えない）… 権限と既定の付与が規則どおりで、列ごとの付与と authenticated の読み書きは
--   当てる前と同じ。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_want text;
  v_def  record;
begin
  -- anon と PUBLIC: public の表・ビュー・シーケンスの権限も、列ごとの付与も無い
  select string_agg(distinct g.relname, ', ')
    into v_text
    from (select c.relname, a.grantee
            from pg_class c,
                 aclexplode(c.relacl) a
           where c.relnamespace = 'public'::regnamespace
             and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
          union all
          select c.relname, x.grantee
            from pg_attribute at
            join pg_class c on c.oid = at.attrelid,
                 aclexplode(at.attacl) x
           where c.relnamespace = 'public'::regnamespace
             and at.attnum > 0 and not at.attisdropped) g
   where g.grantee in (0, 'anon'::regrole);
  if v_text is not null then
    v_bad := v_bad || ' anon か PUBLIC の権限: ' || v_text || ';';
  end if;

  -- authenticated: 表とビューは select / insert / update / delete だけ・シーケンスは usage だけ
  select string_agg(c.relname, ', ' order by c.relname)
    into v_text
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and exists (select 1 from aclexplode(c.relacl) a
                  where a.grantee = 'authenticated'::regrole
                    and ((c.relkind in ('r', 'p', 'v', 'm', 'f')
                          and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
                      or (c.relkind = 'S' and a.privilege_type <> 'USAGE')));
  if v_text is not null then
    v_bad := v_bad || ' authenticated の読み書き以外の権限: ' || v_text || ';';
  end if;

  -- 列ごとの付与と authenticated の読み書きは、当てる前（節 0 の控え）と同じ
  select (select md5(coalesce(string_agg(g.k, ',' order by g.k), ''))
         from (select 'col ' || c.relname || '.' || at.attname || ' ' || x.privilege_type as k
                 from pg_attribute at
                 join pg_class c on c.oid = at.attrelid,
                      aclexplode(at.attacl) x
                where c.relnamespace = 'public'::regnamespace
                  and at.attnum > 0 and not at.attisdropped
                  and x.grantee = 'authenticated'::regrole
               union all
               select 'rel ' || c.relname || ' ' || a.privilege_type
                 from pg_class c,
                      aclexplode(c.relacl) a
                where c.relnamespace = 'public'::regnamespace
                  and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                  and a.grantee = 'authenticated'::regrole
                  and ((c.relkind <> 'S' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
                    or (c.relkind = 'S' and a.privilege_type = 'USAGE'))) g)
    into v_text;
  if v_text is distinct from current_setting('app.table_privileges_before', true) then
    v_bad := v_bad || ' 列ごとの付与か authenticated の読み書きが、当てる前と違う;';
  end if;

  -- 既定の付与: anon には無い。authenticated は、表なら select / insert / update / delete、シーケンスなら usage
  for v_def in
    select t.objtype,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'anon'::regrole), '') as anon_privs,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'authenticated'::regrole), '') as auth_privs,
           coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                       from aclexplode(d.defaclacl) a where a.grantee = 'service_role'::regrole), '') as svc_privs
      from (values ('r'::"char"), ('S'::"char")) as t(objtype)
      left join pg_default_acl d
        on d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = t.objtype
  loop
    -- 期待する形はいったん変数に入れる（plpgsql は if の条件の中の case の then を条件の終わりと読む）
    if v_def.objtype = 'r' then
      v_want := 'DELETE,INSERT,SELECT,UPDATE';
    else
      v_want := 'USAGE';
    end if;
    if v_def.anon_privs <> '' or v_def.auth_privs <> v_want then
      v_bad := v_bad || format(' 既定の付与（%s）: anon=%s authenticated=%s;', v_def.objtype, v_def.anon_privs, v_def.auth_privs);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'table privileges: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 5）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_table_privileges.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh（表・ビュー・シーケンスの権限の検査つき）
--   1) 適用前（本番・読むだけ）: anon の付与がある物の数・authenticated の読み書き以外の付与がある物の数・既定の付与:
--        select count(*) filter (where exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole)) as anon_rels,
--               count(*) filter (where exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'authenticated'::regrole
--                                                and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'USAGE'))) as auth_extra_rels
--          from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S');
--        select defaclobjtype, defaclacl from pg_default_acl
--         where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace order by 1;
--   2) ドライラン（本番・最後に rollback）: begin; → 本 migration → 同じトランザクションで 1) を流し（anon 0・読み書き以外 0・
--      既定の付与は anon なし／authenticated は arwd と U）、持っているロックに public の表が無いことを見る:
--        select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
--         where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace;
--      → rollback;
--   3) 適用後（本番）: 節 5 が通る。1) が 0・0。
--   4) 画面: ログインしてタスクを作れる（番号が付く）・ベル・ファイル・Wiki・会議の議事録が今までどおり。
--      未ログインで開けるページ（トップ・料金・TASK6・ヘルプ）が今までどおり。
-- =============================================================================
