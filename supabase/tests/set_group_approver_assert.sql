-- rpc_set_group_approver（Stage 2.7-B §5）: approver変更時の pending 宙吊り防止を検証。
-- 前段: approval_notify_test.sql フィクスチャ＋dispatch migration（approval_notified_at列）。
set client_min_messages = notice;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_a1  uuid := '00000000-0000-4000-8000-0000000000a1';
  v_a3  uuid := '00000000-0000-4000-8000-0000000000a3';
  v_g1  uuid := '00000000-0000-4000-8000-0000000000d1';
  v_t   uuid;
  r     record;
begin
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at, approval_notified_at)
    values (v_org, v_g1, '発注', 'pending', v_a1, now(), now()) returning id into v_t;

  -- 1) approver 変更(a1→a3): 旧pendingは none に戻り付随列が全て null、group.approver=a3
  perform rpc_set_group_approver(v_g1, v_a3);
  select * into r from channel_digest_tasks where id = v_t;
  if r.promotion_state <> 'none' then raise exception '1) state=% (期待 none)', r.promotion_state; end if;
  if r.requested_to_user_id is not null or r.requested_at is not null or r.approval_notified_at is not null then
    raise exception '1) 付随列が残った（宙吊り）';
  end if;
  if (select approver_user_id from channel_groups where id = v_g1) <> v_a3 then
    raise exception '1) group.approver が a3 になっていない';
  end if;
  raise notice 'PASS 1) approver変更で旧pendingがnoneに戻り宙吊りしない';

  -- 2) approver 解除(→null): group.approver=null。noneのタスクは不変（再度resetしても害なし）
  perform rpc_set_group_approver(v_g1, null);
  if (select approver_user_id from channel_groups where id = v_g1) is not null then
    raise exception '2) 解除後も approver が残った';
  end if;
  raise notice 'PASS 2) approver解除で group.approver=null';

  -- 3) 存在しないグループは no-op（例外を投げない）
  perform rpc_set_group_approver('00000000-0000-4000-8000-0000000000ff', v_a1);
  raise notice 'PASS 3) 不在グループは no-op';

  raise notice '=== set_group_approver 全項目 PASS ===';
end $$;
