-- rpc_list_pending_approvals（Stage 2.7-B §5）の認可ファースト取得を検証する。
-- 前段: approval_notify_test.sql のフィクスチャ（org/space/groups/links/memberships/
-- _digest_actor_can_approve）を流用する。ここでは list RPC の migration を別途適用する前提。
set client_min_messages = notice;

do $$
declare
  v_org  uuid := '00000000-0000-4000-8000-000000000001';
  v_a1   uuid := '00000000-0000-4000-8000-0000000000a1'; -- 現責任者・在籍あり
  v_a3   uuid := '00000000-0000-4000-8000-0000000000a3'; -- 退職者（リンクあり・在籍なし）
  v_g1   uuid := '00000000-0000-4000-8000-0000000000d1';
  v_b1   uuid := '00000000-0000-4000-8000-0000000000b1';
  v_n    int;
  r      record;
begin
  -- g1 に a1 宛の pending を1件用意
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g1, '発注', 'pending', v_a1, now());

  -- 1) 現責任者かつ space editor の a1 には返る（group名も join される）
  select count(*) into v_n from rpc_list_pending_approvals(v_org, v_a1);
  if v_n <> 1 then raise exception '1) a1 の確認待ちが %件 (期待 1)', v_n; end if;
  select * into r from rpc_list_pending_approvals(v_org, v_a1) limit 1;
  if r.title <> '発注' then raise exception '1) title=%', r.title; end if;
  raise notice 'PASS 1) 現責任者には自分宛pendingが返る';

  -- 2) 責任者交代: group.approver を a3 に変えると、requested_to=a1 の候補は a1 に返らない
  --    （_digest_actor_can_approve が group.approver=actor を要求するため）
  update channel_groups set approver_user_id = v_a3 where id = v_g1;
  select count(*) into v_n from rpc_list_pending_approvals(v_org, v_a1);
  if v_n <> 0 then raise exception '2) 責任者交代後も旧承認者a1に % 件返った（漏洩）', v_n; end if;
  raise notice 'PASS 2) 責任者交代後、旧承認者には返らない';
  update channel_groups set approver_user_id = v_a1 where id = v_g1;  -- 戻す

  -- 3) space 外し: a1 の space editor 権限を剥奪すると返らない
  delete from space_memberships where space_id = v_b1 and user_id = v_a1;
  select count(*) into v_n from rpc_list_pending_approvals(v_org, v_a1);
  if v_n <> 0 then raise exception '3) space外し後も % 件返った（漏洩）', v_n; end if;
  raise notice 'PASS 3) space外し後は返らない';
  insert into space_memberships(space_id, user_id, role) values (v_b1, v_a1, 'editor'); -- 戻す

  -- 4) 他人宛は返らない: a3（別人）で引いても a1 宛候補は出ない
  select count(*) into v_n from rpc_list_pending_approvals(v_org, v_a3);
  if v_n <> 0 then raise exception '4) 他人a3に % 件返った', v_n; end if;
  raise notice 'PASS 4) 他人宛の確認待ちは見えない';

  -- 5) org 退職: a1 の org_memberships を消すと（space editor が残っていても）返らない
  delete from org_memberships where org_id = v_org and user_id = v_a1;
  select count(*) into v_n from rpc_list_pending_approvals(v_org, v_a1);
  if v_n <> 0 then raise exception '5) org退職後も % 件返った（漏洩）', v_n; end if;
  raise notice 'PASS 5) org退職後は返らない';
  insert into org_memberships(org_id, user_id, role) values (v_org, v_a1, 'member'); -- 戻す

  raise notice '=== list_pending_approvals 全項目 PASS ===';
end $$;
