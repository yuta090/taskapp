-- =============================================================================
-- 承認時の担当自認: rpc_promote_digest_task に p_assign_self を追加
--
-- 背景: 昇格は今まで assignee_id=null 固定だった。Google Tasks ミラーは
-- 「assignee=本人」のタスクを本人の Google Tasks へ流すため、LINE で承認する責任者が
-- そのまま担当になれる導線が要る。承認 postback に2ボタン:
--   「承認して自分がやる」= p_assign_self=true → assignee_id=承認者
--   「承認だけ」          = p_assign_self=false(既定) → assignee_id=null(従来どおり)
--
-- 【重要】この migration は 20260715074403 の *最新定義をそのまま土台*にし、
-- 認可チェック(_digest_actor_can_approve)・冪等・テナント越え防止は一字一句保持する。
-- 変更点は (1) 引数 p_assign_self の追加 (2) insert の assignee_id 値のみ。
--
-- デフォルト引数付きの新シグネチャは旧2引数版と呼び出しが曖昧になるため、旧版を DROP してから
-- 貼り直す(via_line も同様)。関数間呼び出しは実行時解決のため DROP 順の依存はないが、安全に
-- via_line → promote の順で落とす。
-- =============================================================================

drop function if exists public.rpc_promote_digest_task_via_line(uuid, text, uuid);
drop function if exists public.rpc_promote_digest_task(uuid, uuid);

create or replace function public.rpc_promote_digest_task(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_assign_self boolean default false
)
returns table (status text, created boolean, task_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task  public.channel_digest_tasks%rowtype;
  v_space uuid;
  v_new   uuid;
begin
  -- 行ロック（同時昇格を直列化）
  select * into v_task from public.channel_digest_tasks where id = p_task_id for update;

  if not found then
    return query select 'not_found'::text, false, null::uuid;
    return;
  end if;

  -- 認可ファースト（重要）: 状態を1ビットも開示する前に権限を確認する。
  if not public._digest_actor_can_approve(v_task, p_actor_user_id) then
    return query select 'forbidden'::text, false, null::uuid;
    return;
  end if;

  -- 冪等: 既に昇格済みなら既存 task を返す（2件目を作らない）。
  if v_task.promotion_state = 'promoted' then
    return query select 'promoted'::text, false, v_task.promoted_task_id;
    return;
  end if;

  -- pending 以外からの昇格は矛盾（rejected/none）
  if v_task.promotion_state <> 'pending' then
    return query select 'conflict'::text, false, null::uuid;
    return;
  end if;

  -- 昇格先の space はグループ由来のみ。
  select space_id into v_space from public.channel_groups where id = v_task.group_id;
  if v_space is null then
    return query select 'conflict'::text, false, null::uuid;
    return;
  end if;

  -- 本体 tasks へ一方向コピー。client_scope は 'internal' 固定（顧客ポータル露出防止）。
  -- assignee_id: p_assign_self=true なら承認者本人（担当自認）、既定は null（従来どおり）。
  insert into public.tasks
    (org_id, space_id, title, description, status, ball, origin, type,
     client_scope, due_date, assignee_id, created_by)
  values
    (v_task.org_id, v_space, v_task.title, '', 'todo', 'internal', 'client', 'task',
     'internal', v_task.due_date,
     case when p_assign_self then p_actor_user_id else null end,
     p_actor_user_id)
  returning id into v_new;

  -- digest 側を promoted に。status 列は触らない（sink誤配信の回避）
  update public.channel_digest_tasks
     set promotion_state = 'promoted',
         promoted_task_id = v_new,
         confirmed_by_user_id = p_actor_user_id,
         confirmed_at = now()
   where id = p_task_id;

  return query select 'promoted'::text, true, v_new;
end $$;

-- LINE 経路ラッパ: 検証済み identity から actor を解決し、p_assign_self を素通しする。
create or replace function public.rpc_promote_digest_task_via_line(
  p_channel_account_id uuid,
  p_external_user_id text,
  p_task_id uuid,
  p_assign_self boolean default false
)
returns table (status text, created boolean, task_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  -- active な紐付けから内部ユーザーを解決する（revoke 済みは解決不能）。
  -- LINE identity を確立したテナント/アカウントが対象タスクのそれと一致することを要求する。
  select l.user_id into v_actor
  from public.channel_user_links l
  join public.channel_digest_tasks d on d.id = p_task_id and d.org_id = l.org_id
  join public.channel_groups g on g.id = d.group_id and g.account_id = l.channel_account_id
  where l.channel_account_id = p_channel_account_id
    and l.external_user_id = p_external_user_id
    and l.revoked_at is null;

  if v_actor is null then
    return query select 'forbidden'::text, false, null::uuid;
    return;
  end if;

  return query select * from public.rpc_promote_digest_task(p_task_id, v_actor, p_assign_self);
end $$;

-- 権限: service_role のみ（新シグネチャに再付与）。
revoke all on function public.rpc_promote_digest_task(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.rpc_promote_digest_task_via_line(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rpc_promote_digest_task(uuid, uuid, boolean) to service_role;
grant execute on function public.rpc_promote_digest_task_via_line(uuid, text, uuid, boolean) to service_role;
