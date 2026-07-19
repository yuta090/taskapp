-- =============================================================================
-- Stage 2.7-B §4-5(fix): メンション即時タスク化を「グループ行ロック」経由にする
--
-- 従来の即時パスはアプリが取得済み(スナップショット)の approver_user_id を渡して INSERT していた。
-- そのため、取得〜INSERT の隙間に rpc_set_group_approver で承認者が変わると、旧承認者宛の
-- pending 候補が作られ、_digest_actor_can_approve を誰も満たせず宙吊りになり得た
-- （通知も出ず、トレイにも出ず、承認/却下もできない）。
--
-- 対策: 夜間ingest（rpc_ingest_digest_tasks）と同じく、*グループ行を FOR UPDATE でロックしてから*
-- 現在の approver_user_id / space_id を読み、pending 判定と付随列の充填を DB 側で確定する。
-- アプリは承認者を渡さない（信頼できる唯一の値は「ロックした行」だから）。
-- =============================================================================

create or replace function public.rpc_create_instant_digest_task(
  p_group_id uuid,
  p_source_message_id uuid,
  p_title text,
  p_assignee_hint text,
  p_assignee_external_user_id text,
  p_assignee_identity_id uuid,
  p_due_date date,
  p_due_time time
)
returns table (id uuid, is_pending boolean, is_duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id   uuid;
  v_space_id uuid;
  v_approver uuid;
  v_pending  boolean;
  v_id       uuid;
begin
  -- グループ行をロックして現在値を読む（承認者変更 rpc_set_group_approver と直列化）
  -- returns table の OUT 名(id)と衝突するため channel_groups は g で必ず修飾する
  select g.org_id, g.space_id, g.approver_user_id
    into v_org_id, v_space_id, v_approver
  from public.channel_groups g
  where g.id = p_group_id
  for update;

  if v_org_id is null then
    -- 呼び出し側(findActiveGroup)で存在・org一致を検証済みの前提。ここで見つからないのは
    -- 取得直後に削除された等の異常。rpc_ingest_digest_tasks と同じく例外を上げる
    -- （偽の「申し送りに追加しました」返信＝成功詐称を防ぐ。存在しない行を成功扱いにしない）。
    raise exception 'rpc_create_instant_digest_task: unknown group_id %', p_group_id;
  end if;

  -- 承認フローの発火条件（§4-2 と同一）: approver 設定済み *かつ* space 紐付け済み
  v_pending := (v_approver is not null and v_space_id is not null);

  insert into public.channel_digest_tasks (
    org_id, group_id, space_id, source_message_id, title,
    assignee_hint, assignee_external_user_id, assignee_identity_id,
    due_date, due_time, extracted_date,
    promotion_state, requested_to_user_id, requested_at
  )
  values (
    v_org_id, p_group_id, v_space_id, p_source_message_id, p_title,
    p_assignee_hint, p_assignee_external_user_id, p_assignee_identity_id,
    p_due_date, p_due_time, (now() at time zone 'Asia/Tokyo')::date,
    case when v_pending then 'pending' else 'none' end,
    case when v_pending then v_approver else null end,
    case when v_pending then now() else null end
  )
  on conflict (source_message_id, title) do nothing
  returning channel_digest_tasks.id into v_id;

  if v_id is null then
    -- webhook 再送等の重複。既存行は触らない（冪等成功）。返信文言のため is_pending は
    -- *既存タスクの実状態* から返す（承認者変更で pending→none に戻された行など、現グループ設定と
    -- ずれていても実状態に一致させる。新規作成でないので claim/push はしない＝返信文言だけの用途）。
    select (dt.promotion_state = 'pending')
      into v_pending
    from public.channel_digest_tasks dt
    where dt.source_message_id = p_source_message_id and dt.title = p_title;
    return query select null::uuid, coalesce(v_pending, false), true;
    return;
  end if;

  return query select v_id, v_pending, false;
end;
$$;

revoke execute on function public.rpc_create_instant_digest_task(uuid, uuid, text, text, text, uuid, date, time)
  from public, anon, authenticated;
grant execute on function public.rpc_create_instant_digest_task(uuid, uuid, text, text, text, uuid, date, time)
  to service_role;

-- =============================================================================
-- 検証（scratch）:
--   1) approver設定＋space紐付け → is_pending=true・promotion_state='pending'・requested_to=現approver
--   2) approver未設定 → is_pending=false・promotion_state='none'
--   3) 重複(source_message_id,title) → is_duplicate=true・行は増えない
--   4) レース: 取得後にapprover変更しても、ロックで直列化され *insert時点の* approver で確定
-- ロールバック: drop function rpc_create_instant_digest_task(uuid,uuid,text,text,text,uuid,date,time);
-- =============================================================================
