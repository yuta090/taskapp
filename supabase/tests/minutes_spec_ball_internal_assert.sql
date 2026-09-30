-- 議事録のタスク化で作る決定事項のタスクは、社内のボール＋社内の担当1人
-- （20260916104419_minutes_spec_ball_internal.sql）
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000f001';
  v_space uuid := '00000000-0000-4000-8000-00000000f002';
  v_user  uuid := '00000000-0000-4000-8000-00000000f003';  -- タスク化を押す人
  v_mate  uuid := '00000000-0000-4000-8000-00000000f004';  -- 行で選んだ担当者
  v_page  uuid := '00000000-0000-4000-8000-00000000f005';  -- 「仕様書」のページ
  v_plain uuid := '00000000-0000-4000-8000-00000000f006';  -- ふつうのページ
  v_mtg   uuid := '00000000-0000-4000-8000-00000000f007';
  v_md    text;
  v_res   jsonb;
  v_task  uuid;
  v_n     int;
  link    text;
begin
  insert into auth.users(id) values (v_user), (v_mate);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner'), (v_org, v_mate, 'member');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_user, 'admin'), (v_space, v_mate, 'editor');
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by) values
    (v_page,  v_org, v_space, '家の間取り', '[]', array['仕様書'], v_user, v_user),
    (v_plain, v_org, v_space, '参考資料',   '[]', array[]::text[], v_user, v_user);

  link := '/' || v_org::text || '/project/' || v_space::text || '/wiki?page=';
  v_md := '## やること' || E'\n' ||
    '- [ ] 玄関の向きを決める（期限: 1/1） [家の間取り](' || link || v_page::text || ') <!--assignee:' || v_mate::text || ' たかはし-->' || E'\n' ||
    '- [ ] 窓の数を決める [家の間取り](' || link || v_page::text || ')' || E'\n' ||
    '- [ ] 資料を読む [参考資料](' || link || v_plain::text || ')';

  insert into meetings(id, org_id, space_id, title, held_at, status, ended_at, minutes_md, created_by)
    values (v_mtg, v_org, v_space, '定例', now() - interval '2 hours', 'ended', now() - interval '1 hour', v_md, v_user);

  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_md);
  if (v_res->>'created_count')::int <> 3 then
    raise exception '0) 作られたのが %件（期待 3件）', v_res->>'created_count';
  end if;

  -- ---- 1) 決定事項のタスクはボールが社内 ----
  if exists (select 1 from tasks where space_id = v_space and type = 'spec' and ball <> 'internal') then
    raise exception '1) ボールが社内でない決定事項のタスクがある';
  end if;
  if (select count(*) from tasks where space_id = v_space and type = 'spec') <> 2 then
    raise exception '1) 決定事項のタスクが % 件（期待 2件）', (select count(*) from tasks where space_id = v_space and type = 'spec');
  end if;
  raise notice 'PASS 1) 決定事項のタスクはボールが社内';

  -- ---- 2) 行で担当者を選んでいれば、その人が社内の担当 ----
  select id into v_task from tasks where title = '玄関の向きを決める';
  if (select array_agg(user_id) from task_owners where task_id = v_task and side = 'internal') is distinct from array[v_mate] then
    raise exception '2) 社内の担当が選んだ人ではない（%）', (select array_agg(user_id) from task_owners where task_id = v_task);
  end if;
  raise notice 'PASS 2) 選んだ担当者が社内の担当になる';

  -- ---- 3) 選んでいなければ、押した人が社内の担当 ----
  if (select array_agg(user_id) from task_owners where task_id = (select id from tasks where title = '窓の数を決める') and side = 'internal')
     is distinct from array[v_user] then
    raise exception '3) 社内の担当が押した人ではない';
  end if;
  raise notice 'PASS 3) 選んでいなければ押した人が社内の担当になる';

  -- ---- 4) ふつうのタスクはボール社内・担当は入れない（task_create と揃える） ----
  if (select ball from tasks where title = '資料を読む') <> 'internal'
     or exists (select 1 from task_owners where task_id = (select id from tasks where title = '資料を読む')) then
    raise exception '4) ふつうのタスクのボールか担当がおかしい';
  end if;
  raise notice 'PASS 4) ふつうのタスクは社内のまま・担当は入れない';

  -- ---- 5) 2回押しても担当は増えない ----
  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_res->>'updated_minutes');
  if (select count(*) from task_owners where task_id in (select id from tasks where space_id = v_space)) <> 2 then
    raise exception '5) 担当の行が % 件（期待 2件）', (select count(*) from task_owners where task_id in (select id from tasks where space_id = v_space));
  end if;
  raise notice 'PASS 5) 2回押しても担当は増えない';

  -- ---- 6) 期限を過ぎた決定事項の「決めてください」が、社内の担当に届く ----
  v_n := public.process_spec_decision_nudges();
  if not exists (select 1 from notifications where to_user_id = v_mate and type = 'spec_decision_needed'
                 and payload->>'task_id' = v_task::text) then
    raise exception '6) 選んだ担当者に「決めてください」が届いていない（送った件数 %）', v_n;
  end if;
  raise notice 'PASS 6) 「決めてください」が社内の担当に届く';

  raise notice '議事録の決定事項のボール 全項目 PASS';
end $$;
