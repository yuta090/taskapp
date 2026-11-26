-- =============================================================================
-- ダッシュボードの「最近のアクティビティ」: 誰がこのプロジェクトで何をしたかの一覧
--
-- 出どころは change_log（全書き込みをトリガーで控えている表・20260926091821_change_log.sql）。
-- audit_logs は画面の一部の操作でしか書かれず、コメント・Wiki・ファイル・CLI の操作が残らないため使わない。
--
-- change_log は利用者の役割からは1行も読めない（行の中身をまるごと持っているため）。ここでは
--   - プロジェクトの社内メンバー（app_is_space_internal）だけが呼べる
--   - 返すのは種類・題名・最小限の差分だけ（old_row / new_row は返さない。Wiki の本文・料金なども返さない）
-- という security definer の関数を1本だけ開ける。相手先（client）・協力会社（vendor）は呼べない。
--
-- 冪等: index は if not exists、関数は create or replace。
-- =============================================================================

set local lock_timeout = '3s';

-- 節 1: プロジェクト＋新しい順で読む索引（space_id の無い行は対象外）
create index if not exists change_log_space_occurred_idx
  on public.change_log (space_id, occurred_at desc, id desc)
  where space_id is not null;

-- ロールバック（節 1）: drop index if exists public.change_log_space_occurred_idx;


-- 節 2: 関数
--   kind の一覧（画面の文言は src/lib/dashboard/activity.ts）:
--     task_created / task_completed / task_status / task_ball / task_assignee / task_deleted
--     comment_added / file_uploaded / file_deleted / wiki_created / wiki_edited / wiki_deleted
--     review_approved / review_changes_requested
--   Wiki の編集は自動保存で数秒ごとに行が増えるので、同じ人・同じページで 30 分以内に続いた作成・編集を
--   1件にまとめる（作成を含むまとまりは「作成」1件、編集だけなら最後の編集1件）。
create or replace function public.rpc_space_activity(
  p_space_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null,
  -- 続きを読むときは、前のページの最後の行の (occurred_at, id, kind) を3つとも渡す。
  -- 1つの更新（同じ id・同じ時刻）から複数の kind が出るので、時刻だけで区切ると境目の行が落ちる
  p_before_id bigint default null,
  p_before_kind text default null
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_user_id uuid,
  channel text,
  kind text,
  target_id uuid,
  task_id uuid,
  title text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
-- 返す列の名前（id・kind・title など）が表の列名と同じなので、SQL の中では表の列を優先させる
#variable_conflict use_column
declare
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'MFA required';
  end if;

  select s.org_id into v_org from public.spaces s where s.id = p_space_id;
  if v_org is null or not public.app_is_space_internal(p_space_id, v_org) then
    raise exception 'Not authorized';
  end if;

  return query
  with base as (
    -- まとめる前の素の行。Wiki の自動保存で行数が多いので、読む行数に上限を付ける
    select c.*
    from public.change_log c
    where c.space_id = p_space_id
      and c.table_name in ('tasks', 'task_comments', 'files', 'wiki_pages')
      and (p_before is null or c.occurred_at <= p_before)
    order by c.occurred_at desc, c.id desc
    limit 2000
  ),
  approvals as (
    -- review_approvals には space_id が無いので、依頼（reviews）からプロジェクトを引く
    select c.id, c.occurred_at, c.actor_user_id, c.channel,
           case when c.new_row ->> 'state' = 'approved' then 'review_approved' else 'review_changes_requested' end as kind,
           r.task_id as target_id, r.task_id, t.title, null::jsonb as detail
    from public.change_log c
    join public.reviews r on r.id = (c.new_row ->> 'review_id')::uuid and r.space_id = p_space_id
    left join public.tasks t on t.id = r.task_id
    where c.org_id = v_org
      and c.table_name = 'review_approvals'
      and c.op = 'U'
      and 'state' = any (c.changed_columns)
      and c.new_row ->> 'state' in ('approved', 'blocked')
      and (p_before is null or c.occurred_at <= p_before)
    order by c.occurred_at desc
    limit 200
  ),
  task_events as (
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'task_created'::text as kind,
           (b.row_pk ->> 'id')::uuid as target_id, (b.row_pk ->> 'id')::uuid as task_id,
           b.new_row ->> 'title' as title, null::jsonb as detail
    from base b where b.table_name = 'tasks' and b.op = 'I'
    union all
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'task_deleted',
           (b.row_pk ->> 'id')::uuid, null::uuid, b.old_row ->> 'title', null::jsonb
    from base b where b.table_name = 'tasks' and b.op = 'D'
    union all
    select b.id, b.occurred_at, b.actor_user_id, b.channel,
           case when b.new_row ->> 'status' = 'done' then 'task_completed' else 'task_status' end,
           (b.row_pk ->> 'id')::uuid, (b.row_pk ->> 'id')::uuid, b.new_row ->> 'title',
           jsonb_build_object('from', b.old_row ->> 'status', 'to', b.new_row ->> 'status')
    from base b
    where b.table_name = 'tasks' and b.op = 'U' and 'status' = any (b.changed_columns)
    union all
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'task_ball',
           (b.row_pk ->> 'id')::uuid, (b.row_pk ->> 'id')::uuid, b.new_row ->> 'title',
           jsonb_build_object('to', b.new_row ->> 'ball')
    from base b
    where b.table_name = 'tasks' and b.op = 'U' and 'ball' = any (b.changed_columns)
    union all
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'task_assignee',
           (b.row_pk ->> 'id')::uuid, (b.row_pk ->> 'id')::uuid, b.new_row ->> 'title',
           jsonb_build_object('to', b.new_row ->> 'assignee_id')
    from base b
    where b.table_name = 'tasks' and b.op = 'U' and 'assignee_id' = any (b.changed_columns)
  ),
  comment_events as (
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'comment_added'::text,
           (b.row_pk ->> 'id')::uuid, (b.new_row ->> 'task_id')::uuid, t.title,
           jsonb_build_object('excerpt', left(b.new_row ->> 'body', 80))
    from base b
    left join public.tasks t on t.id = (b.new_row ->> 'task_id')::uuid
    where b.table_name = 'task_comments' and b.op = 'I' and b.new_row ->> 'deleted_at' is null
  ),
  file_events as (
    -- アップロードは「下書き(pending)で作る→送り終えて ready にする」の2段なので、ready になったときを数える
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'file_uploaded'::text,
           (b.row_pk ->> 'id')::uuid, null::uuid, b.new_row ->> 'name', null::jsonb
    from base b
    where b.table_name = 'files' and b.new_row ->> 'status' = 'ready'
      and (b.op = 'I' or (b.op = 'U' and 'status' = any (b.changed_columns)))
    union all
    select b.id, b.occurred_at, b.actor_user_id, b.channel, 'file_deleted',
           (b.row_pk ->> 'id')::uuid, null::uuid, b.old_row ->> 'name', null::jsonb
    from base b
    where b.table_name = 'files' and b.op = 'D' and b.old_row ->> 'status' = 'ready'
  ),
  wiki_raw as (
    -- フォルダ（is_folder）は出さない。フォルダの移動だけ（parent_page_id のみ）の更新も出さない
    select b.id, b.occurred_at, b.actor_user_id, b.channel,
           case b.op when 'I' then 'wiki_created' when 'D' then 'wiki_deleted' else 'wiki_edited' end as kind,
           (b.row_pk ->> 'id')::uuid as target_id,
           coalesce(b.new_row ->> 'title', b.old_row ->> 'title') as title
    from base b
    where b.table_name = 'wiki_pages'
      and coalesce((coalesce(b.new_row, b.old_row) ->> 'is_folder')::boolean, false) = false
      and (b.op in ('I', 'D') or b.changed_columns && array['body', 'title'])
  ),
  wiki_marked as (
    select w.*,
           case
             when w.kind = 'wiki_deleted' then 1
             when lag(w.occurred_at) over p is null then 1
             when w.occurred_at - lag(w.occurred_at) over p > interval '30 minutes' then 1
             else 0
           end as brk
    from wiki_raw w
    window p as (partition by w.actor_user_id, w.target_id order by w.occurred_at, w.id)
  ),
  wiki_grouped as (
    select m.*, sum(m.brk) over (partition by m.actor_user_id, m.target_id order by m.occurred_at, m.id
                                 rows unbounded preceding) as grp
    from wiki_marked m
  ),
  wiki_events as (
    select distinct on (g.actor_user_id, g.target_id, g.grp)
           g.id, g.occurred_at, g.actor_user_id, g.channel, g.kind, g.target_id,
           null::uuid as task_id, g.title, null::jsonb as detail
    from wiki_grouped g
    order by g.actor_user_id, g.target_id, g.grp,
             (g.kind = 'wiki_created') desc, g.occurred_at desc, g.id desc
  ),
  all_events as (
    select * from task_events
    union all select * from comment_events
    union all select * from file_events
    union all select * from wiki_events
    union all select * from approvals
  )
  -- 更新の控え（op='U'）には変わった列しか入らないので、題名は今の行から引く。
  -- 行がもう無い（あとで消した）ときは、その行を作った・消したときの控えから引く
  select e.id, e.occurred_at, e.actor_user_id, e.channel, e.kind, e.target_id, e.task_id,
         coalesce(t.title, f.name, w.title, e.title, (
           select coalesce(c2.old_row, c2.new_row) ->> case when e.kind like 'file\_%' then 'name' else 'title' end
           from public.change_log c2
           where c2.table_name = case
                   when e.kind like 'file\_%' then 'files'
                   when e.kind like 'wiki\_%' then 'wiki_pages'
                   else 'tasks'
                 end
             and (c2.row_pk ->> 'id') = coalesce(e.task_id, e.target_id)::text
             and c2.op in ('I', 'D')
           order by c2.id desc
           limit 1
         )) as title, e.detail
  from (
    select * from all_events a
    where p_before is null
       or a.occurred_at < p_before
       or (a.occurred_at = p_before and p_before_id is not null
           and (a.id < p_before_id or (a.id = p_before_id and a.kind > coalesce(p_before_kind, ''))))
    order by occurred_at desc, id desc, kind
    limit v_limit
  ) e
  left join public.tasks t on e.kind like 'task\_%' and t.id = e.target_id
  left join public.files f on e.kind like 'file\_%' and f.id = e.target_id
  left join public.wiki_pages w on e.kind like 'wiki\_%' and w.id = e.target_id
  order by e.occurred_at desc, e.id desc, e.kind;
end;
$function$;

revoke all on function public.rpc_space_activity(uuid, integer, timestamptz, bigint, text) from public, anon, authenticated;
grant execute on function public.rpc_space_activity(uuid, integer, timestamptz, bigint, text) to authenticated;

-- ロールバック（節 2）: drop function if exists public.rpc_space_activity(uuid, integer, timestamptz, bigint, text);
