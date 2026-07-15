-- channel_digest_tasks_notify_approver トリガー（Stage 2.7-B §5b）の検証。
-- 前段: approval_notify_test.sql フィクスチャ＋dispatch migration＋この trigger migration 適用済み。
-- notifications テーブル（本物の最小形）はここで作る（フィクスチャに無いため）。
set client_min_messages = notice;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,
  to_user_id uuid not null,
  channel text not null,
  type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  actioned_at timestamptz null,
  unique (to_user_id, channel, dedupe_key)
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_a1  uuid := '00000000-0000-4000-8000-0000000000a1'; -- 現責任者・在籍あり
  v_a3  uuid := '00000000-0000-4000-8000-0000000000a3'; -- 退職者（在籍なし）
  v_g1  uuid := '00000000-0000-4000-8000-0000000000d1';
  v_g3  uuid := '00000000-0000-4000-8000-0000000000d3';
  v_t1  uuid;
  v_t3  uuid;
  v_n   int;
  r     record;
begin
  -- 1) 認可OKの pending 挿入 → 通知1件・payloadにtitle/group_name
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g1, '発注', 'pending', v_a1, now()) returning id into v_t1;
  select count(*) into v_n from notifications where type='digest_approval_request' and to_user_id=v_a1;
  if v_n <> 1 then raise exception '1) 通知件数=% (期待1)', v_n; end if;
  select * into r from notifications where to_user_id=v_a1 limit 1;
  if r.payload->>'title' <> '発注' then raise exception '1) payload.title=%', r.payload->>'title'; end if;
  if (r.payload->>'digest_task_id')::uuid <> v_t1 then raise exception '1) payload.digest_task_id 不一致'; end if;
  raise notice 'PASS 1) 認可OKでpending→承認依頼通知1件・payload正しい';

  -- 2) 認可NG（退職者a3）の pending 挿入 → 通知は作られない
  insert into channel_digest_tasks(org_id, group_id, title, promotion_state, requested_to_user_id, requested_at)
    values (v_org, v_g3, '退職者宛', 'pending', v_a3, now()) returning id into v_t3;
  select count(*) into v_n from notifications where to_user_id=v_a3;
  if v_n <> 0 then raise exception '2) 退職者に通知が作られた（漏洩）'; end if;
  raise notice 'PASS 2) 認可NG（退職者）には通知しない';

  -- 3) 冪等: 同一taskを一旦noneに戻して再pending（none→pending）→ 既読を消して再活性、増えない
  update notifications set read_at = now(), actioned_at = now() where dedupe_key='digest_approval:'||v_t1::text;
  update channel_digest_tasks set promotion_state='none', requested_to_user_id=null, requested_at=null where id=v_t1;
  update channel_digest_tasks set promotion_state='pending', requested_to_user_id=v_a1, requested_at=now() where id=v_t1;
  select count(*) into v_n from notifications where dedupe_key='digest_approval:'||v_t1::text;
  if v_n <> 1 then raise exception '3) 再pendingで通知が増減した n=%', v_n; end if;
  select * into r from notifications where dedupe_key='digest_approval:'||v_t1::text;
  if r.read_at is not null or r.actioned_at is not null then
    raise exception '3) 再pendingで既読/対応済みがクリアされていない（再活性しない）';
  end if;
  raise notice 'PASS 3) none→再pendingで通知を再活性（増やさない）';

  -- 4) pending→promoted → 通知を *削除* する（開示対策: ペイロードを受信箱に残さない）
  -- ※scratchの channel_digest_tasks は CHECK 制約なしなので付随列は省略して状態だけ遷移させる
  update channel_digest_tasks set promotion_state='promoted' where id=v_t1;
  select count(*) into v_n from notifications where dedupe_key='digest_approval:'||v_t1::text;
  if v_n <> 0 then raise exception '4) promoted後に通知が削除されていない n=%', v_n; end if;
  raise notice 'PASS 4) promoted遷移で承認依頼通知を削除（ペイロードを残さない）';

  -- 5) pending→none（責任者交代）でも削除される
  update channel_digest_tasks set promotion_state='pending', requested_to_user_id=v_a1, requested_at=now() where id=v_t1;  -- 一旦pendingへ再作成
  select count(*) into v_n from notifications where dedupe_key='digest_approval:'||v_t1::text;
  if v_n <> 1 then raise exception '5) 再pendingで通知が復活していない n=%', v_n; end if;
  update channel_digest_tasks set promotion_state='none', requested_to_user_id=null, requested_at=null where id=v_t1;
  select count(*) into v_n from notifications where dedupe_key='digest_approval:'||v_t1::text;
  if v_n <> 0 then raise exception '5) none遷移(責任者交代)で通知が削除されていない n=%', v_n; end if;
  raise notice 'PASS 5) none遷移(責任者交代)でも承認依頼通知を削除';

  raise notice '=== digest_approval_notification 全項目 PASS ===';
end $$;
