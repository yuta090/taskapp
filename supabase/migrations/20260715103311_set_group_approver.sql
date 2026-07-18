-- =============================================================================
-- Stage 2.7-B §5: グループの承認者(approver)を原子的に設定する
--
-- approver を変更/解除すると、旧責任者宛の pending 候補は
-- _digest_actor_can_approve（requested_to=actor かつ group.approver=actor を要求）を
-- 誰も満たせなくなり、承認も却下もできず確認待ちトレイからも消える「宙吊り」になる。
-- これを防ぐため、approver 変更時に *同一トランザクションで* 当該グループの pending 候補を
-- 通常の申し送り(none)へ戻す（申し送り自体は残るので情報損失なし。次回以降 approver が
-- 設定されていれば新規候補がその人へ pending 化される）。
--
-- 別々の PostgREST 呼び出しで group更新→task更新 とすると、その間の ingest と競合し得るため、
-- 必ず1つの RPC（行ロック）で束ねる。
-- =============================================================================

create or replace function public.rpc_set_group_approver(
  p_group_id uuid,
  p_new_approver uuid  -- null = 解除
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current uuid;
begin
  -- グループ行をロック（並行 ingest / 二重設定を直列化）。現在の approver も同時に読む。
  select approver_user_id into v_current
  from public.channel_groups where id = p_group_id for update;
  if not found then
    return;  -- 存在しないグループは no-op（呼び出し側が org 一致を検証済み）
  end if;

  -- 変更が無ければ何もしない（冪等）。ここで return しないと、同一 approver の再設定(A→B→B)や
  -- 二重クリックが *正当な* pending 候補まで none に戻して消してしまう（データ損失）。
  if v_current is not distinct from p_new_approver then
    return;
  end if;

  -- 宙吊り防止: 未処理 pending を通常の申し送り(none)へ戻す（CHECK 充足のため付随列を全消し）
  update public.channel_digest_tasks
     set promotion_state = 'none',
         requested_to_user_id = null,
         requested_at = null,
         approval_notified_at = null
   where group_id = p_group_id
     and promotion_state = 'pending';

  update public.channel_groups
     set approver_user_id = p_new_approver
   where id = p_group_id;
end;
$$;

revoke execute on function public.rpc_set_group_approver(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_set_group_approver(uuid, uuid) to service_role;

-- =============================================================================
-- 検証（scratch）:
--   1) approver 設定: group.approver_user_id が入る
--   2) approver 変更(A→B): 旧pendingが none に戻る・付随列が全て null・group.approver=B
--   3) approver 解除(→null): pendingがnoneに戻る・group.approver=null
--   4) pending が無ければ tasks は不変
-- ロールバック: drop function rpc_set_group_approver(uuid, uuid);
-- =============================================================================
