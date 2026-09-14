-- 「決めてください」が受信トレイに届く（20260914115243_spec_decision_nudge.sql）
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000b001';
  v_space uuid := '00000000-0000-4000-8000-00000000b002';
  v_owner uuid := '00000000-0000-4000-8000-00000000b003';
  v_cli   uuid := '00000000-0000-4000-8000-00000000b004';
  v_page  uuid := '00000000-0000-4000-8000-00000000b005';
  v_mtg   uuid := '00000000-0000-4000-8000-00000000b006';
  v_over  uuid := '00000000-0000-4000-8000-00000000b011';  -- 期限超過・未決
  v_mtgT  uuid := '00000000-0000-4000-8000-00000000b012';  -- 会議で作られた・未決
  v_done  uuid := '00000000-0000-4000-8000-00000000b013';  -- 決定済み
  v_noown uuid := '00000000-0000-4000-8000-00000000b014';  -- 担当がいない
  v_plain uuid := '00000000-0000-4000-8000-00000000b015';  -- ふつうのタスク（期限切れ）
  v_n     integer;
  v_msg   text;
begin
  insert into auth.users(id) values (v_owner), (v_cli);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_owner, 'owner'), (v_org, v_cli, 'client');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_owner, 'admin'), (v_space, v_cli, 'client');
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by)
    values (v_page, v_org, v_space, '家の間取り', '[]', array['仕様書'], v_owner, v_owner);
  insert into meetings(id, org_id, space_id, title, held_at, status, ended_at, created_by)
    values (v_mtg, v_org, v_space, '定例', now() - interval '2 hours', 'ended', now() - interval '1 hour', v_owner);

  insert into tasks(id, org_id, space_id, title, status, ball, origin, type, wiki_page_id, decision_state, due_date, created_by)
  values
    (v_over,  v_org, v_space, '玄関の向きを決める',   'considering', 'client',   'internal', 'spec', v_page, 'considering', current_date - 3, v_owner),
    (v_mtgT,  v_org, v_space, 'リビングの広さを決める','considering', 'internal', 'internal', 'spec', v_page, 'considering', null,             v_owner),
    (v_done,  v_org, v_space, 'すでに決まった',      'considering', 'client',   'internal', 'spec', v_page, 'decided',     current_date - 3, v_owner),
    (v_noown, v_org, v_space, '担当がいない',          'considering', 'client',   'internal', 'spec', v_page, 'considering', current_date - 3, v_owner);
  insert into tasks(id, org_id, space_id, title, status, ball, origin, type, due_date, created_by)
    values (v_plain, v_org, v_space, 'ふつうの作業', 'todo', 'internal', 'internal', 'task', current_date - 3, v_owner);

  -- ボールを持つ側の担当
  insert into task_owners(org_id, space_id, task_id, side, user_id) values
    (v_org, v_space, v_over, 'client',   v_cli),
    (v_org, v_space, v_mtgT, 'internal', v_owner),
    (v_org, v_space, v_done, 'client',   v_cli),
    (v_org, v_space, v_plain,'internal', v_owner);
  -- 会議で作られた印（きっかけ2）
  insert into task_events(org_id, space_id, task_id, actor_id, meeting_id, action, payload)
    values (v_org, v_space, v_mtgT, v_owner, v_mtg, 'SPEC_CREATED', '{}'::jsonb);

  -- ---- 1) 期限超過と会議終了の2件が届く ----
  v_n := public.process_spec_decision_nudges();
  if v_n <> 2 then raise exception '1) 届いたのが %件（期待 2件）', v_n; end if;
  raise notice 'PASS 1) 期限超過と会議終了の2件が届く';

  -- ---- 2) ボールを持つ側の担当に届く ----
  if not exists (select 1 from notifications where to_user_id = v_cli and type = 'spec_decision_needed'
                  and payload->>'task_id' = v_over::text) then
    raise exception '2) 相手先ボールの札が相手先に届いていない';
  end if;
  if not exists (select 1 from notifications where to_user_id = v_owner and type = 'spec_decision_needed'
                  and payload->>'task_id' = v_mtgT::text) then
    raise exception '2) 社内ボールの札が社内に届いていない';
  end if;
  raise notice 'PASS 2) ボールを持つ側の担当に届く';

  -- ---- 3) 決定済み・担当なし・ふつうのタスクには届かない ----
  if exists (select 1 from notifications where type = 'spec_decision_needed'
              and payload->>'task_id' in (v_done::text, v_noown::text, v_plain::text)) then
    raise exception '3) 届いてはいけない札に届いている';
  end if;
  raise notice 'PASS 3) 決定済み・担当なし・ふつうのタスクには届かない';

  -- ---- 4) もう一度流しても増えない（札と人で1回だけ） ----
  v_n := public.process_spec_decision_nudges();
  if v_n <> 0 then raise exception '4) 2回目で %件 増えた（期待 0件）', v_n; end if;
  select count(*) into v_n from notifications where type = 'spec_decision_needed';
  if v_n <> 2 then raise exception '4) 通知の総数が %件（期待 2件）', v_n; end if;
  raise notice 'PASS 4) もう一度流しても増えない';

  -- ---- 5) 文面に理由が入る ----
  select payload->>'message' into v_msg from notifications
   where payload->>'task_id' = v_over::text and type = 'spec_decision_needed';
  if v_msg not like '%期限%' then raise exception '5) 期限超過の理由が文面に無い: %', v_msg; end if;
  select payload->>'message' into v_msg from notifications
   where payload->>'task_id' = v_mtgT::text and type = 'spec_decision_needed';
  if v_msg not like '%会議%' then raise exception '5) 会議終了の理由が文面に無い: %', v_msg; end if;
  raise notice 'PASS 5) 文面に「なぜ今か」が入る';

  -- ---- 6) 決まったあとは、もう届かない ----
  update tasks set decision_state = 'decided' where id = v_mtgT;
  delete from notifications where type = 'spec_decision_needed';
  v_n := public.process_spec_decision_nudges();
  if exists (select 1 from notifications where payload->>'task_id' = v_mtgT::text) then
    raise exception '6) 決まった札にまだ届いている';
  end if;
  raise notice 'PASS 6) 決まった札には届かない';

  raise notice '=== 決めてくださいの通知 全項目 PASS ===';
end $$;
