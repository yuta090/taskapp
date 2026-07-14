-- 昇格/却下RPCの受け入れ条件（Stage 2.7-B §4-9）。
-- 前提: promote_digest_task_test.sql（下地）→ 本物の migration → 本ファイル の順で流す。

set client_min_messages = notice;

do $$
declare
  v_org     uuid := '00000000-0000-4000-8000-000000000001';
  v_approver uuid := '00000000-0000-4000-8000-0000000000a1';
  v_other   uuid := '00000000-0000-4000-8000-0000000000a2';
  v_space   uuid := '00000000-0000-4000-8000-0000000000b1';
  v_group   uuid := '00000000-0000-4000-8000-0000000000d1';
  v_group_nospace uuid := '00000000-0000-4000-8000-0000000000d2';
  v_orgb    uuid := '00000000-0000-4000-8000-000000000002';
  v_spaceb  uuid := '00000000-0000-4000-8000-0000000000b2';
  v_groupb  uuid := '00000000-0000-4000-8000-0000000000d3';
  v_acct_a  uuid := '00000000-0000-4000-8000-0000000000c1';
  v_taskb   uuid;
  v_task    uuid;
  v_status  text;
  v_created boolean;
  v_taskid  uuid;
  v_taskid2 uuid;
  v_cnt     int;
begin
  -----------------------------------------------------------------------------
  -- helper: pending な候補を1件作る
  -----------------------------------------------------------------------------
  -- 1) 正常系: pending → 昇格。tasks が1件でき、client_scope='internal'（顧客に見えない）
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title, due_date,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, '酒屋へ発注', '2026-07-20',
    'pending', v_approver, now())
  returning id into v_task;

  select status, created, task_id into v_status, v_created, v_taskid
  from rpc_promote_digest_task(v_task, v_approver);

  if v_status <> 'promoted' then raise exception '1) status=% (期待 promoted)', v_status; end if;
  if not v_created then raise exception '1) created が false'; end if;

  if not exists (select 1 from tasks where id = v_taskid
                 and client_scope = 'internal'   -- ← 顧客ポータルに出さない
                 and ball = 'internal' and origin = 'client' and type = 'task'
                 and status = 'todo' and created_by = v_approver
                 and space_id = v_space and org_id = v_org
                 and title = '酒屋へ発注' and due_date = '2026-07-20'
                 and assignee_id is null) then
    raise exception '1) 昇格タスクの列が仕様どおりでない';
  end if;

  if not exists (select 1 from channel_digest_tasks where id = v_task
                 and promotion_state = 'promoted' and promoted_task_id = v_taskid
                 and confirmed_by_user_id = v_approver) then
    raise exception '1) digest 側の状態が promoted になっていない';
  end if;
  raise notice 'PASS 1) 正常昇格・client_scope=internal';

  -----------------------------------------------------------------------------
  -- 2) 冪等: promoted を再度昇格 → 200相当（既存task_id・created=false・2件目を作らない）
  -----------------------------------------------------------------------------
  select status, created, task_id into v_status, v_created, v_taskid2
  from rpc_promote_digest_task(v_task, v_approver);
  if v_status <> 'promoted' then raise exception '2) status=% (期待 promoted)', v_status; end if;
  if v_created then raise exception '2) created が true（2件目を作った疑い）'; end if;
  if v_taskid2 <> v_taskid then raise exception '2) 既存task_idを返していない'; end if;

  select count(*) into v_cnt from tasks where org_id = v_org;
  if v_cnt <> 1 then raise exception '2) tasks が % 件（1件のはず）', v_cnt; end if;
  raise notice 'PASS 2) 冪等（2件目を作らない）';

  -----------------------------------------------------------------------------
  -- 3) 依頼先本人でない内部メンバーが押す → forbidden（副作用ゼロ）
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, '請求書再送', 'pending', v_approver, now())
  returning id into v_task;

  select status into v_status from rpc_promote_digest_task(v_task, v_other);
  if v_status <> 'forbidden' then raise exception '3) status=% (期待 forbidden)', v_status; end if;
  if exists (select 1 from channel_digest_tasks where id = v_task and promotion_state <> 'pending') then
    raise exception '3) forbidden なのに状態が変わった';
  end if;
  raise notice 'PASS 3) 依頼先でない人 → forbidden・副作用ゼロ';

  -----------------------------------------------------------------------------
  -- 4) 却下: pending → rejected。再却下は no-op（200相当）
  -----------------------------------------------------------------------------
  select status into v_status from rpc_reject_digest_task(v_task, v_approver);
  if v_status <> 'rejected' then raise exception '4) status=% (期待 rejected)', v_status; end if;

  select status into v_status from rpc_reject_digest_task(v_task, v_approver);
  if v_status <> 'rejected' then raise exception '4) 再却下 status=% (期待 rejected/no-op)', v_status; end if;
  raise notice 'PASS 4) 却下・再却下no-op';

  -----------------------------------------------------------------------------
  -- 5) 矛盾遷移: rejected を昇格 → conflict（副作用ゼロ）
  -----------------------------------------------------------------------------
  select status into v_status from rpc_promote_digest_task(v_task, v_approver);
  if v_status <> 'conflict' then raise exception '5) status=% (期待 conflict)', v_status; end if;
  raise notice 'PASS 5) rejected を昇格 → conflict';

  -----------------------------------------------------------------------------
  -- 6) org を抜けた人が押す → forbidden（在籍再検証。requested_to のままでも）
  --    ※ LINE紐付けの revoke は webhook 層でアクター解決に失敗する形で効く（RPCは在籍で見る）。
  --      RPC自体は「現在の在籍」を毎回確認するので、メンバーシップ喪失で forbidden になる。
  -----------------------------------------------------------------------------
  delete from org_memberships where user_id = v_approver and org_id = v_org; -- org A のみ離脱
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, '棚卸し', 'pending', v_approver, now())
  returning id into v_task;

  select status into v_status from rpc_promote_digest_task(v_task, v_approver);
  if v_status <> 'forbidden' then raise exception '6) org離脱後 status=% (期待 forbidden)', v_status; end if;
  -- 戻す
  insert into org_memberships(org_id, user_id, role) values (v_org, v_approver, 'member');
  raise notice 'PASS 6) org離脱者は forbidden（在籍再検証）';

  -----------------------------------------------------------------------------
  -- 7) space未紐付けグループの候補は昇格できない → forbidden
  --    認可ファースト化により、space membership を確認できない（group.space_id null）候補は
  --    現・責任者であっても can_approve を通らず forbidden になる（状態を開示しない）。
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group_nospace, null, '住所変更', 'pending', v_approver, now())
  returning id into v_task;

  select status into v_status from rpc_promote_digest_task(v_task, v_approver);
  if v_status <> 'forbidden' then raise exception '7) space null 昇格 status=% (期待 forbidden)', v_status; end if;
  raise notice 'PASS 7) space未紐付けは forbidden（認可ファースト）';

  -----------------------------------------------------------------------------
  -- 8) sink配信を発火させない: 昇格は status 列を変更しない
  --    （status を変えると AFTER UPDATE トリガーが外部sinkへ配信してしまう）
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title, status,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, 'コピー用紙', 'open', 'pending', v_approver, now())
  returning id into v_task;

  perform rpc_promote_digest_task(v_task, v_approver);
  if (select status from channel_digest_tasks where id = v_task) <> 'open' then
    raise exception '8) 昇格で status(open) が変わった（sink誤配信の原因になる）';
  end if;
  raise notice 'PASS 8) 昇格は status を変えない（sink誤配信を防ぐ）';

  -----------------------------------------------------------------------------
  -- 9) 責任者交代: 旧責任者(a1)は、依頼先本人のままでも承認できない（現在の approver でない）
  --    Codex High: approver_user_id を認可に含めていなかった回帰
  -----------------------------------------------------------------------------
  update channel_groups set approver_user_id = v_other where id = v_group; -- a2 へ交代
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, '旧依頼', 'pending', v_approver, now())
  returning id into v_task;

  select status into v_status from rpc_promote_digest_task(v_task, v_approver);
  if v_status <> 'forbidden' then raise exception '9) 旧責任者 status=% (期待 forbidden)', v_status; end if;
  update channel_groups set approver_user_id = v_approver where id = v_group; -- 戻す
  raise notice 'PASS 9) 責任者交代後、旧責任者は forbidden';

  -----------------------------------------------------------------------------
  -- 10) LINE経路: external_user_id から解決して昇格できる（内部UUIDを外から渡さない）
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, 'LINE経由', 'pending', v_approver, now())
  returning id into v_task;

  select status, created into v_status, v_created
  from rpc_promote_digest_task_via_line(
    '00000000-0000-4000-8000-0000000000c1', 'Uapprover', v_task);
  if v_status <> 'promoted' or not v_created then
    raise exception '10) LINE経路 status=%/created=% (期待 promoted/true)', v_status, v_created;
  end if;
  raise notice 'PASS 10) LINE経路で昇格できる';

  -----------------------------------------------------------------------------
  -- 11) LINE経路: revoke 済みリンクの人が押しても解決不能 → forbidden
  --     （紐付けが revoke されると、内部ユーザーへ解決できない）
  -----------------------------------------------------------------------------
  update channel_user_links set revoked_at = now() where external_user_id = 'Uapprover';
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_org, v_group, v_space, 'revoke後', 'pending', v_approver, now())
  returning id into v_task;

  select status into v_status from rpc_promote_digest_task_via_line(
    '00000000-0000-4000-8000-0000000000c1', 'Uapprover', v_task);
  if v_status <> 'forbidden' then raise exception '11) revoke済みLINE status=% (期待 forbidden)', v_status; end if;
  update channel_user_links set revoked_at = null where external_user_id = 'Uapprover';
  raise notice 'PASS 11) revoke済みLINEは解決不能で forbidden';

  -----------------------------------------------------------------------------
  -- 12) 状態CHECK: rejected 行に confirmed 列は共存できない（排他）
  -----------------------------------------------------------------------------
  begin
    insert into channel_digest_tasks(org_id, group_id, space_id, title,
      promotion_state, requested_to_user_id, requested_at,
      rejected_by_user_id, rejected_at, confirmed_by_user_id, confirmed_at)
    values (v_org, v_group, v_space, '不正', 'rejected', v_approver, now(),
      v_approver, now(), v_approver, now());
    raise exception '12) rejected + confirmed が通ってしまった（CHECK が緩い）';
  exception when check_violation then
    raise notice 'PASS 12) rejected と confirmed は排他（CHECK が効く）';
  end;

  -----------------------------------------------------------------------------
  -- 13) テナント越え: org A の account(c1) で紐付いた a1 が、org B のタスクを
  --     LINE経路で承認しようとしても forbidden（identity を確立したテナントと不一致）。
  --     前提として a1 は org B の責任者＋メンバー＋space editor なので、*内部認可だけなら通る*。
  --     ラッパの org/account 束縛だけが唯一の防波堤であることを証明する。
  -----------------------------------------------------------------------------
  insert into channel_digest_tasks(org_id, group_id, space_id, title,
    promotion_state, requested_to_user_id, requested_at)
  values (v_orgb, v_groupb, v_spaceb, 'org Bの候補', 'pending', v_approver, now())
  returning id into v_taskb;

  -- LINE経路（攻撃）: org A の account c1 経由で org B タスクを狙う → forbidden
  select status into v_status from rpc_promote_digest_task_via_line(
    v_acct_a, 'Uapprover', v_taskb);
  if v_status <> 'forbidden' then
    raise exception '13) テナント越えLINE status=% (期待 forbidden)', v_status;
  end if;

  -- 証明: 内部RPCを直接呼べば a1 は org B の正当な責任者として *通る*。
  --       つまり13の forbidden はラッパのテナント束縛が止めた結果である。
  select status into v_status from rpc_promote_digest_task(v_taskb, v_approver);
  if v_status <> 'promoted' then
    raise exception '13) 内部RPC直呼びが promoted にならない（テストの前提が崩れている） status=%', v_status;
  end if;
  raise notice 'PASS 13) テナント越えLINEは forbidden（内部認可は通るのにラッパが阻止）';

  -----------------------------------------------------------------------------
  -- 14) CHECK 厳密化: 非promoted状態に promoted_task_id は共存不可 / 終状態に requested_at 必須
  -----------------------------------------------------------------------------
  begin
    insert into channel_digest_tasks(org_id, group_id, space_id, title,
      promotion_state, requested_to_user_id, requested_at, promoted_task_id)
    values (v_org, v_group, v_space, 'pending+task', 'pending', v_approver, now(),
      (select id from tasks limit 1));
    raise exception '14a) pending に promoted_task_id が通った（CHECK が緩い）';
  exception when check_violation then null; end;

  begin
    insert into channel_digest_tasks(org_id, group_id, space_id, title,
      promotion_state, requested_to_user_id, requested_at,
      rejected_by_user_id, rejected_at)
    values (v_org, v_group, v_space, 'rejected-no-reqat', 'rejected', v_approver, null,
      v_approver, now());
    raise exception '14b) rejected で requested_at=null が通った（CHECK が緩い）';
  exception when check_violation then null; end;
  raise notice 'PASS 14) 状態CHECKは promoted_task_id と requested_at も縛る';

  raise notice '=== 全項目 PASS ===';
end $$;
