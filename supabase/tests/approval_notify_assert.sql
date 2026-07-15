-- rpc_claim_pending_approval_notifications の受け入れ条件（Stage 2.7-B §4-4）。
set client_min_messages = notice;

do $$
declare
  v_org  uuid := '00000000-0000-4000-8000-000000000001';
  v_a1   uuid := '00000000-0000-4000-8000-0000000000a1';
  v_a2   uuid := '00000000-0000-4000-8000-0000000000a2';
  v_a3   uuid := '00000000-0000-4000-8000-0000000000a3'; -- 退職者approver
  v_g1   uuid := '00000000-0000-4000-8000-0000000000d1'; -- approver紐付けあり
  v_g2   uuid := '00000000-0000-4000-8000-0000000000d2'; -- approver紐付け無し
  v_g3   uuid := '00000000-0000-4000-8000-0000000000d3'; -- 退職者approver（リンクありだが在籍なし）
  v_t1   uuid;
  v_t2   uuid;
  v_t3   uuid;
  v_ext  text;
  v_n    int;
  r      record;
begin
  -- pending 候補: g1（紐付けあり）×2、g2（紐付け無し）×1、g3（退職者・リンクあり在籍なし）×1
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g1, '発注', 'pending', v_a1, now()) returning id into v_t1;
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g1, '請求', 'pending', v_a1, now());
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g2, '棚卸', 'pending', v_a2, now()) returning id into v_t2;
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g3, '退職者宛', 'pending', v_a3, now()) returning id into v_t3;
  -- none の候補（承認フロー外）は対象外
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state)
    values (v_org, v_g1, '雑談メモ', 'none');

  -----------------------------------------------------------------------------
  -- 1) claim: 紐付けありの pending だけ返る。external は最新リンク(Uapprover-new)に確定。
  -----------------------------------------------------------------------------
  select count(*) into v_n from rpc_claim_pending_approval_notifications(50);
  if v_n <> 2 then raise exception '1) claim件数=% (期待 2: g1の2件のみ)', v_n; end if;

  if exists (
    select 1 from rpc_claim_pending_approval_notifications(50)
  ) then
    -- 2回目: 1回目で notified を刻んだので、もう返らないはず（この select 自体が2回目）
    raise exception '2) 2回目の claim で行が返った（notified を刻んでいない/冪等でない）';
  end if;
  raise notice 'PASS 1-2) 紐付けありpendingのみ2件claim・2回目は空（notified印で冪等）';

  -----------------------------------------------------------------------------
  -- 3) 掴んだ行の external_user_id は最新リンクに確定している（複数リンクでも1行）
  --    ※ claim は notified を刻むので、検証用に手で notified を戻して1件だけ再claimする
  -----------------------------------------------------------------------------
  update channel_digest_tasks set approval_notified_at = null where id = v_t1;
  select * into r from rpc_claim_pending_approval_notifications(50) where task_id = v_t1;
  if r.external_user_id <> 'Uapprover-new' then
    raise exception '3) external=% (期待 Uapprover-new 最新リンク)', r.external_user_id;
  end if;
  if r.channel_account_id <> '00000000-0000-4000-8000-0000000000c1' then
    raise exception '3) account が違う';
  end if;
  if r.title <> '発注' then raise exception '3) title=%', r.title; end if;
  raise notice 'PASS 3) 複数リンクでも1行・最新external・account/title を返す';

  -----------------------------------------------------------------------------
  -- 4) 紐付け無し approver(g2/a2)の候補は claim されない（notified も刻まれない）
  -----------------------------------------------------------------------------
  if (select approval_notified_at from channel_digest_tasks where id = v_t2) is not null then
    raise exception '4) 紐付け無しなのに notified が刻まれた';
  end if;
  -- a2 に有効リンクを与えると、次の claim で拾える（リンク後リトライ）
  insert into channel_user_links(org_id, user_id, channel_account_id, external_user_id)
    values (v_org, v_a2, '00000000-0000-4000-8000-0000000000c1', 'Ua2');
  select count(*) into v_n from rpc_claim_pending_approval_notifications(50) where task_id = v_t2;
  if v_n <> 1 then raise exception '4) リンク付与後も claim されない n=%', v_n; end if;
  raise notice 'PASS 4) 紐付け無しは対象外→リンク後にリトライで拾える';

  -----------------------------------------------------------------------------
  -- 5) revoke されたリンクは無効（掴まない）
  -----------------------------------------------------------------------------
  update channel_digest_tasks set approval_notified_at = null;      -- 全部未通知に戻す
  update channel_user_links set revoked_at = now();                 -- 全リンク失効
  select count(*) into v_n from rpc_claim_pending_approval_notifications(50);
  if v_n <> 0 then raise exception '5) revoke後も claim された n=%', v_n; end if;
  raise notice 'PASS 5) revoke済みリンクは対象外';

  -----------------------------------------------------------------------------
  -- 6) limit が効く
  -----------------------------------------------------------------------------
  update channel_user_links set revoked_at = null where external_user_id = 'Uapprover-new';
  update channel_digest_tasks set approval_notified_at = null;
  select count(*) into v_n from rpc_claim_pending_approval_notifications(1);
  if v_n <> 1 then raise exception '6) limit=1 なのに n=%', v_n; end if;
  raise notice 'PASS 6) limit が効く';

  -----------------------------------------------------------------------------
  -- 7) p_limit=NULL でも「無制限(LIMIT NULL)」にならず、既定にクランプされて動く
  -----------------------------------------------------------------------------
  update channel_digest_tasks set approval_notified_at = null;
  select count(*) into v_n from rpc_claim_pending_approval_notifications(null);
  if v_n <> 2 then raise exception '7) NULL limit で n=% (期待 2: 例外なくクランプ動作)', v_n; end if;
  raise notice 'PASS 7) p_limit=NULL はクランプされ無制限にならない';

  -----------------------------------------------------------------------------
  -- 8) 退職者ガード: 有効リンクが残っていても、現在 org/space 在籍が無い approver の
  --    候補は claim されない（1:1でタイトルを漏らさない）。notified も刻まれない。
  -----------------------------------------------------------------------------
  update channel_user_links set revoked_at = null where external_user_id = 'Uex-staff'; -- リンクは有効
  update channel_digest_tasks set approval_notified_at = null;
  if exists (select 1 from rpc_claim_pending_approval_notifications(50) where task_id = v_t3) then
    raise exception '8) 退職者(在籍なし)approverの候補が claim された（漏洩ガード破れ）';
  end if;
  if (select approval_notified_at from channel_digest_tasks where id = v_t3) is not null then
    raise exception '8) 退職者候補に notified が刻まれた';
  end if;
  raise notice 'PASS 8) 有効リンクありでも在籍なし承認者へは通知しない（退職者漏洩ガード）';

  -----------------------------------------------------------------------------
  -- 9) 単票 claim rpc_claim_approval_notification: 権限あり→送信先を返し notified を刻む。
  --    2回目は null（冪等・二重送信防止）。
  -----------------------------------------------------------------------------
  update channel_digest_tasks set approval_notified_at = null where id = v_t1;
  select rpc_claim_approval_notification(v_t1) into v_ext;
  if v_ext <> 'Uapprover-new' then raise exception '9) 単票claim external=% (期待 Uapprover-new)', v_ext; end if;
  if (select approval_notified_at from channel_digest_tasks where id = v_t1) is null then
    raise exception '9) 単票claim後に notified が刻まれていない';
  end if;
  select rpc_claim_approval_notification(v_t1) into v_ext;
  if v_ext is not null then raise exception '9) 2回目の単票claimが非null（冪等でない）'; end if;
  raise notice 'PASS 9) 単票claimは送信先を返し notified を刻む・2回目はnull';

  -----------------------------------------------------------------------------
  -- 10) 単票claim の退職者ガード: 在籍なし approver は null（notified を刻まない）。
  -----------------------------------------------------------------------------
  update channel_digest_tasks set approval_notified_at = null where id = v_t3;
  select rpc_claim_approval_notification(v_t3) into v_ext;
  if v_ext is not null then raise exception '10) 退職者候補の単票claimが非null（漏洩ガード破れ）'; end if;
  if (select approval_notified_at from channel_digest_tasks where id = v_t3) is not null then
    raise exception '10) 退職者候補に単票claimで notified が刻まれた';
  end if;
  raise notice 'PASS 10) 単票claimも在籍なし承認者へは送らない';

  -----------------------------------------------------------------------------
  -- 11) 単票claim: pending 以外（none/promoted/rejected）や存在しないtaskは null。
  -----------------------------------------------------------------------------
  select rpc_claim_approval_notification('00000000-0000-4000-8000-0000000000ff') into v_ext; -- 不在
  if v_ext is not null then raise exception '11) 不在taskの単票claimが非null'; end if;
  raise notice 'PASS 11) 単票claimは不在/非pendingで null';

  raise notice '=== 全項目 PASS ===';
end $$;
