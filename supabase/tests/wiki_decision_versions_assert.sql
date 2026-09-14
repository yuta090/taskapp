-- 「確定した時点の控え」の検証（20260914072915_wiki_decision_versions.sql）
--
-- ユーザーの言う「凍結」は、ページを編集できなくすることではなく
--   - 確定した瞬間の本文が控えとして残る
--   - あとから本文が変わったら分かる
-- の2つ。ここではその土台（控えの名札・決定行・名札の偽造防止）を確かめる。
--
-- 前段: run_wiki_decision_versions.sh が空DBに全 migration を適用済み。
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000e001';
  v_space uuid := '00000000-0000-4000-8000-00000000e002';
  v_user  uuid := '00000000-0000-4000-8000-00000000e003';
  v_page  uuid := '00000000-0000-4000-8000-00000000e004';
  v_task  uuid := '00000000-0000-4000-8000-00000000e005';
  v_body  text;
  r       record;
  v_cnt   int;
  v_err   text;
begin
  -- ---- 下ごしらえ（所有者として入れる。RLS は superuser を通すため素直に入る） ----
  insert into auth.users(id) values (v_user);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role) values (v_space, v_user, 'admin');

  -- 本文は BlockNote の JSON 配列（段落1つ）
  insert into wiki_pages(id, org_id, space_id, title, body, tags, created_by, updated_by)
  values (
    v_page, v_org, v_space, '家の間取り',
    '[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"検討中の案","styles":{}}],"children":[]}]',
    array['仕様書'], v_user, v_user
  );

  insert into tasks(id, org_id, space_id, title, status, ball, origin, type,
                    wiki_page_id, decision_state, created_by)
  values (v_task, v_org, v_space, '玄関の向きを決める', 'considering', 'client', 'internal', 'spec',
          v_page, 'considering', v_user);

  -- 呼び出す人を決める（auth.uid() は request.jwt.claim.sub を読む）
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- ---- 1) 確定すると、名札付きの控えが1件できる ----
  perform rpc_set_spec_state(v_task, 'decided');

  select count(*) into v_cnt from wiki_page_versions where page_id = v_page;
  if v_cnt <> 1 then raise exception '1) 控えが % 件（期待 1）', v_cnt; end if;

  select * into r from wiki_page_versions where page_id = v_page;
  if r.kind <> 'decided' then raise exception '1) kind=% （期待 decided）', r.kind; end if;
  if r.task_id <> v_task then raise exception '1) task_id が札を指していない'; end if;
  raise notice 'PASS 1) 確定すると kind=decided / task_id 付きの控えができる';

  -- ---- 2) 控えの中身は「決定行を書き足す前」＝確定した瞬間の内容 ----
  if r.body like '%決定:%' then
    raise exception '2) 控えに決定行が入っている（確定時点の内容になっていない）';
  end if;
  if r.body not like '%検討中の案%' then
    raise exception '2) 控えに確定前の本文が入っていない';
  end if;
  raise notice 'PASS 2) 控えは決定行を書き足す前の本文';

  -- ---- 3) ページの末尾に、札へのリンク付きの決定行が入る（絵文字なし） ----
  select body into v_body from wiki_pages where id = v_page;
  if v_body not like '%"text": "決定: "%' and v_body not like '%"text":"決定: "%' then
    raise exception '3) 決定行が入っていない: %', left(v_body, 400);
  end if;
  if v_body not like '%?task=' || v_task::text || '%' then
    raise exception '3) 決定行に札へのリンクが無い';
  end if;
  if v_body like '%/' || v_org::text || '/project/' || v_space::text || '?task=%' is not true then
    raise exception '3) リンクの形が想定と違う: %', left(v_body, 400);
  end if;
  if v_body like '%✅%' or v_body like '%🚀%' then
    raise exception '3) 決定行に絵文字が残っている';
  end if;
  if v_body not like '%検討中の案%' then
    raise exception '3) もとの本文が消えている（末尾に足すのではなく置き換えている）';
  end if;
  raise notice 'PASS 3) 末尾に札へのリンク付きの決定行が入る（絵文字なし・もとの本文は残る）';

  -- ---- 4) 確定した直後は「変わっていない」（控えとページの時刻が一致する） ----
  -- 同じトランザクションの now() を使うので一致する。画面の判定
  -- （hasChangedSinceDecision）はこの前提に乗っている。
  if (select updated_at from wiki_pages where id = v_page)
     <> (select created_at from wiki_page_versions where page_id = v_page and kind = 'decided') then
    raise exception '4) ページの更新時刻と控えの時刻がずれている（確定直後に「変わった」と誤検知する）';
  end if;
  raise notice 'PASS 4) 確定した直後はページと控えの時刻が一致する';

  -- ---- 5) 札の状態も進んでいる ----
  if (select decision_state from tasks where id = v_task) <> 'decided' then
    raise exception '5) 札が decided になっていない';
  end if;
  raise notice 'PASS 5) 札が decided になる';

  raise notice '=== 確定時点の控え 全項目 PASS ===';
end $$;

-- ---- 6) 名札の偽造防止（列ごとの権限）。role を切り替えるので別ブロックにする ----
-- 注意: 権限による拒否も RLS による拒否も SQLSTATE は同じ 42501（insufficient_privilege）。
-- どちらで止まったかは**メッセージで見分ける**（コードだけで見ると 6) が RLS のおかげで
-- 通ってしまい、列ごとの権限を確かめたことにならない）。
do $$
declare
  v_org  uuid := '00000000-0000-4000-8000-00000000e001';
  v_page uuid := '00000000-0000-4000-8000-00000000e004';
  v_user uuid := '00000000-0000-4000-8000-00000000e003';
  v_msg  text;
begin
  begin
    set local role authenticated;
    insert into wiki_page_versions(org_id, page_id, title, body, created_by, kind)
    values (v_org, v_page, 'にせもの', 'x', v_user, 'decided');
    reset role;
    raise exception '6) authenticated が kind を付けて控えを作れてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%6)%' then raise; end if;
    if v_msg like '%permission denied%' then
      raise notice 'PASS 6) authenticated は kind を付けて控えを作れない（権限で拒否）';
    else
      raise exception '6) 権限ではなく別の理由で止まった: %', v_msg;
    end if;
  end;
end $$;

-- ---- 7) 許した5列だけなら、権限では止まらない（自動保存・CLI が壊れていない） ----
--   RLS で止まるのが正しい姿。権限で止まったら、これまでの保存経路を壊している。
do $$
declare
  v_org  uuid := '00000000-0000-4000-8000-00000000e001';
  v_page uuid := '00000000-0000-4000-8000-00000000e004';
  v_user uuid := '00000000-0000-4000-8000-00000000e003';
  v_msg  text;
begin
  begin
    set local role authenticated;
    insert into wiki_page_versions(org_id, page_id, title, body, created_by)
    values (v_org, v_page, 'ふつうの控え', 'y', v_user);
    reset role;
    raise notice 'PASS 7) 5列だけの控えは通る';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%permission denied%' then
      raise exception '7) 5列だけの控えが権限で止まった（自動保存・CLI を壊している）: %', v_msg;
    elsif v_msg like '%row-level security%' then
      raise notice 'PASS 7) 5列だけの控えは権限では止まらない（RLS で止まる＝正しい）';
    else
      raise exception '7) 想定と違う理由で失敗した: %', v_msg;
    end if;
  end;
end $$;

-- ---- 8) 控えは後から書き換えられない（insert を列で絞っても update が開いていたら無意味） ----
do $$
declare
  v_id  uuid;
  v_msg text;
begin
  select id into v_id from wiki_page_versions where kind = 'decided' limit 1;
  begin
    set local role authenticated;
    update wiki_page_versions set kind = 'decided' where id = v_id;
    reset role;
    raise exception '8) authenticated が控えを書き換えられてしまった';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg like '%8)%' then raise; end if;
    if v_msg like '%permission denied%' then
      raise notice 'PASS 8) authenticated は控えを書き換えられない';
    else
      raise exception '8) 権限ではなく別の理由で止まった: %', v_msg;
    end if;
  end;
end $$;
