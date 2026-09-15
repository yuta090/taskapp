-- CLI / API から「承認依頼を取り消す」ができる（20260916041200_review_cancel_as.sql）
--
-- 画面用（auth.uid()）と道具用（_as・実行者を明示）の2つが同じ本体を通り、
-- 誰が取り消せるか・どの状態なら取り消せるか・誰に知らせるかが分割の前と同じであること。
-- 前段: run_review_cancel_as.sh が空DBに全 migration を適用済み。
set client_min_messages = notice;

do $$
declare
  v_org    uuid := '00000000-0000-4000-8000-00000000b001';
  v_space  uuid := '00000000-0000-4000-8000-00000000b002';
  v_req    uuid := '00000000-0000-4000-8000-00000000b011';  -- 依頼した人（editor）
  v_rev    uuid := '00000000-0000-4000-8000-00000000b012';  -- 承認者（editor）
  v_admin  uuid := '00000000-0000-4000-8000-00000000b013';  -- プロジェクトの管理者
  v_other  uuid := '00000000-0000-4000-8000-00000000b014';  -- 関係のない editor
  v_view   uuid := '00000000-0000-4000-8000-00000000b015';  -- 閲覧のみ
  v_cli    uuid := '00000000-0000-4000-8000-00000000b016';  -- 相手先
  v_org2   uuid := '00000000-0000-4000-8000-00000000b003';  -- 別の組織
  v_own2   uuid := '00000000-0000-4000-8000-00000000b017';  -- 別の組織のオーナー
  v_t1     uuid := '00000000-0000-4000-8000-00000000b021';
  v_t2     uuid := '00000000-0000-4000-8000-00000000b022';
  v_t3     uuid := '00000000-0000-4000-8000-00000000b023';
  v_t4     uuid := '00000000-0000-4000-8000-00000000b024';
  v_r1     uuid := '00000000-0000-4000-8000-00000000b031';
  v_r2     uuid := '00000000-0000-4000-8000-00000000b032';
  v_r3     uuid := '00000000-0000-4000-8000-00000000b033';
  v_r4     uuid := '00000000-0000-4000-8000-00000000b034';
  v_msg    text;
  v_status text;
begin
  insert into auth.users(id) values (v_req), (v_rev), (v_admin), (v_other), (v_view), (v_cli), (v_own2);
  insert into organizations(id, name) values (v_org, '検証org'), (v_org2, '別の組織');
  insert into org_memberships(org_id, user_id, role) values
    (v_org, v_admin, 'owner'), (v_org, v_req, 'member'), (v_org, v_rev, 'member'),
    (v_org, v_other, 'member'), (v_org, v_view, 'member'), (v_org, v_cli, 'client'),
    (v_org2, v_own2, 'owner');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values
    (v_space, v_admin, 'admin'), (v_space, v_req, 'editor'), (v_space, v_rev, 'editor'),
    (v_space, v_other, 'editor'), (v_space, v_view, 'viewer'), (v_space, v_cli, 'client');

  insert into tasks(id, org_id, space_id, title, status, ball, origin, type, created_by) values
    (v_t1, v_org, v_space, '見積を出す', 'in_review', 'internal', 'internal', 'task', v_req),
    (v_t2, v_org, v_space, '図面を送る', 'in_review', 'internal', 'internal', 'task', v_req),
    (v_t3, v_org, v_space, '契約書を作る', 'in_review', 'internal', 'internal', 'task', v_req),
    (v_t4, v_org, v_space, '請求書を出す', 'in_review', 'internal', 'internal', 'task', v_req);

  insert into reviews(id, org_id, space_id, task_id, status, created_by) values
    (v_r1, v_org, v_space, v_t1, 'open', v_req),
    (v_r2, v_org, v_space, v_t2, 'open', v_req),
    (v_r3, v_org, v_space, v_t3, 'approved', v_req),
    (v_r4, v_org, v_space, v_t4, 'open', v_req);
  insert into review_approvals(org_id, review_id, reviewer_id, state) values
    (v_org, v_r1, v_rev, 'pending'),
    (v_org, v_r2, v_rev, 'pending'),
    (v_org, v_r4, v_rev, 'pending');

  -- ---- 1) 道具用（_as）で取り消せる。実行者は渡した人になる ----
  perform rpc_review_cancel_as(v_req, v_r1);
  if (select status from reviews where id = v_r1) <> 'cancelled' then
    raise exception '1) _as で取り消せていない';
  end if;
  if (select actor_id from task_events where task_id = v_t1 and action = 'REVIEW_CANCEL') <> v_req then
    raise exception '1) 監査の実行者が渡した人になっていない';
  end if;
  raise notice 'PASS 1) 道具用(_as)で取り消せ、実行者が記録される';

  -- ---- 2) 宙に浮いた承認者に知らせる。取り消した本人には出さない ----
  if (select count(*) from notifications
      where to_user_id = v_rev and type = 'review_cancelled' and payload->>'task_id' = v_t1::text) <> 1 then
    raise exception '2) 承認者に取り消しが届いていない';
  end if;
  if (select count(*) from notifications where to_user_id = v_req and type = 'review_cancelled') <> 0 then
    raise exception '2) 取り消した本人に自分あての知らせが出ている';
  end if;
  raise notice 'PASS 2) 承認者だけに知らせが届く（実行者は除く）';

  -- ---- 3) 画面用（auth.uid()）もこれまでどおり通る。依頼者にも届く ----
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform rpc_review_cancel(v_r2);
  perform set_config('request.jwt.claim.sub', '', true);
  if (select status from reviews where id = v_r2) <> 'cancelled' then
    raise exception '3) 画面用で取り消せていない';
  end if;
  if (select count(*) from notifications
      where to_user_id = v_req and type = 'review_cancelled' and payload->>'task_id' = v_t2::text) <> 1 then
    raise exception '3) 依頼した人に取り消しが届いていない';
  end if;
  raise notice 'PASS 3) 画面用(auth.uid())も動き、依頼者にも届く';

  -- ---- 4) 終わった依頼は取り消せない ----
  begin
    perform rpc_review_cancel_as(v_req, v_r3);
    raise exception '4) 承認済みの依頼を取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%4)%' then raise; end if;
    if v_msg not like 'Review cannot be cancelled from status: approved%' then
      raise exception '4) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  raise notice 'PASS 4) 承認済みの依頼は取り消せない';

  -- ---- 5) 依頼者でも管理者でもオーナーでもない人は取り消せない ----
  begin
    perform rpc_review_cancel_as(v_other, v_r4);
    raise exception '5) 第三者が取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%5)%' then raise; end if;
    if v_msg not like 'Insufficient permissions: only the requester%' then
      raise exception '5) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  if (select status from reviews where id = v_r4) <> 'open' then
    raise exception '5) 断られたのに状態が変わっている';
  end if;
  raise notice 'PASS 5) 依頼者・管理者・オーナー以外は取り消せない';

  -- ---- 6) 書けない役割（閲覧のみ）は前段で断られる ----
  begin
    perform rpc_review_cancel_as(v_view, v_r4);
    raise exception '6) 閲覧のみの人が取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%6)%' then raise; end if;
    if v_msg not like 'Not authorized to access this review%' then
      raise exception '6) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  raise notice 'PASS 6) 書けない役割は前段で断られる';

  -- ---- 7) 取り消したあと、同じタスクに依頼し直せる（画面の案内どおり） ----
  perform rpc_review_open_as(v_req, v_t1, array[v_rev], null);
  select status into v_status from reviews where task_id = v_t1;
  if v_status <> 'open' then
    raise exception '7) 取り消したあとに依頼し直せない: %', v_status;
  end if;
  raise notice 'PASS 7) 取り消したあとに依頼し直せる';

  -- ---- 8) 相手先の役割でも取り消せない（space 単位の表を役割を問わず書けた事故の再発防止） ----
  begin
    perform rpc_review_cancel_as(v_cli, v_r4);
    raise exception '8) 相手先の役割で取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%8)%' then raise; end if;
    if v_msg not like 'Not authorized to access this review%' then
      raise exception '8) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  raise notice 'PASS 8) 相手先の役割では取り消せない';

  -- ---- 9) 別の組織のオーナーが、依頼の ID を直に渡しても越えられない ----
  begin
    perform rpc_review_cancel_as(v_own2, v_r4);
    raise exception '9) 別の組織のオーナーが取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%9)%' then raise; end if;
    if v_msg not like 'Not authorized to access this review%' then
      raise exception '9) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  if (select status from reviews where id = v_r4) <> 'open' then
    raise exception '9) 断られたのに状態が変わっている';
  end if;
  raise notice 'PASS 9) 別の組織からは取り消せない';

  -- ---- 10) 取り消し済みのものは、もう一度は取り消せない（同じ命令を2回打っても壊れない） ----
  begin
    perform rpc_review_cancel_as(v_req, v_r2);
    raise exception '10) 取り消し済みをもう一度取り消せてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%10)%' then raise; end if;
    if v_msg not like 'Review cannot be cancelled from status: cancelled%' then
      raise exception '10) 別の理由で失敗した: %', v_msg;
    end if;
  end;
  raise notice 'PASS 10) 取り消し済みは二度取り消せない';

  raise notice '=== CLIからの承認依頼の取り消し 全項目 PASS ===';
end $$;

-- ---- 11) 道具用は authenticated からは呼べない ----
do $$
declare
  v_req uuid := '00000000-0000-4000-8000-00000000b011';
  v_r4  uuid := '00000000-0000-4000-8000-00000000b034';
  v_msg text;
begin
  begin
    set local role authenticated;
    perform rpc_review_cancel_as(v_req, v_r4);
    reset role;
    raise exception '11) authenticated が道具用を呼べてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%11)%' then raise; end if;
    if v_msg like '%permission denied%' then
      raise notice 'PASS 11) 道具用は authenticated から呼べない';
    else
      raise exception '11) 権限ではなく別の理由で失敗した: %', v_msg;
    end if;
  end;
end $$;

-- ---- 12) 本体は誰も直接呼べない（包みを通さない抜け道が無い） ----
do $$
declare
  v_holders text;
begin
  select coalesce(string_agg(r, ', '), '(なし)') into v_holders
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, 'public._review_cancel_impl(uuid,uuid)', 'execute');

  if v_holders <> '(なし)' then
    raise exception '12) 本体に実行権が残っている: %', v_holders;
  end if;
  raise notice 'PASS 12) 本体(_review_cancel_impl)は誰も直接呼べない';
end $$;
