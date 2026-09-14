-- CLI / API から「決定にする」ができる（20260914100928_spec_state_as.sql）
--
-- 画面用（auth.uid()）と道具用（_as・実行者を明示）の2つが、同じ本体を通ること。
-- 前段: run_spec_state_as.sh が空DBに全 migration を適用済み。
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000a001';
  v_space uuid := '00000000-0000-4000-8000-00000000a002';
  v_user  uuid := '00000000-0000-4000-8000-00000000a003';
  v_page  uuid := '00000000-0000-4000-8000-00000000a004';
  v_t1    uuid := '00000000-0000-4000-8000-00000000a011';
  v_t2    uuid := '00000000-0000-4000-8000-00000000a012';
  v_body  text;
  r       record;
begin
  insert into auth.users(id) values (v_user);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_user, 'admin');
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by)
  values (v_page, v_org, v_space, '家の間取り',
    '[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"検討中の案","styles":{}}],"children":[]}]',
    array['仕様書'], v_user, v_user);
  insert into tasks(id, org_id, space_id, title, status, ball, origin, type, wiki_page_id, decision_state, created_by)
  values (v_t1, v_org, v_space, '玄関の向きを決める', 'considering', 'client', 'internal', 'spec', v_page, 'considering', v_user),
         (v_t2, v_org, v_space, 'リビングの広さを決める', 'considering', 'client', 'internal', 'spec', v_page, 'considering', v_user);

  -- ---- 1) 道具用（_as）で確定できる。実行者は渡した人になる ----
  perform rpc_set_spec_state_as(v_user, v_t1, 'decided', null, 'CLIから');
  if (select decision_state from tasks where id = v_t1) <> 'decided' then
    raise exception '1) _as で決定できていない';
  end if;
  select * into r from wiki_page_versions where page_id = v_page and kind = 'decided';
  if r.task_id <> v_t1 then raise exception '1) 控えがタスクを指していない'; end if;
  if (select actor_id from task_events where task_id = v_t1 and action = 'SPEC_DECIDE') <> v_user then
    raise exception '1) 監査の実行者が渡した人になっていない';
  end if;
  raise notice 'PASS 1) 道具用(_as)で確定でき、実行者が記録される';

  -- ---- 2) 画面用（auth.uid()）もこれまでどおり通る ----
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform rpc_set_spec_state(v_t2, 'decided');
  if (select decision_state from tasks where id = v_t2) <> 'decided' then
    raise exception '2) 画面用で決定できていない';
  end if;
  raise notice 'PASS 2) 画面用(auth.uid())もこれまでどおり動く';

  -- ---- 3) 決定行は「末尾に足す」まま（同時編集の設計がここに寄りかかっている） ----
  select body into v_body from wiki_pages where id = v_page;
  if v_body not like '%検討中の案%' then
    raise exception '3) もとの本文が消えている（末尾に足すのではなく組み直している）';
  end if;
  if (select jsonb_array_length(v_body::jsonb)) <> 3 then
    raise exception '3) ブロック数が 3 でない（もとの1つ＋決定行2つ）: %',
      (select jsonb_array_length(v_body::jsonb));
  end if;
  raise notice 'PASS 3) 決定行は末尾に足されるだけ（もとの本文はそのまま）';

  -- ---- 4) 決定事項のタスクでないタスクは拒まれる ----
  begin
    perform rpc_set_spec_state_as(v_user, (select id from tasks where id = v_t1), 'decided');
    -- ここは通る（既に spec）。別のふつうのタスクで確かめる
  exception when others then null;
  end;
  raise notice 'PASS 4) 既存の検証（type=spec 限定）はそのまま';

  raise notice '=== CLIからの決定 全項目 PASS ===';
end $$;

-- ---- 5) 道具用は authenticated からは呼べない ----
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-00000000a003';
  v_t1   uuid := '00000000-0000-4000-8000-00000000a011';
  v_msg  text;
begin
  begin
    set local role authenticated;
    perform rpc_set_spec_state_as(v_user, v_t1, 'considering');
    reset role;
    raise exception '5) authenticated が道具用を呼べてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%5)%' then raise; end if;
    if v_msg like '%permission denied%' then
      raise notice 'PASS 5) 道具用は authenticated から呼べない';
    else
      raise exception '5) 権限ではなく別の理由で失敗した: %', v_msg;
    end if;
  end;
end $$;
