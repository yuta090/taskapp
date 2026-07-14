-- =============================================================================
-- Stage 2.7-B: 責任者確認による申し送り→本体タスクの昇格
-- 仕様: docs/spec/AI_SECRETARY_STAGE2_7_APPROVAL.md §4
--
-- 「digest に溜める → 責任者が1:1 LINE/コンソールで確認 → 本体タスク化」の一段クッション。
-- 自動昇格は取らない（AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE.md:199-208 の保留事項）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) グループ単位の責任者
-- -----------------------------------------------------------------------------
alter table public.channel_groups
  add column if not exists approver_user_id uuid null references auth.users(id);

comment on column public.channel_groups.approver_user_id is
  '申し送りをタスク化する承認者。未設定なら候補を pending にしない（承認フローはオプトイン）';

-- -----------------------------------------------------------------------------
-- 2) 昇格の状態機械
-- -----------------------------------------------------------------------------
alter table public.channel_digest_tasks
  add column if not exists promotion_state text not null default 'none'
    check (promotion_state in ('none', 'pending', 'promoted', 'rejected')),
  add column if not exists requested_to_user_id uuid null references auth.users(id),
  add column if not exists requested_at timestamptz null,
  add column if not exists promoted_task_id uuid null references public.tasks(id) on delete set null,
  add column if not exists confirmed_by_user_id uuid null references auth.users(id),
  add column if not exists confirmed_at timestamptz null,
  add column if not exists rejected_by_user_id uuid null references auth.users(id),
  add column if not exists rejected_at timestamptz null;

-- 状態と付随列の整合を DB で強制する（アプリのバグで中途半端な行を作れないように）。
-- 各状態で「反対側の監査列は NULL」まで縛って排他にする（rejected なのに confirmed 列が埋まる等を禁止）。
--
-- promoted_task_id を NOT NULL 要求しないのは意図的: FK が ON DELETE SET NULL のため、
-- 昇格後に本体タスクが削除されると NULL になる。それは「昇格したが後で消した」正当な状態で、
-- 冪等判定は promotion_state='promoted' が担う（task_id が NULL でも再作成しない）。
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'digest_promotion_state_chk'
      and conrelid = 'public.channel_digest_tasks'::regclass
  ) then
    alter table public.channel_digest_tasks add constraint digest_promotion_state_chk check (
      (promotion_state = 'none'
        and requested_to_user_id is null and requested_at is null
        and promoted_task_id is null
        and confirmed_by_user_id is null and confirmed_at is null
        and rejected_by_user_id  is null and rejected_at  is null)
      or (promotion_state = 'pending'
        and requested_to_user_id is not null and requested_at is not null
        and promoted_task_id is null
        and confirmed_by_user_id is null and confirmed_at is null
        and rejected_by_user_id  is null and rejected_at  is null)
      or (promotion_state = 'promoted'
        and requested_to_user_id is not null and requested_at is not null
        -- promoted_task_id は NULL 可（FK が ON DELETE SET NULL）。冪等判定は state が担う。
        and confirmed_by_user_id is not null and confirmed_at is not null
        and rejected_by_user_id  is null and rejected_at  is null)
      or (promotion_state = 'rejected'
        and requested_to_user_id is not null and requested_at is not null
        and promoted_task_id is null
        and rejected_by_user_id  is not null and rejected_at  is not null
        and confirmed_by_user_id is null and confirmed_at is null)
    );
  end if;
end $$;

-- 確認待ちトレイのクエリ用
create index if not exists channel_digest_tasks_pending
  on public.channel_digest_tasks(requested_to_user_id, created_at desc)
  where promotion_state = 'pending';

-- -----------------------------------------------------------------------------
-- 3) 共通の認可＋アクター解決（LINE / コンソール の2経路で使い回す）
--
-- 返り値: 承認してよければ true。呼び出し側は false のとき forbidden を返す。
-- 「紐付けはキャッシュに過ぎない」ため、リンクの有無ではなく *現在の在籍* を毎回確認する。
-- -----------------------------------------------------------------------------
create or replace function public._digest_actor_can_approve(
  p_task public.channel_digest_tasks,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- 依頼先本人であること（これが無いと「権限を持つ誰か」になってしまう）
    p_task.requested_to_user_id = p_actor_user_id
    -- かつ *現在も* そのグループの責任者であること。
    -- requested_to だけだと、責任者交代後も旧責任者が古いボタンで承認できてしまう。
    and exists (
      select 1 from channel_groups g
      where g.id = p_task.group_id and g.approver_user_id = p_actor_user_id
    )
    -- 現在も org 内部メンバー
    and exists (
      select 1 from org_memberships m
      where m.org_id = p_task.org_id and m.user_id = p_actor_user_id
        and m.role in ('owner', 'admin', 'member')
    )
    -- 現在も対象 space の admin/editor
    and exists (
      select 1 from channel_groups g
      join space_memberships s on s.space_id = g.space_id
      where g.id = p_task.group_id
        and s.user_id = p_actor_user_id
        and s.role in ('admin', 'editor')
    );
$$;

-- -----------------------------------------------------------------------------
-- 4) 昇格 RPC
--
-- 契約（§4-7）: 同じ終状態を目指す再実行は同じ成功を返す（副作用ゼロ）。
--   promoted → promoted(created=false), それ以外の矛盾は conflict, 認可NGは forbidden。
-- status 列は *絶対に変更しない*: AFTER UPDATE トリガーが status 変化で外部sinkへ配信するため。
-- DB外の副作用（LINE返信・通知）はRPC内でやらない（呼び出し側がコミット後に行う）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_promote_digest_task(
  p_task_id uuid,
  p_actor_user_id uuid
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
  -- 非認可者は promoted/rejected/conflict を区別できず一律 forbidden になる
  -- （旧ボタンやログから task UUID を得た第三者に状態を漏らさない）。
  -- can_approve は space membership を含むため、group.space_id が null の候補は
  -- 誰も通らず forbidden になる（＝昇格先の無い候補は構造的に承認不能）。
  if not public._digest_actor_can_approve(v_task, p_actor_user_id) then
    return query select 'forbidden'::text, false, null::uuid;
    return;
  end if;

  -- ここから先は「この候補の現・責任者」だけが到達する。状態開示は正当。
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

  -- 昇格先の space はグループ由来のみ（I-2）。can_approve を通った時点で非nullが保証されるが、
  -- 防御的に再取得し、万一 null なら conflict（この時点の呼び手は正当な責任者なので開示可）。
  select space_id into v_space from public.channel_groups where id = v_task.group_id;
  if v_space is null then
    return query select 'conflict'::text, false, null::uuid;
    return;
  end if;

  -- 本体 tasks へ一方向コピー。全列を明示する（既定値に頼らない）。
  -- client_scope は 'internal' 固定 — DB既定 'deliverable' のままだと顧客ポータルに露出する。
  insert into public.tasks
    (org_id, space_id, title, description, status, ball, origin, type,
     client_scope, due_date, assignee_id, created_by)
  values
    (v_task.org_id, v_space, v_task.title, '', 'todo', 'internal', 'client', 'task',
     'internal', v_task.due_date, null, p_actor_user_id)
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

-- -----------------------------------------------------------------------------
-- 5) 却下 RPC
-- -----------------------------------------------------------------------------
create or replace function public.rpc_reject_digest_task(
  p_task_id uuid,
  p_actor_user_id uuid
)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.channel_digest_tasks%rowtype;
begin
  select * into v_task from public.channel_digest_tasks where id = p_task_id for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  -- 認可ファースト（昇格RPCと対称）: 状態を開示する前に権限を確認する。
  if not public._digest_actor_can_approve(v_task, p_actor_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;

  -- 冪等: 既に却下済みは no-op（同じ終状態）
  if v_task.promotion_state = 'rejected' then
    return query select 'rejected'::text;
    return;
  end if;

  -- promoted を却下は矛盾
  if v_task.promotion_state <> 'pending' then
    return query select 'conflict'::text;
    return;
  end if;

  update public.channel_digest_tasks
     set promotion_state = 'rejected',
         rejected_by_user_id = p_actor_user_id,
         rejected_at = now()
   where id = p_task_id;

  return query select 'rejected'::text;
end $$;

-- -----------------------------------------------------------------------------
-- 6) LINE経路のラッパ: 内部UUIDを受け取らず、検証済みの LINE identity から解決する
--
-- 責任分界（重要）:
--   - webhook は署名検証済み。external_user_id は詐称できない（LINE が付与する）。
--   - このラッパは channel_user_links から user_id を *DB内で* 解決する。
--     revoke 済み / 未紐付けなら解決できず forbidden（＝内部UUIDを外から渡させない）。
--   - コンソール経路は rpc_promote_digest_task を直接使うが、API層(requireInternalMember)が
--     セッションを検証し、body ではなくセッションの userId を渡す（PR1 発行APIと同じ流儀）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_promote_digest_task_via_line(
  p_channel_account_id uuid,
  p_external_user_id text,
  p_task_id uuid
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
  -- さらに *LINE identity を確立したテナント/アカウントが対象タスクのそれと一致* することを要求する。
  -- これが無いと、org A で紐付いた identity が、たまたま org B の責任者でもある内部ユーザーに
  -- 解決した場合に org B のタスクを承認できてしまう（テナント越え）。
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

  return query select * from public.rpc_promote_digest_task(p_task_id, v_actor);
end $$;

create or replace function public.rpc_reject_digest_task_via_line(
  p_channel_account_id uuid,
  p_external_user_id text,
  p_task_id uuid
)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  -- 昇格ラッパと対称: テナント/アカウントの一致まで縛って解決する。
  select l.user_id into v_actor
  from public.channel_user_links l
  join public.channel_digest_tasks d on d.id = p_task_id and d.org_id = l.org_id
  join public.channel_groups g on g.id = d.group_id and g.account_id = l.channel_account_id
  where l.channel_account_id = p_channel_account_id
    and l.external_user_id = p_external_user_id
    and l.revoked_at is null;

  if v_actor is null then
    return query select 'forbidden'::text;
    return;
  end if;

  return query select * from public.rpc_reject_digest_task(p_task_id, v_actor);
end $$;

-- -----------------------------------------------------------------------------
-- 7) 権限: service_role のみ（アプリは service_role で呼ぶ。認可はRPC内で完結）
-- -----------------------------------------------------------------------------
revoke all on function public._digest_actor_can_approve(public.channel_digest_tasks, uuid) from public, anon, authenticated;
revoke all on function public.rpc_promote_digest_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_reject_digest_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_promote_digest_task_via_line(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.rpc_reject_digest_task_via_line(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_promote_digest_task(uuid, uuid) to service_role;
grant execute on function public.rpc_reject_digest_task(uuid, uuid) to service_role;
grant execute on function public.rpc_promote_digest_task_via_line(uuid, text, uuid) to service_role;
grant execute on function public.rpc_reject_digest_task_via_line(uuid, text, uuid) to service_role;
