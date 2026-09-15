-- 議事録の行の印から、担当者とマイルストーンが入る
-- （20260915195531_minutes_task_assignee_milestone.sql）
set client_min_messages = notice;

do $$
declare
  v_org    uuid := '00000000-0000-4000-8000-00000000e001';
  v_space  uuid := '00000000-0000-4000-8000-00000000e002';
  v_other  uuid := '00000000-0000-4000-8000-00000000e003';
  v_user   uuid := '00000000-0000-4000-8000-00000000e004';
  v_mate   uuid := '00000000-0000-4000-8000-00000000e005';
  -- この space に居ない人（本文を手で書き換えて割り当てようとしたとき用）
  v_alien  uuid := '00000000-0000-4000-8000-00000000e006';
  v_ms     uuid := '00000000-0000-4000-8000-00000000e007';
  -- 別 space のマイルストーン
  v_ms_alien uuid := '00000000-0000-4000-8000-00000000e008';
  v_mtg    uuid := '00000000-0000-4000-8000-00000000e009';
  v_md     text;
  v_res    jsonb;
  v_title  text;
  v_after  text;
begin
  insert into auth.users(id) values (v_user), (v_mate), (v_alien);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner'), (v_org, v_mate, 'member');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space'),
                                                    (v_other, v_org, 'project', '別space');
  insert into space_memberships(space_id, user_id, role) values
    (v_space, v_user, 'admin'), (v_space, v_mate, 'editor'), (v_other, v_user, 'admin');
  insert into milestones(id, org_id, space_id, name) values
    (v_ms, v_org, v_space, '第1弾'), (v_ms_alien, v_org, v_other, 'よその節目');

  v_md := '## やること' || E'\n' ||
    '- [ ] 見積を出す（期限: 9/20） <!--assignee:' || v_mate::text || ' たかはし--> <!--milestone:' || v_ms::text || ' 第1弾-->' || E'\n' ||
    '- [ ] 印の無い行' || E'\n' ||
    '- [ ] よその人を指す行 <!--assignee:' || v_alien::text || ' よその人-->' || E'\n' ||
    '- [ ] よその節目を指す行 <!--milestone:' || v_ms_alien::text || ' よその節目-->';

  insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by)
    values (v_mtg, v_org, v_space, '定例', now(), 'ended', v_md, v_user);

  -- ---- 1) プレビューの題名に印が残らない ----
  v_res := public.rpc_get_minutes_preview_as(v_user, v_mtg, v_md);
  if (v_res->>'new_spec_count')::int <> 4 then
    raise exception '1) 候補が %件（期待 4件）', v_res->>'new_spec_count';
  end if;
  v_title := v_res->'new_specs'->0->>'title';
  if v_title <> '見積を出す' then
    raise exception '1) プレビューの題名が「%」（期待「見積を出す」）', v_title;
  end if;
  raise notice 'PASS 1) プレビューの題名に印が残らない';

  -- ---- 2) 作ってみる ----
  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_md);
  if (v_res->>'created_count')::int <> 4 then
    raise exception '2) 作られたのが %件（期待 4件）', v_res->>'created_count';
  end if;
  raise notice 'PASS 2) 4件とも作られる';

  -- ---- 3) 印のとおりに担当者とマイルストーンが入る ----
  if (select assignee_id from tasks where title = '見積を出す') is distinct from v_mate then
    raise exception '3) 担当者が入っていない（%）', (select assignee_id from tasks where title = '見積を出す');
  end if;
  if (select milestone_id from tasks where title = '見積を出す') is distinct from v_ms then
    raise exception '3) マイルストーンが入っていない（%）', (select milestone_id from tasks where title = '見積を出す');
  end if;
  if (select due_date from tasks where title = '見積を出す') is null then
    raise exception '3) 期限が入っていない（印を足して期限の読み取りが壊れた）';
  end if;
  raise notice 'PASS 3) 印のとおりに担当者・マイルストーン・期限が入る';

  -- ---- 4) 印の無い行に、前の行の担当者が持ち越されない ----
  if (select assignee_id from tasks where title = '印の無い行') is not null then
    raise exception '4) 印の無い行に担当者が付いている（前の行の持ち越し）';
  end if;
  if (select milestone_id from tasks where title = '印の無い行') is not null then
    raise exception '4) 印の無い行にマイルストーンが付いている（前の行の持ち越し）';
  end if;
  raise notice 'PASS 4) 印の無い行には何も付かない';

  -- ---- 5) その space に居ない人は入らない（本文を手で書き換えても割り当てられない） ----
  if (select assignee_id from tasks where title = 'よその人を指す行') is not null then
    raise exception '5) space の外の人が担当者に入っている';
  end if;
  raise notice 'PASS 5) space に居ない人は担当者にならない（行そのものは作られる）';

  -- ---- 6) 別 space のマイルストーンは入らない ----
  if (select milestone_id from tasks where title = 'よその節目を指す行') is not null then
    raise exception '6) 別 space のマイルストーンが入っている';
  end if;
  raise notice 'PASS 6) 別 space のマイルストーンは入らない（行そのものは作られる）';

  -- ---- 7) タスクの題名に印が残らない ----
  if exists (select 1 from tasks where space_id = v_space and title like '%<!--%') then
    raise exception '7) 題名に印が残っている（%）', (select title from tasks where space_id = v_space and title like '%<!--%' limit 1);
  end if;
  raise notice 'PASS 7) タスクの題名に印が残らない';

  -- ---- 8) 書き戻した本文は、行末が「タスク化済み」の印で終わる ----
  -- ここが崩れると、次に押したときに同じ行からもう1つタスクができる
  v_after := v_res->>'updated_minutes';
  if (select count(*) from unnest(string_to_array(v_after, E'\n')) l
      where l ~ '^-\s*\[\s*\]' and l !~ '<!--task:[^>]+-->\s*$') <> 0 then
    raise exception '8) 行末が「タスク化済み」の印で終わっていない行がある';
  end if;
  raise notice 'PASS 8) 書き戻した行は「タスク化済み」の印で終わる';

  -- ---- 9) もう一度押しても増えない ----
  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_after);
  if (v_res->>'created_count')::int <> 0 then
    raise exception '9) 2回目で %件できた（期待 0件）', v_res->>'created_count';
  end if;
  if (select count(*) from tasks where space_id = v_space) <> 4 then
    raise exception '9) タスクの総数が % 件（期待 4件）', (select count(*) from tasks where space_id = v_space);
  end if;
  raise notice 'PASS 9) 2回押しても同じタスクは増えない';

  -- ---- 10) 名前に丸括弧が入っていても、題名に印が残らない ----
  -- 旧来の SPEC 行は題名を「最初の丸括弧の手前まで」で切るので、印を先に落としていないと
  -- 「題名 <!--assignee:… 田中」で切れて残る
  declare
    v_mtg2 uuid := '00000000-0000-4000-8000-00000000e00a';
    v_md2  text;
  begin
    v_md2 := '- [ ] SPEC(/spec/REVIEW_SPEC.md#x): 仕様を決める <!--assignee:' || v_mate::text || ' 田中（営業）-->' || E'\n' ||
             '- [ ] 括弧入りの担当 <!--assignee:' || v_mate::text || ' 田中(営業)-->';
    insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by)
      values (v_mtg2, v_org, v_space, '定例2', now(), 'ended', v_md2, v_user);

    v_res := public.rpc_get_minutes_preview_as(v_user, v_mtg2, v_md2);
    if v_res->'new_specs'->0->>'title' <> '仕様を決める' then
      raise exception '10) プレビューの題名が「%」（期待「仕様を決める」）', v_res->'new_specs'->0->>'title';
    end if;

    v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg2, v_md2);
    if (v_res->>'created_count')::int <> 2 then
      raise exception '10) 作られたのが %件（期待 2件）', v_res->>'created_count';
    end if;
    if not exists (select 1 from tasks where title = '仕様を決める' and assignee_id = v_mate) then
      raise exception '10) SPEC 行の題名か担当者が合わない（%）',
        (select title from tasks where space_id = v_space and title like '%仕様%' limit 1);
    end if;
    if not exists (select 1 from tasks where title = '括弧入りの担当' and assignee_id = v_mate) then
      raise exception '10) ふつうの行の題名か担当者が合わない（%）',
        (select title from tasks where space_id = v_space and title like '%括弧%' limit 1);
    end if;
    raise notice 'PASS 10) 名前に丸括弧が入っても題名に印が残らない';
  end;

  raise notice '=== 議事録の担当者・マイルストーン 全項目 PASS ===';
end $$;
