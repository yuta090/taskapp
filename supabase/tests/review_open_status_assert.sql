-- 社内承認を依頼したら状態も「社内承認中」になる（20260914081534_review_open_sets_in_review.sql）
--
-- 前段: run_review_open_status.sh が空DBに全 migration を適用済み。
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-00000000f001';
  v_space uuid := '00000000-0000-4000-8000-00000000f002';
  v_owner uuid := '00000000-0000-4000-8000-00000000f003';
  v_rev   uuid := '00000000-0000-4000-8000-00000000f004';
  v_t1    uuid := '00000000-0000-4000-8000-00000000f011';
  v_t2    uuid := '00000000-0000-4000-8000-00000000f012';
  v_t3    uuid := '00000000-0000-4000-8000-00000000f013';
  v_before timestamptz;
  v_after  timestamptz;
  v_status text;
begin
  -- ---- 下ごしらえ ----
  insert into auth.users(id) values (v_owner), (v_rev);
  insert into organizations(id, name) values (v_org, '検証org');
  insert into org_memberships(org_id, user_id, role) values (v_org, v_owner, 'owner'), (v_org, v_rev, 'member');
  insert into spaces(id, org_id, type, name) values (v_space, v_org, 'project', '検証space');
  insert into space_memberships(space_id, user_id, role)
    values (v_space, v_owner, 'admin'), (v_space, v_rev, 'editor');

  insert into tasks(id, org_id, space_id, title, status, created_by)
    values (v_t1, v_org, v_space, '資料を作る', 'backlog', v_owner),
           (v_t2, v_org, v_space, '既に承認中', 'in_review', v_owner),
           (v_t3, v_org, v_space, '完了済み', 'done', v_owner);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ---- 1) 依頼すると backlog → in_review になる ----
  perform rpc_review_open(v_t1, array[v_rev]::uuid[]);
  select status into v_status from tasks where id = v_t1;
  if v_status <> 'in_review' then
    raise exception '1) 依頼しても状態が変わらない: %', v_status;
  end if;
  raise notice 'PASS 1) 依頼すると状態が in_review になる';

  -- ---- 2) 既に in_review なら updated_at をむだに動かさない ----
  select updated_at into v_before from tasks where id = v_t2;
  perform rpc_review_open(v_t2, array[v_rev]::uuid[]);
  select updated_at, status into v_after, v_status from tasks where id = v_t2;
  if v_status <> 'in_review' then raise exception '2) 状態が変わってしまった: %', v_status; end if;
  if v_after <> v_before then raise exception '2) 触らなくてよい行の updated_at が進んだ'; end if;
  raise notice 'PASS 2) 既に in_review なら何も動かさない';

  -- ---- 3) 完了済みのタスクは done のまま（完了を取り消さない） ----
  perform rpc_review_open(v_t3, array[v_rev]::uuid[]);
  select status into v_status from tasks where id = v_t3;
  if v_status <> 'done' then
    raise exception '3) 完了済みのタスクが戻された: %', v_status;
  end if;
  raise notice 'PASS 3) 完了済みは done のまま';

  -- ---- 4) 承認しても勝手に完了にはならない（完了は人が押す） ----
  perform set_config('request.jwt.claim.sub', v_rev::text, true);
  perform rpc_review_approve(v_t1);
  select status into v_status from tasks where id = v_t1;
  if v_status <> 'in_review' then
    raise exception '4) 承認で状態が勝手に変わった: %', v_status;
  end if;
  if (select status from reviews where task_id = v_t1) <> 'approved' then
    raise exception '4) 依頼が approved になっていない';
  end if;
  raise notice 'PASS 4) 承認しても完了にはならない（依頼だけ approved になる）';

  -- ---- 5) 差し戻しても状態は戻さない（直す作業は続くため） ----
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform rpc_review_open(v_t1, array[v_rev]::uuid[]);
  perform set_config('request.jwt.claim.sub', v_rev::text, true);
  perform rpc_review_block(v_t1, 'ここを直してください');
  select status into v_status from tasks where id = v_t1;
  if v_status <> 'in_review' then
    raise exception '5) 差し戻しで状態が変わった: %', v_status;
  end if;
  if (select ball from tasks where id = v_t1) <> 'internal' then
    raise exception '5) 差し戻しでボールが社内に戻っていない（既存のふるまい）';
  end if;
  raise notice 'PASS 5) 差し戻しても状態は in_review のまま（ボールだけ社内に戻る）';

  raise notice '=== 承認依頼と状態の連動 全項目 PASS ===';
end $$;
