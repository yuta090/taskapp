-- リンクの無いチェックリスト行もタスクにできる（20260914150737_minutes_taskify_plain_lines.sql）
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000d001';
  v_space uuid := '00000000-0000-4000-8000-00000000d002';
  v_other uuid := '00000000-0000-4000-8000-00000000d007';
  v_user  uuid := '00000000-0000-4000-8000-00000000d003';
  v_page  uuid := '00000000-0000-4000-8000-00000000d004';
  v_alien uuid := '00000000-0000-4000-8000-00000000d008';
  v_mtg   uuid := '00000000-0000-4000-8000-00000000d006';
  v_md    text;
  v_res   jsonb;
begin
  insert into auth.users(id) values (v_user);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space'),
                                                    (v_other, v_org, 'project', '別space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_user, 'admin'), (v_other, v_user, 'admin');
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by) values
    (v_page,  v_org, v_space, '家の間取り', '[]', array['仕様書'], v_user, v_user),
    (v_alien, v_org, v_other, '別spaceのページ', '[]', array['仕様書'], v_user, v_user);

  v_md := '## やること' || E'\n' ||
    '- [ ] 田畠さんに販売戦略のレビュー依頼' || E'\n' ||
    '- [ ] 玄関の向きを決める [家の間取り](/' || v_org::text || '/project/' || v_space::text || '/wiki?page=' || v_page::text || ')' || E'\n' ||
    '- [ ] 別spaceのページを指す行 [よそ](/' || v_org::text || '/project/' || v_other::text || '/wiki?page=' || v_alien::text || ')' || E'\n' ||
    '- [x] 済んだこと' || E'\n' ||
    '- ただの箇条書き' || E'\n' ||
    '- [ ] ';

  insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by)
    values (v_mtg, v_org, v_space, '定例', now(), 'ended', v_md, v_user);

  -- ---- 1) リンクの有無にかかわらず、未チェックの行を拾う ----
  v_res := public.rpc_get_minutes_preview_as(v_user, v_mtg, v_md);
  if (v_res->>'new_spec_count')::int <> 3 then
    raise exception '1) 候補が %件（期待 3件: リンク無し・仕様書・別space）', v_res->>'new_spec_count';
  end if;
  raise notice 'PASS 1) リンクが無い行も候補になる';

  -- ---- 2) 作ってみる ----
  v_res := public.rpc_parse_meeting_minutes_as(v_user, v_mtg, v_md);
  if (v_res->>'created_count')::int <> 3 then
    raise exception '2) 作られたのが %件（期待 3件）', v_res->>'created_count';
  end if;
  raise notice 'PASS 2) 3件とも作られる';

  -- ---- 3) リンク無しは、資料の紐づかないふつうのタスク ----
  if (select type from tasks where title = '田畠さんに販売戦略のレビュー依頼') <> 'task' then
    raise exception '3) リンク無しが決定事項のタスクになっている';
  end if;
  if (select wiki_page_id from tasks where title = '田畠さんに販売戦略のレビュー依頼') is not null then
    raise exception '3) リンク無しに資料が紐づいている';
  end if;
  if (select decision_state from tasks where title = '田畠さんに販売戦略のレビュー依頼') is not null then
    raise exception '3) リンク無しに決定の状態が入っている';
  end if;
  raise notice 'PASS 3) リンク無しは資料の紐づかないふつうのタスク';

  -- ---- 4) 仕様書のページの行は、これまでどおり決定事項のタスク ----
  if (select type from tasks where title = '玄関の向きを決める') <> 'spec' then
    raise exception '4) 仕様書の行が決定事項のタスクになっていない';
  end if;
  if (select wiki_page_id from tasks where title = '玄関の向きを決める') <> v_page then
    raise exception '4) 資料が紐づいていない';
  end if;
  raise notice 'PASS 4) 仕様書のページの行は決定事項のタスクのまま';

  -- ---- 5) 別 space のページを指す行は、紐づけずに拾う ----
  if (select wiki_page_id from tasks where title = '別spaceのページを指す行') is not null then
    raise exception '5) 別 space のページが紐づいてしまっている';
  end if;
  if (select type from tasks where title = '別spaceのページを指す行') <> 'task' then
    raise exception '5) 別 space の行が決定事項のタスクになっている';
  end if;
  raise notice 'PASS 5) 別 space のページは紐づけないが、行は拾う';

  -- ---- 6) チェック済み・箇条書き・空の行は拾わない ----
  if exists (select 1 from tasks where title in ('済んだこと', 'ただの箇条書き')) then
    raise exception '6) 拾ってはいけない行を拾っている';
  end if;
  if (select count(*) from tasks where space_id = v_space) <> 3 then
    raise exception '6) タスクの総数が合わない（空の行を拾った可能性）';
  end if;
  raise notice 'PASS 6) チェック済み・箇条書き・中身が空の行は拾わない';

  raise notice '=== リンク無しの行のタスク化 全項目 PASS ===';
end $$;
