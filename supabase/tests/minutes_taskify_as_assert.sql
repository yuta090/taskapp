-- CLI / API から議事録をタスク化できる（20260914124023_minutes_taskify_as.sql）
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000c001';
  v_space uuid := '00000000-0000-4000-8000-00000000c002';
  v_user  uuid := '00000000-0000-4000-8000-00000000c003';
  v_page  uuid := '00000000-0000-4000-8000-00000000c004';
  v_ref   uuid := '00000000-0000-4000-8000-00000000c005';
  v_mtg   uuid := '00000000-0000-4000-8000-00000000c006';
  v_md    text;
  v_res   jsonb;
  v_msg   text;
  v_n     int;
begin
  insert into auth.users(id) values (v_user);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_user, 'admin');
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by) values
    (v_page, v_org, v_space, '家の間取り', '[]', array['仕様書'], v_user, v_user),
    (v_ref,  v_org, v_space, '比較検討メモ', '[]', array[]::text[], v_user, v_user);

  v_md := '## 決めること' || E'\n' ||
    '- [ ] 玄関の向きを決める [家の間取り](/' || v_org::text || '/project/' || v_space::text || '/wiki?page=' || v_page::text || ')' || E'\n' ||
    '- [ ] 間取り案を3つ作る [比較検討メモ](/' || v_org::text || '/project/' || v_space::text || '/wiki?page=' || v_ref::text || ')' || E'\n' ||
    '- [x] これは済み [家の間取り](/' || v_org::text || '/project/' || v_space::text || '/wiki?page=' || v_page::text || ')';

  insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by)
    values (v_mtg, v_org, v_space, '定例', now(), 'ended', v_md, v_user);

  -- ---- 1) 道具用の候補確認が動く ----
  v_res := public.rpc_get_minutes_preview_as(v_user, v_mtg, v_md);
  if (v_res->>'new_spec_count')::int <> 2 then
    raise exception '1) 候補が %件（期待 2件。チェック済みは拾わない）', v_res->>'new_spec_count';
  end if;
  raise notice 'PASS 1) 道具用の候補確認が動く（チェック済みは拾わない）';

  -- ---- 2) 道具用のタスク化が動き、実行者が記録される ----
  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_md);
  if (v_res->>'created_count')::int <> 2 then
    raise exception '2) 作られたのが %件（期待 2件）', v_res->>'created_count';
  end if;
  if (select count(*) from tasks where space_id = v_space) <> 2 then
    raise exception '2) tasks の件数が合わない';
  end if;
  if (select actor_id from task_events where action = 'SPEC_CREATED' limit 1) <> v_user then
    raise exception '2) 監査の実行者が渡した人になっていない';
  end if;
  raise notice 'PASS 2) 道具用のタスク化が動き、実行者が記録される';

  -- ---- 3) 仕様書タグの有無で、決定事項のタスクとふつうのタスクに分かれる ----
  if (select decision_state from tasks where title = '玄関の向きを決める') <> 'considering' then
    raise exception '3) 仕様書ページの行が決定事項のタスクになっていない';
  end if;
  if (select type from tasks where title = '間取り案を3つ作る') <> 'task' then
    raise exception '3) タグ無しの行が決定事項のタスクになってしまっている';
  end if;
  if (select wiki_page_id from tasks where title = '間取り案を3つ作る') <> v_ref then
    raise exception '3) 参考資料として紐づいていない';
  end if;
  raise notice 'PASS 3) 仕様書タグの有無で分かれる';

  -- ---- 4) 本文がずれていたら何も書かずに止まる ----
  begin
    v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_md || E'\n- [ ] 後から足した行');
    raise exception '4) 古い本文で通ってしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%4)%' then raise; end if;
    if v_msg not like '%別の場所で更新されています%' then
      raise exception '4) 想定と違う理由で止まった: %', v_msg;
    end if;
  end;
  select count(*) into v_n from tasks where space_id = v_space;
  if v_n <> 2 then raise exception '4) 止まったのに tasks が増えた（%件）', v_n; end if;
  raise notice 'PASS 4) 本文がずれていたら何も書かずに止まる';

  -- ---- 5) 画面用もこれまでどおり動く ----
  select minutes_md into v_md from meetings where id = v_mtg;  -- 目印が付いた後の本文
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  v_res := public.rpc_parse_meeting_minutes(v_mtg, v_md);
  if (v_res->>'created_count')::int <> 0 then
    raise exception '5) 作成済みの行から二重に作られた（%件）', v_res->>'created_count';
  end if;
  raise notice 'PASS 5) 画面用も動き、作成済みの行は二重に作らない';

  raise notice '=== CLIからのタスク化 全項目 PASS ===';
end $$;

-- ---- 6) 道具用は authenticated からは呼べない ----
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-00000000c003';
  v_mtg  uuid := '00000000-0000-4000-8000-00000000c006';
  v_msg  text;
begin
  begin
    set local role authenticated;
    perform public.rpc_parse_meeting_minutes_as(v_user, v_mtg, '');
    reset role;
    raise exception '6) authenticated が道具用を呼べてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%6)%' then raise; end if;
    if v_msg like '%permission denied%' then
      raise notice 'PASS 6) 道具用は authenticated から呼べない';
    else
      raise exception '6) 権限ではなく別の理由で失敗した: %', v_msg;
    end if;
  end;
end $$;
